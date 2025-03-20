// routes/orders.js
const express = require('express');
const axios = require('axios');

const router = express.Router();
const { Order, Bundle, User, Transaction } = require('../schema/schema');
const auth = require('../AuthMiddle/middlewareauth.js'); // Authentication middleware
const adminAuth = require('../adminMiddlware/middleware.js'); // Admin authentication middleware
const mongoose = require('mongoose');
const ARKESEL_API_KEY = 'QkNhS0l2ZUZNeUdweEtmYVRUREg';

const sendSMS = async (phoneNumber, message, options = {}) => {
  const {
    scheduleTime = null,
    useCase = null,
    senderID = 'DataHubGh'
  } = options;

  // Input validation
  if (!phoneNumber || !message) {
    throw new Error('Phone number and message are required');
  }

  // Base parameters
  const params = {
    action: 'send-sms',
    api_key: ARKESEL_API_KEY,
    to: phoneNumber,
    from: senderID,
    sms: message
  };

  // Add optional parameters
  if (scheduleTime) {
    params.schedule = scheduleTime;
  }

  if (useCase && ['promotional', 'transactional'].includes(useCase)) {
    params.use_case = useCase;
  }

  // Add Nigerian use case if phone number starts with 234
  if (phoneNumber.startsWith('234') && !useCase) {
    params.use_case = 'transactional';
  }

  try {
    const response = await axios.get('https://sms.arkesel.com/sms/api', {
      params,
      timeout: 10000 // 10 second timeout
    });

    // Map error codes to meaningful messages
    const errorCodes = {
      '100': 'Bad gateway request',
      '101': 'Wrong action',
      '102': 'Authentication failed',
      '103': 'Invalid phone number',
      '104': 'Phone coverage not active',
      '105': 'Insufficient balance',
      '106': 'Invalid Sender ID',
      '109': 'Invalid Schedule Time',
      '111': 'SMS contains spam word. Wait for approval'
    };

    if (response.data.code !== 'ok') {
      const errorMessage = errorCodes[response.data.code] || 'Unknown error occurred';
      throw new Error(`SMS sending failed: ${errorMessage}`);
    }

    console.log('SMS sent successfully:', {
      to: phoneNumber,
      status: response.data.code,
      balance: response.data.balance,
      mainBalance: response.data.main_balance
    });

    return {
      success: true,
      data: response.data
    };

  } catch (error) {
    // Handle specific error types
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error('SMS API responded with error:', {
        status: error.response.status,
        data: error.response.data
      });
    } else if (error.request) {
      // The request was made but no response was received
      console.error('No response received from SMS API:', error.message);
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error('SMS request setup error:', error.message);
    }

    // Instead of swallowing the error, return error details
    return {
      success: false,
      error: {
        message: error.message,
        code: error.response?.data?.code,
        details: error.response?.data
      }
    };
  }
};
/**
 * @route   GET /api/orders/my-orders
 * @desc    Get all orders for the logged-in user
 * @access  Private
 */
router.get('/my-orders', auth, async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user.id })
      // .populate('bundle', 'capacity price type')
      .sort({ createdAt: -1 });
    
    if (!orders.length) {
      return res.status(200).json({ 
        success: true, 
        message: 'No orders found', 
        data: [] 
      });
    }

    res.status(200).json({ 
      success: true, 
      count: orders.length, 
      data: orders 
    });
  } catch (error) {
    console.error('Error fetching user orders:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
});



router.get('/all', adminAuth, async (req, res) => {
  try {
    // Pagination parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    // Filtering options
    const filter = {};
    
    if (req.query.status) {
      filter.status = req.query.status;
    }
    
    if (req.query.bundleType) {
      // First find bundles of this type
      const bundles = await Bundle.find({ type: req.query.bundleType }).select('_id');
      const bundleIds = bundles.map(bundle => bundle._id);
      filter.bundle = { $in: bundleIds };
    }
    
    if (req.query.userId) {
      filter.user = req.query.userId;
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
      // .populate('bundle', 'name capacity price type')
      .populate('user', 'username email phone')
      // .populate('processedBy', 'username')
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
    console.error('Error fetching all orders:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
});

/**
 * @route   GET /api/orders/:id
 * @desc    Get specific order details (admin access)
 * @access  Admin
 */
router.get('/:id', adminAuth, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('bundle', 'name capacity price type')
      .populate('user', 'username email phone')
      .populate('processedBy', 'username');

    if (!order) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found' 
      });
    }

    res.status(200).json({ 
      success: true, 
      data: order 
    });
  } catch (error) {
    console.error('Error fetching order details:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
});

/**
 * @route   GET /api/orders/user/:userId
 * @desc    Get all orders for a specific user (admin access)
 * @access  Admin
 */
router.get('/user/:userId', adminAuth, async (req, res) => {
  try {
    // Verify user exists
    const userExists = await User.exists({ _id: req.params.userId });
    
    if (!userExists) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }
    
    const orders = await Order.find({ user: req.params.userId })
      .populate('bundle', 'name capacity price type')
      .sort({ createdAt: -1 });
    
    res.status(200).json({ 
      success: true, 
      count: orders.length, 
      data: orders 
    });
  } catch (error) {
    console.error('Error fetching user orders:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
});

/**
 * @route   PUT /api/orders/:id/status
 * @desc    Update order status (admin access)
 * @access  Admin
 */
/**
 * @route   PUT /api/orders/:id/status
 * @desc    Update order status (admin access)
 * @access  Admin
 */
router.put('/:id/status', adminAuth, async (req, res) => {
  try {
    const { status } = req.body;
    
    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status is required'
      });
    }
    
    const validStatuses = ['pending', 'processing', 'completed', 'failed', 'refunded'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status value'
      });
    }
    
    // Find the order first to get previous status and recipient info
    const order = await Order.findById(req.params.id).populate('user');
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }
    
    const previousStatus = order.status;
    
    // Process refund if status is being changed to refunded
  // Process refund if status is being changed to refunded
if (status === 'refunded' && previousStatus !== 'refunded') {
  try {
    // Find the user and update their account balance
    const user = await User.findById(order.user._id);
    if (user && user.wallet) {
      // Add the refund amount to the user's wallet balance
      user.wallet.balance += order.price;
      await user.save();
      
      console.log(`Refunded ${order.price} to user ${user._id} for order ${order._id}`);
    } else {
      console.error(`User not found or wallet not initialized for refund: ${order.user._id}`);
    }
  } catch (refundError) {
    console.error('Error processing refund:', refundError.message);
    // You might want to handle this differently, maybe even prevent the status change
  }
}
    
    // Update the order
    order.status = status;
    order.processedBy = req.user.id;
    order.updatedAt = Date.now();
    await order.save();
    
    // Send SMS notifications based on status change
    try {
      // Format phone number for SMS - remove the '+' prefix
      const formatPhoneForSms = (phone) => {
        // Remove the '+' if it exists
        return phone.replace(/^\+233/, '');
      };
      
      // Get recipient's phone number from the order and format it
      const recipientPhone = formatPhoneForSms(order.recipientNumber);
      
      if (status === 'completed' && previousStatus !== 'completed') {
        // Send completion SMS
        const completionMessage = `${order.capacity}MB has been sent to ${order.recipientNumber}              
        iGet
        `;
        
        await sendSMS(recipientPhone, completionMessage, {
          useCase: 'transactional',
          senderID: 'DataHubGh'
        });
        
        console.log(`Completion SMS sent to ${recipientPhone} for order ${order._id}`);
      } 
      else if (status === 'failed' || status === 'refunded') {
        // Send refund SMS to the user who placed the order
        if (order.user && order.user.phone) {
          const userPhone = formatPhoneForSms(order.user.phone);
          const refundMessage = `Your order for ${order.capacity}GB on ${order.bundleType} could not be processed. Your account has been refunded. Order reference: ${order.orderReference}`;
          
          await sendSMS(userPhone, refundMessage, {
            useCase: 'transactional',
            senderID: 'DataHubGh'
          });
          
          console.log(`Refund SMS sent to ${userPhone} for order ${order._id}`);
        }
      }
    } catch (smsError) {
      // Log SMS error but continue with response
      console.error('Failed to send status update SMS:', smsError.message);
    }
    
    res.status(200).json({
      success: true,
      message: 'Order status updated successfully',
      data: order
    });
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});
// Add this to routes/orders.js

/**
 * @route   GET /api/orders/trends/weekly
 * @desc    Get order trends by day of week
 * @access  Admin
 */
router.get('/trends/weekly', adminAuth, async (req, res) => {
  try {
    // Parse query parameters for date filtering
    const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Default to last 30 days
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();
    
    // Add time to end date to include the entire day
    endDate.setHours(23, 59, 59, 999);
    
    // Filter by user if provided
    const matchQuery = {
      createdAt: { $gte: startDate, $lte: endDate }
    };
    
    if (req.query.userId) {
      matchQuery.user = req.query.userId;
    }
    
    // Aggregate to get orders by day of week
    const ordersByDay = await Order.aggregate([
      { $match: matchQuery },
      {
        $addFields: {
          // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
          dayOfWeek: { $dayOfWeek: "$createdAt" }
        }
      },
      {
        $group: {
          _id: "$dayOfWeek",
          count: { $sum: 1 },
          totalAmount: { $sum: "$totalAmount" },
          orders: { $push: "$$ROOT" }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    // Transform data to be more readable
    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    // Create a complete dataset with all days of the week
    const completeData = daysOfWeek.map((day, index) => {
      // Find if we have data for this day (note: MongoDB's $dayOfWeek is 1-based with Sunday as 1)
      const dayData = ordersByDay.find(item => item._id === index + 1);
      
      return {
        day,
        dayIndex: index,
        count: dayData ? dayData.count : 0,
        totalAmount: dayData ? dayData.totalAmount : 0,
        percentage: 0 // Will calculate below
      };
    });
    
    // Calculate total orders to compute percentages
    const totalOrders = completeData.reduce((sum, item) => sum + item.count, 0);
    
    // Add percentage information
    completeData.forEach(item => {
      item.percentage = totalOrders > 0 ? ((item.count / totalOrders) * 100).toFixed(2) : 0;
    });
    
    // Find the day with the highest order count (trend)
    let highestOrderDay = completeData[0];
    completeData.forEach(item => {
      if (item.count > highestOrderDay.count) {
        highestOrderDay = item;
      }
    });
    
    // Calculate the average orders per day
    const averageOrdersPerDay = totalOrders / 7;
    
    // Calculate variance from average for each day (how much higher/lower than average)
    completeData.forEach(item => {
      item.varianceFromAverage = averageOrdersPerDay > 0 
        ? ((item.count - averageOrdersPerDay) / averageOrdersPerDay * 100).toFixed(2) 
        : 0;
    });
    
    // Return the trends data
    res.status(200).json({
      success: true,
      data: {
        trends: completeData,
        totalOrders,
        averageOrdersPerDay: averageOrdersPerDay.toFixed(2),
        highestOrderDay: highestOrderDay.day,
        dateRange: {
          from: startDate.toISOString().split('T')[0],
          to: endDate.toISOString().split('T')[0]
        }
      }
    });
  } catch (error) {
    console.error('Error analyzing weekly order trends:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
});

/**
 * @route   GET /api/orders/trends/user-weekly/:userId
 * @desc    Get order trends by day of week for a specific user
 * @access  Private
 */
router.get('/trends/user-weekly', auth, async (req, res) => {
  try {
    // Parse query parameters for date filtering
    const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // Default to last 90 days
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();
    
    // Add time to end date to include the entire day
    endDate.setHours(23, 59, 59, 999);
    
    // Get the current user's orders by day of week
    const ordersByDay = await Order.aggregate([
      { 
        $match: {
          user: req.user.id,
          createdAt: { $gte: startDate, $lte: endDate }
        } 
      },
      {
        $addFields: {
          dayOfWeek: { $dayOfWeek: "$createdAt" }
        }
      },
      {
        $group: {
          _id: "$dayOfWeek",
          count: { $sum: 1 },
          totalAmount: { $sum: "$totalAmount" }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    // Transform data to be more readable
    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    // Create a complete dataset with all days of the week
    const completeData = daysOfWeek.map((day, index) => {
      // Find if we have data for this day (note: MongoDB's $dayOfWeek is 1-based with Sunday as 1)
      const dayData = ordersByDay.find(item => item._id === index + 1);
      
      return {
        day,
        dayIndex: index,
        count: dayData ? dayData.count : 0,
        totalAmount: dayData ? dayData.totalAmount : 0,
        percentage: 0 // Will calculate below
      };
    });
    
    // Calculate total orders to compute percentages
    const totalOrders = completeData.reduce((sum, item) => sum + item.count, 0);
    
    // Add percentage information
    completeData.forEach(item => {
      item.percentage = totalOrders > 0 ? ((item.count / totalOrders) * 100).toFixed(2) : 0;
    });
    
    // Find preferred ordering day
    let preferredOrderDay = completeData[0];
    completeData.forEach(item => {
      if (item.count > preferredOrderDay.count) {
        preferredOrderDay = item;
      }
    });
    
    // Return the user's ordering patterns
    res.status(200).json({
      success: true,
      data: {
        orderPattern: completeData,
        totalOrders,
        preferredOrderDay: preferredOrderDay.day,
        preferredOrderDayPercentage: preferredOrderDay.percentage,
        dateRange: {
          from: startDate.toISOString().split('T')[0],
          to: endDate.toISOString().split('T')[0]
        }
      }
    });
  } catch (error) {
    console.error('Error analyzing user weekly order trends:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
});


/**
 * @route   POST /api/orders
 * @desc    Place an order and deduct from user wallet
 * @access  Private
 */
/**
 * @route   POST /api/orders
 * @desc    Place an order and deduct from user wallet
 * @access  Private
 */
router.post('/placeorder', auth, async (req, res) => {
  try {
    const { recipientNumber, capacity, price, bundleType } = req.body;
    
    // Validate required fields
    if (!recipientNumber || !capacity || !price || !bundleType) {
      return res.status(400).json({
        success: false,
        message: 'Recipient number, capacity, price, and bundle type are all required'
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
        // orderReference will be generated by the pre-save hook
      });
      
      await newOrder.save({ session });
      
      // Create transaction record
      const transaction = new Transaction({
        user: req.user.id,
        type: 'purchase',
        amount: price,
        currency: user.wallet.currency,
        description: `Bundle purchase: ${capacity}MB for ${recipientNumber}`,
        status: 'completed',
        reference: 'TXN-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
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
            price: newOrder.price,
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
    console.error('Error placing order:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});


module.exports = router;