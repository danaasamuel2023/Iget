// paystackRoutes.js - Combined routes and controller
const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');
const { Transaction, User } = require('../schema/schema');
const authMiddleware = require('../AuthMiddle/middlewareauth');

// Set your Paystack secret key
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || 'sk_live_a3c9c9ebae098fe19f77e497977d7fb33c43dabd';
const PAYSTACK_BASE_URL = 'https://api.paystack.co';

// Transaction fee percentage (2%)
const TRANSACTION_FEE_PERCENTAGE = 2;

/**
 * Initiates a deposit transaction via Paystack
 */
const initiateDeposit = async (req, res) => {
  try {
    const { amount, email } = req.body;
    const userId = req.user.id;

    // Validate input
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid amount is required'
      });
    }

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    // Find the user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Calculate transaction fee (2% of the amount)
    const feePercentage = TRANSACTION_FEE_PERCENTAGE / 100;
    const transactionFee = Math.round(amount * feePercentage);
    
    // Total amount to charge (including fee)
    const totalAmount = amount + transactionFee;
    
    // Amount that will be credited to user's wallet (without fee)
    const creditAmount = amount / 100; // Convert kobo to GHS

    // Generate a unique reference
    const reference = `DEP-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;

    // Create a pending transaction in our database
    const transaction = new Transaction({
      user: userId,
      type: 'deposit',
      amount: creditAmount, // This is the amount that will be credited (without fee)
      currency: 'GHS',
      description: 'Wallet deposit via Paystack',
      status: 'pending',
      reference: reference,
      balanceBefore: user.wallet.balance,
      paymentMethod: 'paystack',
      paymentDetails: {
        email: email,
        reference: reference,
        transactionFee: transactionFee / 100, // Fee in GHS
        totalAmount: totalAmount / 100, // Total amount charged in GHS
      }
    });

    await transaction.save();

    // Initialize transaction with Paystack
    const response = await axios.post(
      `${PAYSTACK_BASE_URL}/transaction/initialize`,
      {
        email: email,
        amount: totalAmount, // Total amount in kobo (pesewas) including fee
        reference: reference,
        callback_url: `https://console.igetghana.com//verify?reference=${reference}`,
        metadata: {
          userId: user._id.toString(),
          transactionId: transaction._id.toString(),
          originalAmount: amount, // Original amount without fee
          transactionFee: transactionFee, // Fee amount
        }
      },
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // Return the authorization URL to the client
    return res.status(200).json({
      success: true,
      message: 'Deposit initiated successfully',
      data: {
        authorizationUrl: response.data.data.authorization_url,
        reference: reference,
        transactionId: transaction._id,
        amount: creditAmount, // Amount that will be credited to wallet
        transactionFee: transactionFee / 100, // Fee in GHS
        totalAmount: totalAmount / 100 // Total amount charged in GHS
      }
    });
  } catch (error) {
    console.error('Paystack deposit initiation error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to initiate deposit',
      error: error.message
    });
  }
};

/**
 * Verifies a Paystack transaction
 */
const verifyTransaction = async (req, res) => {
  try {
    const { reference } = req.query;

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: 'Transaction reference is required'
      });
    }

    // Verify the transaction with Paystack
    const response = await axios.get(
      `${PAYSTACK_BASE_URL}/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        }
      }
    );

    const { status, data } = response.data;

    if (!status || data.status !== 'success') {
      return res.status(400).json({
        success: false,
        message: 'Payment verification failed',
        data: response.data
      });
    }

    // Get the metadata from Paystack response
    const { userId, transactionId, originalAmount } = data.metadata;

    // Find the transaction in our database
    const transaction = await Transaction.findOne({
      _id: transactionId,
      reference: reference
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    // If the transaction is already completed, prevent double processing
    if (transaction.status === 'completed') {
      return res.status(200).json({
        success: true,
        message: 'Transaction already processed',
        data: transaction
      });
    }

    // Find the user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get the amount to credit to user's wallet (original amount without fee)
    const creditAmount = originalAmount ? originalAmount / 100 : data.amount / 100;
    
    // Update transaction details
    transaction.status = 'completed';
    transaction.balanceBefore = user.wallet.balance;
    transaction.balanceAfter = user.wallet.balance + creditAmount;
    transaction.paymentDetails = {
      ...transaction.paymentDetails,
      paystack: data
    };
    transaction.updatedAt = Date.now();

    // Update user wallet balance with only the original amount (not including fee)
    user.wallet.balance += creditAmount;
    user.wallet.transactions.push(transaction._id);

    // Save both documents
    await Promise.all([transaction.save(), user.save()]);

    // Redirect or respond based on context
    if (req.headers['accept'] && req.headers['accept'].includes('text/html')) {
      // Redirect to a success page if accessed via browser
      return res.redirect(`https://www.datamartgh.shop/payment/success?reference=${reference}`);
    } else {
      // Return JSON if API call
      return res.status(200).json({
        success: true,
        message: 'Payment verified and wallet updated successfully',
        data: {
          transaction: transaction,
          newBalance: user.wallet.balance,
          amountCredited: creditAmount,
        }
      });
    }
  } catch (error) {
    console.error('Paystack verification error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to verify payment',
      error: error.message
    });
  }
};

/**
 * Handles Paystack webhook events
 */
const handleWebhook = async (req, res) => {
  try {
    // Verify the event is from Paystack
    const hash = crypto
      .createHmac('sha512', PAYSTACK_SECRET_KEY)
      .update(JSON.stringify(req.body))
      .digest('hex');
    
    if (hash !== req.headers['x-paystack-signature']) {
      return res.status(401).json({ success: false, message: 'Invalid signature' });
    }
    
    const event = req.body;
    
    // Handle charge.success event
    if (event.event === 'charge.success') {
      const { reference } = event.data;
      
      // Find the corresponding transaction
      const transaction = await Transaction.findOne({ reference });
      if (!transaction) {
        return res.status(200).send('Transaction not found, but webhook received');
      }
      
      // If transaction is already completed, do nothing
      if (transaction.status === 'completed') {
        return res.status(200).send('Transaction already processed');
      }
      
      // Find the user
      const user = await User.findById(transaction.user);
      if (!user) {
        return res.status(200).send('User not found, but webhook received');
      }
      
      // Get the original amount (without fee) from metadata or use transaction amount
      const originalAmount = event.data.metadata && event.data.metadata.originalAmount 
        ? event.data.metadata.originalAmount / 100 
        : transaction.amount;
      
      // Update transaction details
      transaction.status = 'completed';
      transaction.balanceBefore = user.wallet.balance;
      transaction.balanceAfter = user.wallet.balance + originalAmount;
      transaction.paymentDetails = {
        ...transaction.paymentDetails,
        paystack: event.data
      };
      transaction.updatedAt = Date.now();
      
      // Update user wallet balance with original amount (not including fee)
      user.wallet.balance += originalAmount;
      user.wallet.transactions.push(transaction._id);
      
      // Save both documents
      await Promise.all([transaction.save(), user.save()]);
    }
    
    // Acknowledge receipt of the webhook
    return res.status(200).send('Webhook received');
  } catch (error) {
    console.error('Paystack webhook error:', error);
    return res.status(500).send('Webhook processing failed');
  }
};

// Adding the transaction locking mechanism from the second implementation
async function processSuccessfulPayment(reference) {
  // Use findOneAndUpdate with proper conditions to prevent race conditions
  const transaction = await Transaction.findOneAndUpdate(
    { 
      reference, 
      status: 'pending',
      processing: { $ne: true } // Only update if not already being processed
    },
    { 
      $set: { 
        processing: true  // Mark as being processed to prevent double processing
      } 
    },
    { new: true }
  );

  if (!transaction) {
    console.log(`Transaction ${reference} not found or already processed/processing`);
    return { success: false, message: 'Transaction not found or already processed' };
  }

  try {
    // Find the user
    const user = await User.findById(transaction.user);
    if (!user) {
      console.error(`User not found for transaction ${reference}`);
      // Release the processing lock
      transaction.processing = false;
      await transaction.save();
      return { success: false, message: 'User not found' };
    }

    // Get the amount to credit (this should be the original amount without fee)
    const creditAmount = transaction.amount;

    // Update transaction details
    transaction.status = 'completed';
    transaction.balanceBefore = user.wallet.balance;
    transaction.balanceAfter = user.wallet.balance + creditAmount;
    transaction.updatedAt = Date.now();
    
    // Update user wallet balance
    user.wallet.balance += creditAmount;
    user.wallet.transactions.push(transaction._id);
    
    // Save both documents
    await Promise.all([transaction.save(), user.save()]);
    
    return { success: true, message: 'Deposit successful' };
  } catch (error) {
    // If there's an error, release the processing lock
    transaction.processing = false;
    await transaction.save();
    throw error;
  }
}

// Routes definition
// Protected route - requires authentication
router.post('/deposit', authMiddleware, initiateDeposit);

// Public route - used for payment verification callbacks
router.get('/verify', verifyTransaction);

// Webhook endpoint - receives Paystack event notifications
router.post('/webhook', handleWebhook);

// Additional verify-payment endpoint from the second implementation
router.get('/verify-payment', async (req, res) => {
  try {
    const { reference } = req.query;

    if (!reference) {
      return res.status(400).json({ 
        success: false, 
        error: 'Reference is required' 
      });
    }

    // Find the transaction in our database
    const transaction = await Transaction.findOne({ reference });

    if (!transaction) {
      return res.status(404).json({ 
        success: false, 
        error: 'Transaction not found' 
      });
    }

    // If transaction is already completed, we can return success
    if (transaction.status === 'completed') {
      return res.json({
        success: true,
        message: 'Payment already verified and completed',
        data: {
          reference,
          amount: transaction.amount,
          status: transaction.status
        }
      });
    }

    // If transaction is still pending, verify with Paystack
    if (transaction.status === 'pending') {
      try {
        // Verify the transaction status with Paystack
        const paystackResponse = await axios.get(
          `${PAYSTACK_BASE_URL}/transaction/verify/${reference}`,
          {
            headers: {
              Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
              'Content-Type': 'application/json'
            }
          }
        );

        const { data } = paystackResponse.data;

        // If payment is successful
        if (data.status === 'success') {
          // Process the payment using our common function
          const result = await processSuccessfulPayment(reference);
          
          if (result.success) {
            return res.json({
              success: true,
              message: 'Payment verified successfully',
              data: {
                reference,
                amount: transaction.amount,
                status: 'completed'
              }
            });
          } else {
            return res.json({
              success: false,
              message: result.message,
              data: {
                reference,
                amount: transaction.amount,
                status: transaction.status
              }
            });
          }
        } else {
          return res.json({
            success: false,
            message: 'Payment not completed',
            data: {
              reference,
              amount: transaction.amount,
              status: data.status
            }
          });
        }
      } catch (error) {
        console.error('Paystack verification error:', error);
        return res.status(500).json({
          success: false,
          error: 'Failed to verify payment with Paystack'
        });
      }
    }

    // For failed or other statuses
    return res.json({
      success: false,
      message: `Payment status: ${transaction.status}`,
      data: {
        reference,
        amount: transaction.amount,
        status: transaction.status
      }
    });
  } catch (error) {
    console.error('Verification Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

module.exports = router;