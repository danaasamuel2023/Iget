// paystackRoutes.js - Updated with paginated transactions route
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
const TRANSACTION_FEE_PERCENTAGE = 2.5;

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

/**
 * Fetches paginated transactions for a user and verifies pending transactions
 */
const getUserTransactionsAndVerifyPending = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Extract pagination parameters from query string
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    // Count total transactions for pagination metadata
    const totalTransactions = await Transaction.countDocuments({ user: userId });
    const totalPages = Math.ceil(totalTransactions / limit);
    
    // Find transactions with pagination
    const transactions = await Transaction.find({ user: userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // Keep track of verified transactions
    const verifiedTransactions = [];
    
    // Get all pending transactions regardless of pagination for verification
    // This ensures all pending transactions are verified even if they're not on the current page
    const pendingTransactions = await Transaction.find({ 
      user: userId, 
      status: 'pending', 
      type: 'deposit'
    });
    
    if (pendingTransactions.length > 0) {
      // Verify each pending transaction with Paystack
      for (const transaction of pendingTransactions) {
        try {
          // Skip if already being processed
          if (transaction.processing) continue;
          
          // Verify the transaction with Paystack
          const paystackResponse = await axios.get(
            `${PAYSTACK_BASE_URL}/transaction/verify/${transaction.reference}`,
            {
              headers: {
                Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
                'Content-Type': 'application/json'
              }
            }
          );
          
          const { data } = paystackResponse.data;
          
          // If payment was successful, process it
          if (data.status === 'success') {
            const result = await processSuccessfulPayment(transaction.reference);
            if (result.success) {
              verifiedTransactions.push({
                transactionId: transaction._id,
                reference: transaction.reference,
                status: 'completed'
              });
            }
          }
        } catch (error) {
          console.error(`Error verifying transaction ${transaction.reference}:`, error.message);
          // Continue with other transactions even if one fails
        }
      }
      
      // If any transactions were verified, refresh the paginated results
      // This ensures that status changes appear immediately in the response
      if (verifiedTransactions.length > 0) {
        const updatedTransactions = await Transaction.find({ user: userId })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit);
          
        return res.status(200).json({
          success: true,
          message: 'Transactions fetched and pending transactions verified',
          data: {
            transactions: updatedTransactions,
            verified: verifiedTransactions,
            pagination: {
              totalItems: totalTransactions,
              totalPages: totalPages,
              currentPage: page,
              pageSize: limit,
              hasNextPage: page < totalPages,
              hasPreviousPage: page > 1
            }
          }
        });
      }
    }
    
    // Return transactions if none were pending or none were verified
    return res.status(200).json({
      success: true,
      message: 'Transactions fetched successfully',
      data: {
        transactions: transactions,
        verified: verifiedTransactions,
        pagination: {
          totalItems: totalTransactions,
          totalPages: totalPages,
          currentPage: page,
          pageSize: limit,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1
        }
      }
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch transactions',
      error: error.message
    });
  }
};

/**
 * Admin route to verify all pending transactions in the system
 */
const verifyAllPendingTransactions = async (req, res) => {
  try {
    // This route requires admin privileges
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Admin privileges required'
      });
    }

    // Extract pagination parameters from query string for admin view
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Find all pending deposit transactions with pagination for viewing
    const totalPendingTransactions = await Transaction.countDocuments({ 
      status: 'pending',
      type: 'deposit' 
    });
    
    // Find pending transactions to process
    const pendingTransactions = await Transaction.find({ 
      status: 'pending',
      type: 'deposit',
      processing: { $ne: true } // Skip already processing transactions
    })
    .sort({ createdAt: -1 });

    if (pendingTransactions.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No pending transactions found',
        data: {
          pagination: {
            totalItems: totalPendingTransactions,
            totalPages: Math.ceil(totalPendingTransactions / limit),
            currentPage: page,
            pageSize: limit
          }
        }
      });
    }

    // Track results
    const results = {
      total: pendingTransactions.length,
      verified: 0,
      failed: 0,
      details: []
    };

    // Process each pending transaction
    for (const transaction of pendingTransactions) {
      try {
        // Verify with Paystack
        const paystackResponse = await axios.get(
          `${PAYSTACK_BASE_URL}/transaction/verify/${transaction.reference}`,
          {
            headers: {
              Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
              'Content-Type': 'application/json'
            }
          }
        );
        
        const { data } = paystackResponse.data;
        
        // If successful, process payment
        if (data.status === 'success') {
          const result = await processSuccessfulPayment(transaction.reference);
          
          if (result.success) {
            results.verified++;
            results.details.push({
              reference: transaction.reference,
              status: 'completed',
              message: 'Successfully verified and processed'
            });
          } else {
            results.failed++;
            results.details.push({
              reference: transaction.reference,
              status: 'failed',
              message: result.message
            });
          }
        } else {
          results.failed++;
          results.details.push({
            reference: transaction.reference,
            status: 'failed',
            message: `Payment not successful: ${data.status}`
          });
        }
      } catch (error) {
        results.failed++;
        results.details.push({
          reference: transaction.reference,
          status: 'error',
          message: error.message
        });
      }
    }

    // Get updated paginated list of pending transactions
    const updatedPendingTransactions = await Transaction.find({ 
      status: 'pending',
      type: 'deposit'
    })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

    // Get updated count for pagination
    const newTotalPendingTransactions = await Transaction.countDocuments({ 
      status: 'pending',
      type: 'deposit' 
    });
    
    return res.status(200).json({
      success: true,
      message: 'Verification process completed',
      data: {
        results: results,
        pendingTransactions: updatedPendingTransactions,
        pagination: {
          totalItems: newTotalPendingTransactions,
          totalPages: Math.ceil(newTotalPendingTransactions / limit),
          currentPage: page,
          pageSize: limit,
          hasNextPage: page < Math.ceil(newTotalPendingTransactions / limit),
          hasPreviousPage: page > 1
        }
      }
    });
  } catch (error) {
    console.error('Error verifying all pending transactions:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to verify pending transactions',
      error: error.message
    });
  }
};

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
          `${PAYSTACK_BASE_URL}/transaction/verify/${transaction.reference}`,
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

// Routes for user transactions and verifying pending transactions
router.get('/transactions', authMiddleware, getUserTransactionsAndVerifyPending);
router.get('/verify-all-pending', authMiddleware, verifyAllPendingTransactions);

module.exports = router;