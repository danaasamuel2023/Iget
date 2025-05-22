// paystackRoutes.js - Enhanced with robust double payment prevention
const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { Transaction, User } = require('../schema/schema');
const authMiddleware = require('../AuthMiddle/middlewareauth');

// Set your Paystack secret key
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || 'sk_live_a3c9c9ebae098fe19f77e497977d7fb33c43dabd';
const PAYSTACK_BASE_URL = 'https://api.paystack.co';

// Transaction fee percentage (2.5%)
const TRANSACTION_FEE_PERCENTAGE = 2.5;

/**
 * Enhanced processSuccessfulPayment function with comprehensive double-payment prevention
 */
async function processSuccessfulPayment(reference, source = 'unknown') {
  const session = await mongoose.startSession();
  
  try {
    // Start a database transaction to ensure atomicity
    await session.startTransaction();
    
    // Use findOneAndUpdate with strict conditions to prevent race conditions
    const transaction = await Transaction.findOneAndUpdate(
      { 
        reference, 
        status: 'pending',
        $or: [
          { processing: { $exists: false } },
          { processing: false },
          { processing: null }
        ]
      },
      { 
        $set: { 
          processing: true,
          processingStartedAt: new Date(),
          processingSource: source // Track which endpoint started processing
        } 
      },
      { 
        new: true,
        session // Use the session for the transaction
      }
    );

    if (!transaction) {
      await session.abortTransaction();
      console.log(`Transaction ${reference} not found, already processed, or currently being processed by another instance`);
      
      // Check if transaction exists and return appropriate response
      const existingTransaction = await Transaction.findOne({ reference });
      if (existingTransaction) {
        if (existingTransaction.status === 'completed') {
          return { 
            success: true, 
            message: 'Transaction already completed',
            alreadyProcessed: true,
            transaction: existingTransaction
          };
        }
        return { 
          success: false, 
          message: 'Transaction is currently being processed by another instance',
          isBeingProcessed: true
        };
      }
      
      return { success: false, message: 'Transaction not found' };
    }

    console.log(`Processing payment ${reference} from ${source}`);

    // Find the user
    const user = await User.findById(transaction.user).session(session);
    if (!user) {
      console.error(`User not found for transaction ${reference}`);
      
      // Clean up: reset processing flag
      await Transaction.findByIdAndUpdate(
        transaction._id,
        { 
          $unset: { 
            processing: 1, 
            processingStartedAt: 1, 
            processingSource: 1 
          } 
        },
        { session }
      );
      
      await session.abortTransaction();
      return { success: false, message: 'User not found' };
    }

    // Get the amount to credit (this should be the original amount without fee)
    const creditAmount = transaction.amount;

    // Verify the credit amount is positive
    if (creditAmount <= 0) {
      console.error(`Invalid credit amount for transaction ${reference}: ${creditAmount}`);
      
      // Clean up: reset processing flag
      await Transaction.findByIdAndUpdate(
        transaction._id,
        { 
          $unset: { 
            processing: 1, 
            processingStartedAt: 1, 
            processingSource: 1 
          } 
        },
        { session }
      );
      
      await session.abortTransaction();
      return { success: false, message: 'Invalid transaction amount' };
    }

    // Record the balance before update
    const balanceBefore = user.wallet.balance;

    // Update transaction details
    const updatedTransaction = await Transaction.findByIdAndUpdate(
      transaction._id,
      {
        status: 'completed',
        balanceBefore: balanceBefore,
        balanceAfter: balanceBefore + creditAmount,
        completedAt: new Date(),
        processedBy: source,
        $unset: { 
          processing: 1, 
          processingStartedAt: 1, 
          processingSource: 1 
        }
      },
      { new: true, session }
    );
    
    // Update user wallet balance and add transaction reference
    const updatedUser = await User.findByIdAndUpdate(
      user._id,
      {
        $inc: { 'wallet.balance': creditAmount },
        $addToSet: { 'wallet.transactions': transaction._id } // Use $addToSet to prevent duplicates
      },
      { new: true, session }
    );

    // Commit the transaction
    await session.commitTransaction();
    
    console.log(`Payment ${reference} processed successfully. User balance: ${balanceBefore} -> ${updatedUser.wallet.balance}`);
    
    return { 
      success: true, 
      message: 'Payment processed successfully',
      transaction: updatedTransaction,
      previousBalance: balanceBefore,
      newBalance: updatedUser.wallet.balance,
      creditAmount: creditAmount
    };
    
  } catch (error) {
    // If there's an error, abort the transaction
    await session.abortTransaction();
    
    console.error(`Error processing payment ${reference}:`, error);
    
    // Try to clean up the processing flag (best effort)
    try {
      await Transaction.findOneAndUpdate(
        { reference },
        { 
          $unset: { 
            processing: 1, 
            processingStartedAt: 1, 
            processingSource: 1 
          } 
        }
      );
    } catch (cleanupError) {
      console.error(`Failed to cleanup processing flag for ${reference}:`, cleanupError);
    }
    
    throw error;
  } finally {
    await session.endSession();
  }
}

/**
 * Cleanup function to reset stuck processing transactions
 */
const cleanupStuckTransactions = async () => {
  try {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    
    const result = await Transaction.updateMany(
      {
        processing: true,
        processingStartedAt: { $lt: thirtyMinutesAgo },
        status: 'pending'
      },
      {
        $unset: {
          processing: 1,
          processingStartedAt: 1,
          processingSource: 1
        }
      }
    );
    
    if (result.modifiedCount > 0) {
      console.log(`Cleaned up ${result.modifiedCount} stuck processing transactions`);
    }
    
    return result;
  } catch (error) {
    console.error('Error cleaning up stuck transactions:', error);
    throw error;
  }
};

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

    // Calculate transaction fee (2.5% of the amount)
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
        callback_url: `https://console.igetghana.com/verify?reference=${reference}`,
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
 * Enhanced verification function with additional safety checks
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

    // First, check if we already have this transaction and its current status
    const existingTransaction = await Transaction.findOne({ reference });
    
    if (!existingTransaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    // If already completed, return success immediately
    if (existingTransaction.status === 'completed') {
      const user = await User.findById(existingTransaction.user);
      
      // Redirect or respond based on context
      if (req.headers['accept'] && req.headers['accept'].includes('text/html')) {
        return res.redirect(`https://www.datamartgh.shop/payment/success?reference=${reference}`);
      } else {
        return res.status(200).json({
          success: true,
          message: 'Transaction already processed',
          data: {
            transaction: existingTransaction,
            newBalance: user ? user.wallet.balance : null,
            amountCredited: existingTransaction.amount,
            alreadyProcessed: true
          }
        });
      }
    }

    // If currently being processed, wait a moment and check again
    if (existingTransaction.processing) {
      const processingStartTime = existingTransaction.processingStartedAt;
      const now = new Date();
      const processingDuration = now - processingStartTime;
      
      // If processing for more than 30 seconds, assume it's stuck and allow retry
      if (processingDuration > 30000) {
        console.warn(`Transaction ${reference} has been processing for ${processingDuration}ms, allowing retry`);
      } else {
        return res.status(202).json({
          success: false,
          message: 'Transaction is currently being processed. Please wait.',
          isBeingProcessed: true,
          processingDuration: processingDuration
        });
      }
    }

    // Only verify with Paystack if transaction is pending
    if (existingTransaction.status === 'pending') {
      // Verify the transaction with Paystack
      const response = await axios.get(
        `${PAYSTACK_BASE_URL}/transaction/verify/${reference}`,
        {
          headers: {
            Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          },
          timeout: 10000 // 10 second timeout
        }
      );

      const { status, data } = response.data;

      if (!status || data.status !== 'success') {
        return res.status(400).json({
          success: false,
          message: 'Payment verification failed or payment not successful',
          paystackStatus: data.status,
          data: response.data
        });
      }

      // Process the successful payment
      const result = await processSuccessfulPayment(reference, 'verification_endpoint');
      
      if (result.success) {
        // Update transaction with Paystack data
        await Transaction.findByIdAndUpdate(
          existingTransaction._id,
          {
            $set: {
              'paymentDetails.paystack': data,
              updatedAt: new Date()
            }
          }
        );

        // Redirect or respond based on context
        if (req.headers['accept'] && req.headers['accept'].includes('text/html')) {
          return res.redirect(`https://console.igetghana.com/payment/success?reference=${reference}`);
        } else {
          return res.status(200).json({
            success: true,
            message: 'Payment verified and wallet updated successfully',
            data: {
              transaction: result.transaction,
              newBalance: result.newBalance,
              amountCredited: result.creditAmount,
              previousBalance: result.previousBalance
            }
          });
        }
      } else if (result.alreadyProcessed) {
        // Redirect or respond based on context
        if (req.headers['accept'] && req.headers['accept'].includes('text/html')) {
          return res.redirect(`https://www.datamartgh.shop/payment/success?reference=${reference}`);
        } else {
          return res.status(200).json({
            success: true,
            message: 'Payment already processed',
            data: {
              transaction: result.transaction,
              alreadyProcessed: true
            }
          });
        }
      } else {
        return res.status(400).json({
          success: false,
          message: result.message
        });
      }
    }

    // For any other status
    return res.status(400).json({
      success: false,
      message: `Transaction status: ${existingTransaction.status}`,
      data: {
        reference,
        status: existingTransaction.status
      }
    });

  } catch (error) {
    console.error('Paystack verification error:', error);
    
    // Provide more specific error messages
    if (error.code === 'ECONNABORTED') {
      return res.status(408).json({
        success: false,
        message: 'Payment verification timeout. Please try again.',
        error: 'timeout'
      });
    }
    
    return res.status(500).json({
      success: false,
      message: 'Failed to verify payment',
      error: error.message
    });
  }
};

/**
 * Enhanced webhook handler with better duplicate prevention
 */
const handleWebhook = async (req, res) => {
  try {
    // Verify the event is from Paystack
    const hash = crypto
      .createHmac('sha512', PAYSTACK_SECRET_KEY)
      .update(JSON.stringify(req.body))
      .digest('hex');
    
    if (hash !== req.headers['x-paystack-signature']) {
      console.warn('Invalid webhook signature received');
      return res.status(401).json({ success: false, message: 'Invalid signature' });
    }
    
    const event = req.body;
    console.log(`Received webhook event: ${event.event} for reference: ${event.data?.reference}`);
    
    // Handle charge.success event
    if (event.event === 'charge.success') {
      const { reference } = event.data;
      
      if (!reference) {
        console.warn('Webhook received without reference');
        return res.status(200).send('Webhook received but no reference found');
      }
      
      // Process the payment
      const result = await processSuccessfulPayment(reference, 'webhook');
      
      if (result.success) {
        // Update transaction with webhook data if it was just processed
        if (!result.alreadyProcessed) {
          await Transaction.findOneAndUpdate(
            { reference },
            {
              $set: {
                'paymentDetails.webhook': event.data,
                webhookReceivedAt: new Date()
              }
            }
          );
        }
        
        console.log(`Webhook processed successfully for ${reference}`);
      } else {
        console.log(`Webhook processing result for ${reference}:`, result.message);
      }
    }
    
    // Always acknowledge receipt of the webhook
    return res.status(200).send('Webhook received');
    
  } catch (error) {
    console.error('Paystack webhook error:', error);
    // Still acknowledge the webhook to prevent retries for processing errors
    return res.status(200).send('Webhook received with processing error');
  }
};

/**
 * Additional verify-payment endpoint with enhanced safety
 */
const verifyPaymentEndpoint = async (req, res) => {
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

    // If currently being processed
    if (transaction.processing) {
      const processingStartTime = transaction.processingStartedAt;
      const now = new Date();
      const processingDuration = now - processingStartTime;
      
      // If processing for more than 30 seconds, assume it's stuck and allow retry
      if (processingDuration <= 30000) {
        return res.status(202).json({
          success: false,
          message: 'Transaction is currently being processed. Please wait.',
          isBeingProcessed: true,
          processingDuration: processingDuration
        });
      }
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
            },
            timeout: 10000
          }
        );

        const { data } = paystackResponse.data;

        // If payment is successful
        if (data.status === 'success') {
          // Process the payment using our common function
          const result = await processSuccessfulPayment(reference, 'verify_payment_endpoint');
          
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
          } else if (result.alreadyProcessed) {
            return res.json({
              success: true,
              message: 'Payment already verified and completed',
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
        
        if (error.code === 'ECONNABORTED') {
          return res.status(408).json({
            success: false,
            error: 'Payment verification timeout. Please try again.'
          });
        }
        
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
};

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
      type: 'deposit',
      processing: { $ne: true } // Skip already processing transactions
    });
    
    if (pendingTransactions.length > 0) {
      // Verify each pending transaction with Paystack
      for (const transaction of pendingTransactions) {
        try {
          // Verify the transaction with Paystack
          const paystackResponse = await axios.get(
            `${PAYSTACK_BASE_URL}/transaction/verify/${transaction.reference}`,
            {
              headers: {
                Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
                'Content-Type': 'application/json'
              },
              timeout: 10000
            }
          );
          
          const { data } = paystackResponse.data;
          
          // If payment was successful, process it
          if (data.status === 'success') {
            const result = await processSuccessfulPayment(transaction.reference, 'user_transactions_endpoint');
            if (result.success && !result.alreadyProcessed) {
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
            },
            timeout: 10000
          }
        );
        
        const { data } = paystackResponse.data;
        
        // If successful, process payment
        if (data.status === 'success') {
          const result = await processSuccessfulPayment(transaction.reference, 'admin_verify_all');
          
          if (result.success) {
            if (!result.alreadyProcessed) {
              results.verified++;
              results.details.push({
                reference: transaction.reference,
                status: 'completed',
                message: 'Successfully verified and processed'
              });
            } else {
              results.details.push({
                reference: transaction.reference,
                status: 'already_completed',
                message: 'Transaction was already completed'
              });
            }
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

// Additional verify-payment endpoint
router.get('/verify-payment', verifyPaymentEndpoint);

// Routes for user transactions and verifying pending transactions
router.get('/transactions', authMiddleware, getUserTransactionsAndVerifyPending);
router.get('/verify-all-pending', authMiddleware, verifyAllPendingTransactions);

// Admin cleanup endpoint for stuck transactions
router.post('/cleanup-stuck', authMiddleware, async (req, res) => {
  try {
    if (!req.user.isAdmin) {
      return res.status(403).json({ 
        success: false, 
        message: 'Admin privileges required' 
      });
    }
    
    const result = await cleanupStuckTransactions();
    
    return res.status(200).json({
      success: true,
      message: `Cleaned up ${result.modifiedCount} stuck transactions`,
      data: result
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to cleanup stuck transactions',
      error: error.message
    });
  }
});

module.exports = router;