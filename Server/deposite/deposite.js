// paystackRoutes.js - Combined routes and controller
const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');
const { Transaction, User } = require('../schema/schema');
const authMiddleware = require('../AuthMiddle/middlewareauth');

// Set your Paystack secret key
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || 'sk_live_0fba72fb9c4fc71200d2e0cdbb4f2b37c1de396c';
const PAYSTACK_BASE_URL = 'https://api.paystack.co';

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

    // Generate a unique reference
    const reference = `DEP-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;

    // Create a pending transaction in our database
    const transaction = new Transaction({
      user: userId,
      type: 'deposit',
      amount: amount / 100, // Convert kobo to GHS
      currency: 'GHS',
      description: 'Wallet deposit via Paystack',
      status: 'pending',
      reference: reference,
      balanceBefore: user.wallet.balance,
      paymentMethod: 'paystack',
      paymentDetails: {
        email: email,
        reference: reference
      }
    });

    await transaction.save();

    // Initialize transaction with Paystack
    const response = await axios.post(
      `${PAYSTACK_BASE_URL}/transaction/initialize`,
      {
        email: email,
        amount: amount, // Amount in kobo (pesewas)
        reference: reference,
        callback_url: `${req.protocol}://${req.get('host')}/api/paystack/verify`,
        metadata: {
          userId: user._id.toString(),
          transactionId: transaction._id.toString()
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
        transactionId: transaction._id
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
    const { userId, transactionId } = data.metadata;

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

    // Update transaction details
    const amount = data.amount / 100; // Convert from pesewas to GHS
    transaction.status = 'completed';
    transaction.balanceBefore = user.wallet.balance;
    transaction.balanceAfter = user.wallet.balance + amount;
    transaction.paymentDetails = {
      ...transaction.paymentDetails,
      paystack: data
    };
    transaction.updatedAt = Date.now();

    // Update user wallet balance
    user.wallet.balance += amount;
    user.wallet.transactions.push(transaction._id);

    // Save both documents
    await Promise.all([transaction.save(), user.save()]);

    // Redirect or respond based on context
    if (req.headers['accept'] && req.headers['accept'].includes('text/html')) {
      // Redirect to a success page if accessed via browser
      return res.redirect(`http://localhost:3000/verify?reference=${reference}`);
    } else {
      // Return JSON if API call
      return res.status(200).json({
        success: true,
        message: 'Payment verified and wallet updated successfully',
        data: {
          transaction: transaction,
          newBalance: user.wallet.balance
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
      
      // Update transaction details
      const amount = event.data.amount / 100; // Convert from pesewas to GHS
      transaction.status = 'completed';
      transaction.balanceBefore = user.wallet.balance;
      transaction.balanceAfter = user.wallet.balance + amount;
      transaction.paymentDetails = {
        ...transaction.paymentDetails,
        paystack: event.data
      };
      transaction.updatedAt = Date.now();
      
      // Update user wallet balance
      user.wallet.balance += amount;
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

// Routes definition
// Protected route - requires authentication
router.post('/deposit', authMiddleware, initiateDeposit);

// Public route - used for payment verification callbacks
router.get('/verify', verifyTransaction);

// Webhook endpoint - receives Paystack event notifications
router.post('/webhook', handleWebhook);

module.exports = router;