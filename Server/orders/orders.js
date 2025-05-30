// routes/orders.js - Updated with proper model imports and Editor-only order status updates
const express = require('express');
const axios = require('axios');
const router = express.Router();
const mongoose = require('mongoose');

// Import models directly - more reliable approach
const { Order, Bundle, User, Transaction } = require('../schema/schema');
const AdminSettings = require('../AdminSettingSchema/AdminSettings.js');

// Import middleware
const auth = require('../AuthMiddle/middlewareauth.js');
const adminAuth = require('../adminMiddlware/middleware.js');

const ARKESEL_API_KEY = 'OnFqOUpMZXYyVGRGZHJWMmo=';

// Middleware for Editor-only actions
const requireEditor = (req, res, next) => {
  console.log('📝 RequireEditor middleware - checking user role:', req.user?.role);
  
  if (!req.user || !['admin', 'Editor'].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: 'Editor privileges required for order status updates',
      yourRole: req.user?.role,
      allowedRoles: ['admin', 'Editor'],
      note: 'Only Editors and Full Admins can update order statuses'
    });
  }
  
  console.log('✅ RequireEditor: User authorized for order status updates');
  next();
};

// Enhanced database and model validation middleware
const validateModelsAndDb = (req, res, next) => {
  // Check database connection
  if (mongoose.connection.readyState !== 1) {
    console.error('Database connection error - readyState:', mongoose.connection.readyState);
    return res.status(500).json({
      success: false,
      message: 'Database connection error',
      error: 'Database is not connected'
    });
  }

  // Check if models are properly imported and initialized
  if (!Order) {
    console.error('Order model is not imported or undefined');
    return res.status(500).json({
      success: false,
      message: 'Order model initialization error',
      error: 'Order model is not properly loaded'
    });
  }

  // Check if Order model has required methods
  if (typeof Order.find !== 'function' || typeof Order.countDocuments !== 'function') {
    console.error('Order model methods are not available:', {
      hasFind: typeof Order.find === 'function',
      hasCountDocuments: typeof Order.countDocuments === 'function'
    });
    return res.status(500).json({
      success: false,
      message: 'Order model methods error',
      error: 'Required Order model methods are not available'
    });
  }

  console.log('✅ Models and database validation passed');
  next();
};

// SMS sending function
const sendSMS = async (phoneNumber, message, options = {}) => {
  const {
    scheduleTime = null,
    useCase = null,
    senderID = 'EL VENDER'
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
      console.error('SMS API responded with error:', {
        status: error.response.status,
        data: error.response.data
      });
    } else if (error.request) {
      console.error('No response received from SMS API:', error.message);
    } else {
      console.error('SMS request setup error:', error.message);
    }

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

// POST place order (user endpoint)
router.post('/placeord', auth, validateModelsAndDb, async (req, res) => {
  try {
    const { recipientNumber, capacity, price, bundleType } = req.body;
    
    // Validate required fields
    if (!recipientNumber || !capacity || !price) {
      return res.status(400).json({
        success: false,
        message: 'Recipient number, capacity, and price are all required'
      });
    }
    
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
    
    // Create or find a bundle
    let bundle = await Bundle.findOne({ 
      capacity: capacity,
      price: price,
      type: bundleType || 'other'
    });
    
    if (!bundle) {
      bundle = new Bundle({
        capacity: capacity,
        price: price,
        type: bundleType || 'other'
      });
      await bundle.save();
    }
    
    // Start a session for the transaction
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      // Create new order matching the schema exactly
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
        message: 'Order placed successfully and awaiting Editor approval',
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
          walletBalance: user.wallet.balance,
          note: 'Your order is pending and will be processed by our Editors'
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

// GET user's orders
router.get('/my-orders', auth, validateModelsAndDb, async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user.id })
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

// GET all orders (admin access - ALL ADMIN TYPES including Editor can view orders)
router.get('/all', adminAuth, validateModelsAndDb, async (req, res) => {
  try {
    console.log('📋 Fetching all orders for admin:', req.user.username, 'Role:', req.user.role);
    
    // Pagination parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    console.log('📄 Pagination params:', { page, limit, skip });
    
    // Filtering options
    const filter = {};
    
    if (req.query.status) {
      filter.status = req.query.status;
      console.log('🔍 Filtering by status:', req.query.status);
    }
    
    if (req.query.bundleType) {
      filter.bundleType = req.query.bundleType;
      console.log('🔍 Filtering by bundleType:', req.query.bundleType);
    }
    
    if (req.query.userId) {
      filter.user = req.query.userId;
      console.log('🔍 Filtering by userId:', req.query.userId);
    }
    
    // Date range filtering
    if (req.query.startDate && req.query.endDate) {
      filter.createdAt = {
        $gte: new Date(req.query.startDate),
        $lte: new Date(req.query.endDate)
      };
      console.log('🔍 Filtering by date range:', filter.createdAt);
    }
    
    console.log('🔍 Final filter object:', filter);
    
    // Get total count for pagination
    let total = 0;
    try {
      console.log('📊 Attempting to count documents...');
      total = await Order.countDocuments(filter);
      console.log('📊 Total documents count:', total);
    } catch (countError) {
      console.error('❌ Error counting documents:', countError.message);
      console.log('🔄 Falling back to manual count...');
      
      try {
        const allOrders = await Order.find(filter).select('_id');
        total = allOrders.length;
        console.log('📊 Manual count result:', total);
      } catch (fallbackError) {
        console.error('❌ Fallback count also failed:', fallbackError.message);
        total = 0;
      }
    }
    
    // Get orders with pagination
    console.log('📋 Fetching orders with pagination...');
    const orders = await Order.find(filter)
      .populate('user', 'username email phone')
      .populate('processedBy', 'username role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
    
    console.log('📋 Orders fetched successfully. Count:', orders.length);
    
    // Add role-specific information to response
    const responseData = {
      success: true,
      count: orders.length,
      total,
      pages: Math.ceil(total / limit),
      currentPage: page,
      data: orders,
      accessedBy: {
        adminId: req.user._id,
        adminUsername: req.user.username,
        adminRole: req.user.role,
        timestamp: new Date()
      },
      permissions: {
        canUpdateOrderStatus: ['admin', 'Editor'].includes(req.user.role),
        canViewAllOrders: true,
        isEditor: req.user.role === 'Editor',
        isWalletAdmin: req.user.role === 'wallet_admin'
      },
      debug: {
        modelCheck: 'Order model is available',
        dbConnection: 'Connected',
        filterApplied: filter
      }
    };
    
    // Add role-specific note
    if (req.user.role === 'Editor') {
      responseData.editorNote = 'You can update order statuses. Click on any order to change its status.';
    } else if (req.user.role === 'wallet_admin') {
      responseData.walletAdminNote = 'You can view orders but cannot update their status. Contact an Editor for status updates.';
    }
    
    console.log('✅ Sending successful response with', orders.length, 'orders');
    res.status(200).json(responseData);
    
  } catch (error) {
    console.error('❌ Error fetching all orders:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message,
      details: 'Failed to fetch orders. Please check database connection and model initialization.',
      debug: {
        errorStack: error.stack,
        modelAvailable: !!Order,
        dbState: mongoose.connection.readyState
      }
    });
  }
});

// GET specific order details (admin access)
router.get('/:id', adminAuth, validateModelsAndDb, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('user', 'username email phone')
      .populate('processedBy', 'username role');

    if (!order) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found' 
      });
    }

    res.status(200).json({ 
      success: true, 
      data: order,
      permissions: {
        canUpdateStatus: ['admin', 'Editor'].includes(req.user.role),
        viewerRole: req.user.role,
        viewerUsername: req.user.username
      }
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

// GET orders for specific user (admin access)
router.get('/user/:userId', adminAuth, validateModelsAndDb, async (req, res) => {
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
      .populate('processedBy', 'username role')
      .sort({ createdAt: -1 });
    
    res.status(200).json({ 
      success: true, 
      count: orders.length, 
      data: orders,
      permissions: {
        canUpdateOrderStatus: ['admin', 'Editor'].includes(req.user.role),
        viewerRole: req.user.role
      }
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
 * @desc    Update order status (EDITOR ROLE ONLY)
 * @access  Editor/Admin
 */
router.put('/:id/status', adminAuth, requireEditor, validateModelsAndDb, async (req, res) => {
  try {
    const { status, senderID = 'EL VENDER', sendSMSNotification = true, failureReason } = req.body;
    
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
        message: 'Invalid status value',
        validStatuses: validStatuses
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
    
    // Prevent unnecessary status changes
    if (previousStatus === status) {
      return res.status(400).json({
        success: false,
        message: `Order is already in ${status} status`
      });
    }
    
    // Process refund if status is being changed to refunded
    if (status === 'refunded' && previousStatus !== 'refunded') {
      try {
        // Find the user and update their account balance
        const user = await User.findById(order.user._id);
        if (user && user.wallet) {
          // Add the refund amount to the user's wallet balance
          user.wallet.balance += order.price;
          await user.save();
          
          console.log(`Refunded ${order.price} to user ${user._id} for order ${order._id} by Editor ${req.user.username}`);
        } else {
          console.error(`User not found or wallet not initialized for refund: ${order.user._id}`);
        }
      } catch (refundError) {
        console.error('Error processing refund:', refundError.message);
        return res.status(500).json({
          success: false,
          message: 'Error processing refund',
          error: refundError.message
        });
      }
    }
    
    // Update the order with Editor information
    order.status = status;
    order.processedBy = req.user.id;
    order.updatedAt = Date.now();
    
    // Add comprehensive Editor tracking
    order.editorInfo = {
      editorId: req.user._id,
      editorUsername: req.user.username,
      editorRole: req.user.role,
      previousStatus: previousStatus,
      newStatus: status,
      statusChangedAt: new Date(),
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      failureReason: failureReason || null
    };
    
    // Set completed date if status is now completed
    if (status === 'completed' && previousStatus !== 'completed') {
      order.completedAt = new Date();
    }
    
    // Set failure reason if provided
    if ((status === 'failed' || status === 'refunded') && failureReason) {
      order.failureReason = failureReason;
    }
    
    await order.save();
    
    // Send SMS notifications based on status change only if sendSMSNotification is true
    let smsResult = null;
    if (sendSMSNotification) {
      try {
        // Format phone number for SMS - remove the '+' prefix
        const formatPhoneForSms = (phone) => {
          return phone.replace(/^\+233/, '');
        };
        
        // Get the user's phone who placed the order
        if (order.user && order.user.phone) {
          const userPhone = formatPhoneForSms(order.user.phone);
          
          if (status === 'completed' && previousStatus !== 'completed') {
            // Determine which SMS template to use based on bundleType
            let completionMessage = '';
            
            switch(order.bundleType?.toLowerCase()) {
              case 'mtnup2u':
                const dataAmount = order.capacity >= 1000 ? `${order.capacity/1000}GB` : `${order.capacity}GB`;
                completionMessage = `${dataAmount} has been credited to ${order.recipientNumber} and is valid for 3 months.`;
                break;
              case 'telecel-5959':
                const dataSizeGB = order.capacity >= 1000 ? `${order.capacity/1000}GB` : `${order.capacity}GB`;
                completionMessage = `${dataSizeGB} has been allocated to ${order.recipientNumber} and is valid for 2 months.`;
                break;
              default:
                const dataSize = order.capacity >= 1000 ? `${order.capacity/1000}GB` : `${order.capacity}GB`;
                completionMessage = `${dataSize} has been sent to ${order.recipientNumber}.\niGet`;
                break;
            }
            
            smsResult = await sendSMS(userPhone, completionMessage, {
              useCase: 'transactional',
              senderID: senderID
            });
            
            if (smsResult.success) {
              console.log(`Completion SMS sent by Editor ${req.user.username} to user ${userPhone} for order ${order._id} using ${order.bundleType} template with senderID: ${senderID}`);
            } else {
              console.error(`Failed to send completion SMS: ${smsResult.error?.message || 'Unknown error'}`);
            }
          } 
          else if (status === 'failed' || status === 'refunded') {
            let refundMessage = '';
            
            // Handle AFA-registration bundle type differently
            if (order.bundleType && order.bundleType.toLowerCase() === 'afa-registration') {
              refundMessage = `Your AFA registration has been cancelled. The amount has been reversed to your iGet balance. Kindly check your iGet balance to confirm.\niGet`;
            } else {
              const dataSize = order.capacity >= 1000 ? `${order.capacity/1000}GB` : `${order.capacity}GB`;
              refundMessage = `Your ${dataSize} order to ${order.recipientNumber} failed. The amount has been reversed to your iGet balance. Kindly check your iGet balance to confirm.\niGet`;
            }
            
            smsResult = await sendSMS(userPhone, refundMessage, {
              useCase: 'transactional',
              senderID: senderID
            });
            
            if (smsResult.success) {
              console.log(`Refund SMS sent by Editor ${req.user.username} to user ${userPhone} for order ${order._id} (${order.bundleType}) with senderID: ${senderID}`);
            } else {
              console.error(`Failed to send refund SMS: ${smsResult.error?.message || 'Unknown error'}`);
            }
          }
        } else {
          console.error(`User not found or phone number missing for order ${order._id}`);
        }
      } catch (smsError) {
        console.error('Failed to send status update SMS:', smsError.message);
        smsResult = { success: false, error: { message: smsError.message } };
      }
    } else {
      console.log(`SMS notification skipped for order ${order._id} status update to ${status} by Editor ${req.user.username} (sendSMSNotification=${sendSMSNotification})`);
    }
    
    res.status(200).json({
      success: true,
      message: `Order status updated successfully${sendSMSNotification ? ' with SMS notification' : ' without SMS notification'}`,
      data: order,
      updatedBy: {
        editorId: req.user._id,
        editorUsername: req.user.username,
        editorRole: req.user.role,
        timestamp: new Date(),
        ipAddress: req.ip
      },
      statusChange: {
        from: previousStatus,
        to: status,
        changedAt: new Date(),
        reason: failureReason || null
      },
      smsNotification: sendSMSNotification ? {
        attempted: true,
        success: smsResult?.success || false,
        error: smsResult?.error?.message || null
      } : {
        attempted: false
      }
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

// GET weekly trends (admin access)
router.get('/trends/weekly', adminAuth, validateModelsAndDb, async (req, res) => {
  try {
    // Parse query parameters for date filtering
    const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
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
          dayOfWeek: { $dayOfWeek: "$createdAt" }
        }
      },
      {
        $group: {
          _id: "$dayOfWeek",
          count: { $sum: 1 },
          totalAmount: { $sum: "$price" },
          orders: { $push: "$ROOT" }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    // Transform data to be more readable
    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    // Create a complete dataset with all days of the week
    const completeData = daysOfWeek.map((day, index) => {
      const dayData = ordersByDay.find(item => item._id === index + 1);
      
      return {
        day,
        dayIndex: index,
        count: dayData ? dayData.count : 0,
        totalAmount: dayData ? dayData.totalAmount : 0,
        percentage: 0
      };
    });
    
    // Calculate total orders to compute percentages
    const totalOrders = completeData.reduce((sum, item) => sum + item.count, 0);
    
    // Add percentage information
    completeData.forEach(item => {
      item.percentage = totalOrders > 0 ? ((item.count / totalOrders) * 100).toFixed(2) : 0;
    });
    
    // Find the day with the highest order count
    let highestOrderDay = completeData[0];
    completeData.forEach(item => {
      if (item.count > highestOrderDay.count) {
        highestOrderDay = item;
      }
    });
    
    // Calculate the average orders per day
    const averageOrdersPerDay = totalOrders / 7;
    
    // Calculate variance from average for each day
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

// POST place order (main endpoint with API integration)
router.post('/placeorder', auth, validateModelsAndDb, async (req, res) => {
  try {
    const { recipientNumber, capacity, price, bundleType } = req.body;
    
    // Validate required fields
    if (!recipientNumber || !capacity || !price || !bundleType) {
      return res.status(400).json({
        success: false,
        message: 'Recipient number, capacity, price, and bundle type are all required'
      });
    }
    
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
    
    // Get admin settings to check if API integrations are enabled
    let adminSettings;
    try {
      adminSettings = await AdminSettings.getSettings();
    } catch (settingsError) {
      console.error('Error fetching admin settings:', settingsError);
      // Continue with default settings if AdminSettings fails
      adminSettings = { apiIntegrations: {} };
    }
    
    // Start a session for the transaction
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      // Create new order - initially with 'pending' status
      const newOrder = new Order({
        user: req.user.id,
        bundleType: bundleType,
        capacity: capacity,
        price: price,
        recipientNumber: recipientNumber,
        status: 'pending',
        updatedAt: Date.now()
      });
      
      // Generate order reference
      const orderReference = Math.floor(1000 + Math.random() * 900000);
      newOrder.orderReference = orderReference.toString();
      
      // For mtnup2u bundle types, check if API is enabled
      if (bundleType.toLowerCase() === 'mtnup2u') {
        // Check if MTN Hubnet API integration is enabled
        const mtnApiEnabled = adminSettings.apiIntegrations?.mtnHubnetEnabled !== false; // Default to true if setting doesn't exist
        
        if (mtnApiEnabled) {
          try {
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
            
            // Make request to Hubnet API
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
            
            // Set status to pending for Editor approval
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
        } else {
          // API is disabled, set order to pending for manual processing
          console.log('MTN Hubnet API integration is disabled. Order set to pending for manual processing.');
          newOrder.status = 'pending';
          newOrder.apiReference = null;
          newOrder.hubnetReference = null;
        }
      }
      // For AT-ishare bundle type, check if API is enabled
      else if (bundleType.toLowerCase() === 'at-ishare') {
        // Check if AT Hubnet API integration is enabled
        const atApiEnabled = adminSettings.apiIntegrations?.atHubnetEnabled !== false; // Default to true if setting doesn't exist
        
        if (atApiEnabled) {
          try {
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
            
            // Set status to pending for Editor approval
            newOrder.status = 'pending';
            
            console.log(`Hubnet AT order placed successfully: ${orderReference}`);
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
        } else {
          // API is disabled, set order to pending for manual processing
          console.log('AT Hubnet API integration is disabled. Order set to pending for manual processing.');
          newOrder.status = 'pending';
          newOrder.apiReference = null;
          newOrder.hubnetReference = null;
        }
      }
      // For other bundle types, continue with normal processing
      else {
        // Other bundle types don't use API, so they'll remain in pending status
        console.log(`Order for bundle type ${bundleType} set to pending for Editor processing.`);
      }
      
      // Only proceed with saving order and processing payment
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
        message: 'Order placed successfully and awaiting Editor approval',
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
          walletBalance: user.wallet.balance,
          note: 'Your order is pending and will be processed by our Editors'
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

// GET today's orders and revenue for admin
router.get('/today/admin', adminAuth, validateModelsAndDb, async (req, res) => {
  try {
    // Get today's date at 00:00:00
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    
    // Get end of today at 23:59:59
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    
    // Find all orders made today
    const todayOrders = await Order.find({
      createdAt: { $gte: startOfDay, $lte: endOfDay }
    })
      .populate('user', 'username email phone')
      .populate('processedBy', 'username role')
      .sort({ createdAt: -1 });
    
    // Calculate today's total revenue
    const todayRevenue = todayOrders.reduce((total, order) => {
      return total + (order.price || 0);
    }, 0);
    
    // Get breakdown by bundle type
    const bundleTypeBreakdown = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startOfDay, $lte: endOfDay }
        }
      },
      {
        $group: {
          _id: "$bundleType",
          count: { $sum: 1 },
          revenue: { $sum: "$price" }
        }
      },
      {
        $sort: { revenue: -1 }
      }
    ]);
    
    // Get unique users who placed orders today
    const uniqueUsers = new Set(todayOrders.map(order => order.user._id.toString())).size;
    
    // Get status breakdown
    const statusBreakdown = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startOfDay, $lte: endOfDay }
        }
      },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        }
      }
    ]);
    
    res.status(200).json({
      success: true,
      data: {
        todayOrdersCount: todayOrders.length,
        todayRevenue,
        uniqueUsers,
        bundleTypeBreakdown,
        statusBreakdown,
        todayOrders,
        date: startOfDay.toISOString().split('T')[0]
      },
      permissions: {
        canUpdateOrderStatus: ['admin', 'Editor'].includes(req.user.role),
        viewerRole: req.user.role
      }
    });
  } catch (error) {
    console.error('Error fetching today\'s orders and revenue for admin:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// Bulk purchase endpoint
router.post('/bulk-purchase', auth, validateModelsAndDb, async (req, res) => {
  // Start a mongoose session for transaction
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { networkKey, orders } = req.body;
    
    // Validate request
    if (!networkKey || !orders || !Array.isArray(orders) || orders.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request format. Network key and orders array are required.'
      });
    }
    
    if (orders.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Maximum of 100 orders allowed in a single bulk request'
      });
    }
    
    // Get user for wallet balance check
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Process orders (keeping the existing bulk purchase logic)
    const results = {
      successful: 0,
      failed: 0,
      totalAmount: 0,
      orders: []
    };
    
    // Create a bulk transaction reference
    const bulkTransactionReference = new mongoose.Types.ObjectId().toString();
    
    // Process each order with Editor approval requirement
    for (const orderData of orders) {
      try {
        // Generate a reference number
        const prefix = "order";
        const numbers = Math.floor(100000 + Math.random() * 900000).toString();
        const reference = `${prefix}${numbers}`;
        
        // Create order set to pending for Editor approval
        const order = new Order({
          user: user._id,
          bundleType: orderData.bundleType || 'bulk',
          capacity: parseFloat(orderData.capacity),
          price: orderData.price,
          recipientNumber: orderData.recipient,
          status: 'pending', // All bulk orders need Editor approval
          orderReference: reference,
          metadata: {
            userBalance: user.wallet.balance,
            orderTime: new Date(),
            isBulkOrder: true,
            bulkTransactionReference
          }
        });

        await order.save({ session });
        
        results.successful++;
        results.totalAmount += orderData.price;
        
        // Add to results
        results.orders.push({
          recipient: orderData.recipient,
          capacity: orderData.capacity,
          price: orderData.price,
          status: 'pending',
          reference: reference,
          note: 'Awaiting Editor approval'
        });
        
      } catch (orderError) {
        console.error(`Error processing individual order in bulk purchase:`, orderError);
        
        // Add failed order to results
        results.failed++;
        results.orders.push({
          recipient: orderData.recipient,
          capacity: orderData.capacity,
          price: orderData.price,
          status: 'failed',
          error: orderError.message
        });
      }
    }
    
    // If at least one order was successful, deduct the total amount from wallet
    if (results.successful > 0) {
      // Create a bulk transaction record
      const transaction = new Transaction({
        user: user._id,
        type: 'purchase',
        amount: results.totalAmount,
        currency: user.wallet.currency,
        description: `Bulk purchase: ${results.successful} data bundles`,
        status: 'completed',
        reference: bulkTransactionReference,
        balanceBefore: user.wallet.balance,
        balanceAfter: user.wallet.balance - results.totalAmount,
        paymentMethod: 'wallet'
      });
      
      await transaction.save({ session });
      
      // Update user balance
      user.wallet.balance -= results.totalAmount;
      user.wallet.transactions.push(transaction._id);
      await user.save({ session });
    }
    
    // Commit the transaction
    await session.commitTransaction();
    
    // Return results
    res.status(200).json({
      success: true,
      message: `Bulk purchase processed: ${results.successful} orders created and awaiting Editor approval, ${results.failed} failed`,
      data: {
        totalOrders: orders.length,
        successful: results.successful,
        failed: results.failed,
        totalAmount: results.totalAmount,
        newBalance: user.wallet.balance,
        orders: results.orders,
        note: 'All orders are pending and require Editor approval before processing'
      }
    });
    
  } catch (error) {
    // Abort transaction on error
    await session.abortTransaction();
    
    console.error('Bulk purchase error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error processing bulk purchase',
      error: error.message
    });
  } finally {
    session.endSession();
  }
});

module.exports = router;