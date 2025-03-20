// routes/api.js
const express = require('express');
const router = express.Router();
const { Order, User, Transaction, Bundle } = require('../schema/schema');
const apiAuth = require('../middlewareApi/ApiAuth');
const { ApiLog } = require('../schema/schema');
const mongoose = require('mongoose');

/**
 * API Request Logger Middleware
 * Logs API requests with request/response details
 */
const apiLogger = async (req, res, next) => {
  // Store original send function
  const originalSend = res.send;
  
  // Start time for execution time calculation
  const startTime = Date.now();
  
  // Override send function to capture response data
  res.send = function(data) {
    const responseData = JSON.parse(data);
    const executionTime = Date.now() - startTime;
    
    // Create log entry
    const logEntry = new ApiLog({
      user: req.user ? req.user.id : null,
      apiKey: req.header('X-API-Key'),
      endpoint: req.originalUrl,
      method: req.method,
      requestData: {
        body: req.body,
        params: req.params,
        query: req.query
      },
      responseData: responseData,
      ipAddress: req.ip,
      status: res.statusCode,
      executionTime: executionTime
    });
    
    // Save log entry (don't await to avoid delaying response)
    logEntry.save().catch(err => console.error('Error saving API log:', err));
    
    // Call original send function
    originalSend.call(this, data);
    return this;
  };
  
  next();
};

/**
 * @route   POST /api/v1/orders/place
 * @desc    Place an order using API key auth
 * @access  Private (API Key)
 */
router.post('/orders/place', apiAuth, apiLogger, async (req, res) => {
  try {
    const { recipientNumber, capacity, bundleType } = req.body;
    
    // Validate required fields
    if (!recipientNumber || !capacity || !bundleType) {
      return res.status(400).json({
        success: false,
        message: 'Recipient number, capacity, and bundle type are all required'
      });
    }
    
    // Validate recipient number format
    const phoneRegex = /^\+?[1-9]\d{9,14}$/;
    if (!phoneRegex.test(recipientNumber)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid recipient phone number format'
      });
    }
    
    // Find the matching bundle to get the correct price
    const bundle = await Bundle.findOne({ 
      type: bundleType,
      capacity: capacity,
      isActive: true
    });
    
    if (!bundle) {
      return res.status(404).json({
        success: false,
        message: `No active bundle found matching type ${bundleType} with capacity ${capacity}MB`
      });
    }
    
    // Use the price from the bundle record
    const price = bundle.price;
    
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
        message: `Insufficient balance in wallet. Required: ${price} ${user.wallet.currency}`
      });
    }
    
    // Start a session for the transaction
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      // Create new order with bundle details directly embedded
      const newOrder = new Order({
        user: req.user.id,
        bundleType: bundleType,
        capacity: capacity,
        price: price,  // Using price from the bundle record
        recipientNumber: recipientNumber,
        status: 'pending',
        updatedAt: Date.now()
      });
      
      await newOrder.save({ session });
      
      // Create transaction record
      const transaction = new Transaction({
        user: req.user.id,
        type: 'purchase',
        amount: price,
        currency: user.wallet.currency,
        description: `API: Bundle purchase: ${capacity}MB for ${recipientNumber}`,
        status: 'completed',
        reference: 'API-TXN-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
        orderId: newOrder._id,
        balanceBefore: user.wallet.balance,
        balanceAfter: user.wallet.balance - price,
        paymentMethod: 'wallet'
      });
      
      await transaction.save({ session });
      
      // Update user's wallet balance
      user.wallet.balance -= price;
      user.wallet.transactions.push(transaction._id);
      await user.save({ session });
      
      // Commit the transaction
      await session.commitTransaction();
      session.endSession();
      
      // Return the created order
      res.status(201).json({
        success: true,
        message: 'Order placed successfully and payment processed',
        data: {
          order: {
            id: newOrder._id,
            orderReference: newOrder.orderReference,
            recipientNumber: newOrder.recipientNumber,
            bundleType: newOrder.bundleType,
            capacity: newOrder.capacity,
            price: price,  // Using price from the bundle record
            status: newOrder.status,
            createdAt: newOrder.createdAt
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
    console.error('Error placing order via API:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/v1/orders
 * @desc    Get all orders for the API user
 * @access  Private (API Key)
 */
router.get('/orders', apiAuth, apiLogger, async (req, res) => {
  try {
    // Pagination parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    // Filtering options
    const filter = { user: req.user.id };
    
    if (req.query.status) {
      filter.status = req.query.status;
    }
    
    if (req.query.bundleType) {
      filter.bundleType = req.query.bundleType;
    }
    
    // Date range filtering
    if (req.query.startDate && req.query.endDate) {
      filter.createdAt = {
        $gte: new Date(req.query.startDate),
        $lte: new Date(req.query.endDate)
      };
    }
    
    // Get total count for pagination
    const total = await Order.countDocuments(filter);
    
    // Get orders with pagination
    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
    
    res.status(200).json({
      success: true,
      count: orders.length,
      total,
      pages: Math.ceil(total / limit),
      currentPage: page,
      data: orders
    });
  } catch (error) {
    console.error('Error fetching API orders:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
});

/**
 * @route   GET /api/v1/orders/:id
 * @desc    Get specific order details
 * @access  Private (API Key)
 */
router.get('/orders/:id', apiAuth, apiLogger, async (req, res) => {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      user: req.user.id
    });

    if (!order) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found or not authorized to access' 
      });
    }

    res.status(200).json({ 
      success: true, 
      data: order 
    });
  } catch (error) {
    console.error('Error fetching API order details:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
});

/**
 * @route   GET /api/v1/wallet/balance
 * @desc    Get wallet balance
 * @access  Private (API Key)
 */
router.get('/wallet/balance', apiAuth, apiLogger, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select('wallet.balance wallet.currency');

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    res.status(200).json({ 
      success: true, 
      data: {
        balance: user.wallet.balance,
        currency: user.wallet.currency
      }
    });
  } catch (error) {
    console.error('Error fetching wallet balance:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
});

module.exports = router;