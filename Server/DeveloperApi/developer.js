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
// const apiLogger = async (req, res, next) => {
//   // Store original send function
//   const originalSend = res.send;
  
//   // Start time for execution time calculation
//   const startTime = Date.now();
  
//   // Override send function to capture response data
//   res.send = function(data) {
//     const responseData = JSON.parse(data);
//     const executionTime = Date.now() - startTime;
    
//     // Create log entry
//     const logEntry = new ApiLog({
//       user: req.user ? req.user.id : null,
//       apiKey: req.header('X-API-Key'),
//       endpoint: req.originalUrl,
//       method: req.method,
//       requestData: {
//         body: req.body,
//         params: req.params,
//         query: req.query
//       },
//       responseData: responseData,
//       ipAddress: req.ip,
//       status: res.statusCode,
//       executionTime: executionTime
//     });
    
//     // Save log entry (don't await to avoid delaying response)
//     logEntry.save().catch(err => console.error('Error saving API log:', err));
    
//     // Call original send function
//     originalSend.call(this, data);
//     return this;
//   };
  
//   next();
// };

/**
 * @route   POST /api/v1/orders/place
 * @desc    Place an order using API key auth
 * @access  Private (API Key)
 */
router.post('/orders/place', apiAuth, async (req, res) => {
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
    // const phoneRegex = /^\+?[1-9]\d{9,14}$/;
    // if (!phoneRegex.test(recipientNumber)) {
    //   return res.status(400).json({
    //     success: false,
    //     message: 'Invalid recipient phone number format'
    //   });
    // }
    
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
router.post('/orders/place', apiAuth, async (req, res) => {
  try {
    const { recipientNumber, capacity, bundleType } = req.body;
    
    // Validate required fields
    if (!recipientNumber || !capacity || !bundleType) {
      return res.status(400).json({
        success: false,
        message: 'Recipient number, capacity, and bundle type are all required'
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
        price: price,
        recipientNumber: recipientNumber,
        status: 'pending',
        updatedAt: Date.now()
      });
      
      // For mtnup2u bundle types, call the Hubnet API first before processing payment
      if (bundleType.toLowerCase() === 'mtnup2u') {
        try {
          // Generate unique order reference
          const orderReference = Math.floor(1000 + Math.random() * 900000);
          
          // Calculate volume in MB (in case the capacity is in GB)
          let volumeInMB = capacity;
          if (capacity < 100) { // Assuming small numbers represent GB
            volumeInMB = parseFloat(capacity) * 1000;
          }
          
          // Log the Hubnet API request for debugging
          console.log('Making Hubnet API request for mtnup2u bundle');
          console.log('Request payload:', {
            phone: recipientNumber,
            volume: volumeInMB,
            reference: orderReference,
            referrer: recipientNumber
          });
          
          // Make request to Hubnet API using "mtn" network (all lowercase)
          const hubnetResponse = await fetch(`https://console.hubnet.app/live/api/context/business/transaction/mtn-new-transaction`, {
            method: 'POST',
            headers: {
              'token': 'Bearer biWUr20SFfp8W33BRThwqTkg2PhoaZTkeWx',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              phone: recipientNumber,
              volume: volumeInMB,
              reference: orderReference,
              referrer: recipientNumber,
              webhook: ''
            })
          });
          
          const hubnetData = await hubnetResponse.json();
          
          console.log('Hubnet API Response:', hubnetData);
          
          if (!hubnetResponse.ok) {
            console.error('Hubnet order failed:', hubnetData);
            return res.status(400).json({
              success: false,
              message: 'Hubnet API purchase failed. No payment has been processed.',
              error: hubnetData.message || 'Unknown error'
            });
          }
          
          // Update order with Hubnet reference
          newOrder.apiReference = orderReference.toString();
          newOrder.hubnetReference = orderReference.toString();
          newOrder.orderReference = orderReference.toString();
          newOrder.status = 'pending';
          
          console.log(`Hubnet mtn order placed successfully: ${orderReference}`);
        } catch (apiError) {
          console.error('Error calling Hubnet API:', apiError.message);
          if (apiError.response) {
            console.error('Response status:', apiError.response.status);
            console.error('Response data:', apiError.response.data);
          }
          
          return res.status(400).json({
            success: false,
            message: 'Hubnet API connection error. No payment has been processed.',
            error: apiError.message,
            details: apiError.response?.data || 'Connection error'
          });
        }
      }
      // For AT-ishare bundle type, call the Hubnet API
      else if (bundleType.toLowerCase() === 'at-ishare') {
        try {
          // Generate unique order reference
          const orderReference = Math.floor(1000 + Math.random() * 900000);
          
          // Calculate volume in MB (in case the capacity is in GB)
          let volumeInMB = capacity;
          if (capacity < 100) { // Assuming small numbers represent GB
            volumeInMB = parseFloat(capacity) * 1000;
          }
          
          // Log the Hubnet API request for debugging
          console.log('Making Hubnet API request for AT-ishare bundle');
          console.log('Request payload:', {
            phone: recipientNumber,
            volume: volumeInMB,
            reference: orderReference,
            referrer: recipientNumber
          });
          
          // Make request to Hubnet API
          const hubnetResponse = await fetch(`https://console.hubnet.app/live/api/context/business/transaction/at-new-transaction`, {
            method: 'POST',
            headers: {
              'token': 'Bearer biWUr20SFfp8W33BRThwqTkg2PhoaZTkeWx',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              phone: recipientNumber,
              volume: volumeInMB,
              reference: orderReference,
              referrer: recipientNumber,
              webhook: ''
            })
          });
          
          const hubnetData = await hubnetResponse.json();
          
          console.log('Hubnet API Response:', hubnetData);
          
          if (!hubnetResponse.ok) {
            console.error('Hubnet order failed:', hubnetData);
            return res.status(400).json({
              success: false,
              message: 'Hubnet API purchase failed. No payment has been processed.',
              error: hubnetData.message || 'Unknown error'
            });
          }
          
          // Update order with Hubnet reference
          newOrder.apiReference = orderReference.toString();
          newOrder.hubnetReference = orderReference.toString();
          newOrder.orderReference = orderReference.toString();
          newOrder.status = 'completed';
          
          console.log(`Hubnet order placed successfully: ${orderReference}`);
        } catch (apiError) {
          console.error('Error calling Hubnet API:', apiError.message);
          if (apiError.response) {
            console.error('Response status:', apiError.response.status);
            console.error('Response data:', apiError.response.data);
          }
          
          return res.status(400).json({
            success: false,
            message: 'Hubnet API connection error. No payment has been processed.',
            error: apiError.message,
            details: apiError.response?.data || 'Connection error'
          });
        }
      }
      
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
            price: price,
            status: newOrder.status,
            createdAt: newOrder.createdAt,
            hubnetReference: newOrder.hubnetReference
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
 * @route   GET /api/v1/orders/reference/:orderRef
 * @desc    Get order details by order reference
 * @access  Private (API Key)
 */
router.get('/orders/reference/:orderRef', apiAuth, async (req, res) => {
  try {
    const orderReference = req.params.orderRef;
    
    // Validate order reference format
    if (!orderReference) {
      return res.status(400).json({ 
        success: false, 
        message: 'Order reference is required' 
      });
    }
    
    // Find the order by reference, ensuring it belongs to the authenticated user
    const order = await Order.findOne({
      orderReference: orderReference,
      user: req.user.id
    });

    if (!order) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found or not authorized to access' 
      });
    }

    // Find related transaction for this order
    const transaction = await Transaction.findOne({
      orderId: order._id,
      user: req.user.id
    }).select('reference amount status');

    res.status(200).json({ 
      success: true, 
      data: {
        order: {
          id: order._id,
          orderReference: order.orderReference,
          recipientNumber: order.recipientNumber,
          bundleType: order.bundleType,
          capacity: order.capacity,
          price: order.price,
          status: order.status,
          createdAt: order.createdAt,
          completedAt: order.completedAt,
          failureReason: order.failureReason
        },
        transaction: transaction ? {
          reference: transaction.reference,
          amount: transaction.amount,
          status: transaction.status
        } : null
      }
    });
  } catch (error) {
    console.error('Error fetching order by reference:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
});

module.exports = router;