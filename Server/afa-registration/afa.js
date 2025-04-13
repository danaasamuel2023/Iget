// routes/afa-registration.js
const express = require('express');
const router = express.Router();
const { User, Order, Transaction } = require('../schema/schema');
const auth = require('../AuthMiddle/middlewareauth');
const mongoose = require('mongoose');

// SMS functionality removed as requested

/**
 * @route   POST /api/afa/register
 * @desc    Process AFA registration and deduct from user wallet
 * @access  Private
 */
router.post('/register', auth, async (req, res) => {
  try {
    const { 
      phoneNumber, 
      price,
      fullName,
      idType,
      idNumber,
      dateOfBirth,
      occupation,
      location
    } = req.body;
    
    // Validate required fields
    if (!phoneNumber || !price || !fullName || !idType || !idNumber || !dateOfBirth || !occupation || !location) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields' 
      });
    }

    // Generate reference
    const orderReference = `AFA-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // Get user for wallet balance check
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if user has enough balance
    if (user.wallet.balance < price) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance in wallet'
      });
    }

    // Generate random capacity value between 10 and 50
    const randomCapacity = Math.floor(Math.random() * 41) + 10;

    // Start a session for the transaction
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      // Create new order
      const newOrder = new Order({
        user: req.user.id,
        bundleType: 'AfA-registration',
        capacity: randomCapacity,
        price: price,
        recipientNumber: phoneNumber,
        status: 'completed', // Mark as completed immediately
        orderReference: orderReference,
        // Store additional AFA registration data in a metadata field
        metadata: {
          fullName,
          idType,
          idNumber,
          dateOfBirth: new Date(dateOfBirth),
          occupation,
          location
        },
        updatedAt: Date.now()
      });
      
      await newOrder.save({ session });
      
      // Create transaction record
      const transaction = new Transaction({
        user: req.user.id,
        type: 'purchase',
        amount: price,
        currency: user.wallet.currency || 'GHS',
        description: `AFA Registration: ${fullName} (${phoneNumber})`,
        status: 'completed',
        reference: `TXN-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        orderId: newOrder._id,
        balanceBefore: user.wallet.balance,
        balanceAfter: user.wallet.balance - price,
        paymentMethod: 'wallet',
        metadata: {
          orderType: 'afa-registration',
          capacity: randomCapacity,
          fullName
        }
      });
      
      await transaction.save({ session });
      
      // Update user's wallet balance
      user.wallet.balance -= price;
      if (user.wallet.transactions) {
        user.wallet.transactions.push(transaction._id);
      }
      await user.save({ session });
      
      // Commit the transaction
      await session.commitTransaction();
      session.endSession();
      
      // SMS notification removed as requested
      
      // Return success response
      return res.status(201).json({
        success: true,
        message: 'AFA Registration completed successfully',
        data: {
          order: {
            id: newOrder._id,
            orderReference: newOrder.orderReference,
            recipientNumber: newOrder.recipientNumber,
            bundleType: newOrder.bundleType,
            capacity: randomCapacity,
            price: newOrder.price,
            status: 'pending',
            createdAt: newOrder.createdAt
          },
          registration: {
            fullName,
            capacity: randomCapacity
          },
          transaction: {
            id: transaction._id,
            reference: transaction.reference,
            amount: transaction.amount,
            status: transaction.status
          },
          walletBalance: user.wallet.balance
        }
      });
    } catch (error) {
      // If an error occurs, abort the transaction
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  } catch (error) {
    console.error('Error processing AFA registration:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/afa/registrations
 * @desc    Get all AFA registrations for the logged-in user
 * @access  Private
 */
router.get('/registrations', auth, async (req, res) => {
  try {
    const registrations = await Order.find({ 
      user: req.user.id,
      bundleType: 'AfA-registration'
    }).sort({ createdAt: -1 });
    
    if (!registrations.length) {
      return res.status(200).json({ 
        success: true, 
        message: 'No AFA registrations found', 
        data: [] 
      });
    }

    res.status(200).json({ 
      success: true, 
      count: registrations.length, 
      data: registrations.map(reg => ({
        id: reg._id,
        orderReference: reg.orderReference,
        phoneNumber: reg.recipientNumber,
        capacity: reg.capacity,
        price: reg.price,
        status: reg.status,
        createdAt: reg.createdAt,
        metadata: reg.metadata || {}
      }))
    });
  } catch (error) {
    console.error('Error fetching AFA registrations:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
});

module.exports = router;