// routes/orders.js - Updated with bulk status endpoint
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

// Helper function to generate SMS message based on order status and type
const generateSMSMessage = (order, status, bundleType) => {
  const formatDataSize = (capacity) => {
    return capacity >= 1000 ? `${capacity/1000}GB` : `${capacity}GB`;
  };
  
  if (status === 'completed') {
    switch(bundleType?.toLowerCase()) {
      case 'mtnup2u':
        return `${formatDataSize(order.capacity)} has been credited to ${order.recipientNumber} and is valid for 3 months.`;
      case 'telecel-5959':
        return `${formatDataSize(order.capacity)} has been allocated to ${order.recipientNumber} and is valid for 2 months.`;
      default:
        return `${formatDataSize(order.capacity)} has been sent to ${order.recipientNumber}.\niGet`;
    }
  } else if (status === 'failed' || status === 'refunded') {
    if (bundleType?.toLowerCase() === 'afa-registration') {
      return `Your AFA registration has been cancelled. The amount has been reversed to your iGet balance. Kindly check your iGet balance to confirm.\niGet`;
    } else {
      return `Your ${formatDataSize(order.capacity)} order to ${order.recipientNumber} failed. The amount has been reversed to your iGet balance. Kindly check your iGet balance to confirm.\niGet`;
    }
  }
  
  return null;
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

// GET all orders (admin access) - UPDATED WITH FULL SERVER-SIDE SEARCH
router.get('/all', adminAuth, validateModelsAndDb, async (req, res) => {
  try {
    console.log('📋 Fetching all orders for admin:', req.user.username, 'Role:', req.user.role);
    
    // Pagination parameters
    const page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 20;
    
    // If searching, increase limit to show more results
    if (req.query.search && limit < 1000) {
      limit = Math.min(parseInt(req.query.limit) || 1000, 1000);
      console.log('🔍 Search mode: increased limit to', limit);
    }
    
    const skip = (page - 1) * limit;
    
    console.log('📄 Pagination params:', { page, limit, skip });
    
    // Build filter object
    const filter = {};
    
    // Status filter
    if (req.query.status) {
      filter.status = req.query.status;
      console.log('🔍 Filtering by status:', req.query.status);
    }
    
    // Bundle type filter
    if (req.query.bundleType) {
      filter.bundleType = req.query.bundleType;
      console.log('🔍 Filtering by bundleType:', req.query.bundleType);
    }
    
    // User ID filter
    if (req.query.userId) {
      filter.user = req.query.userId;
      console.log('🔍 Filtering by userId:', req.query.userId);
    }
    
    // Date range filtering
    if (req.query.startDate || req.query.endDate) {
      filter.createdAt = {};
      if (req.query.startDate) {
        const startDate = new Date(req.query.startDate);
        startDate.setHours(0, 0, 0, 0); // Set to beginning of day
        filter.createdAt.$gte = startDate;
      }
      if (req.query.endDate) {
        const endDate = new Date(req.query.endDate);
        endDate.setHours(23, 59, 59, 999); // Set to end of day
        filter.createdAt.$lte = endDate;
      }
      console.log('🔍 Filtering by date range:', {
        start: filter.createdAt.$gte,
        end: filter.createdAt.$lte
      });
    }
    
    // Search query - searches across multiple fields
    if (req.query.search) {
      const searchQuery = req.query.search.trim();
      console.log('🔍 Original search query:', searchQuery);
      
      // Build search conditions
      const searchConditions = [];
      
      // Direct field searches
      searchConditions.push(
        { orderReference: { $regex: searchQuery, $options: 'i' } },
        { recipientNumber: { $regex: searchQuery, $options: 'i' } },
        { phoneNumber: { $regex: searchQuery, $options: 'i' } },
        { 'metadata.fullName': { $regex: searchQuery, $options: 'i' } }
      );
      
      // If search query looks like a phone number, also search with/without country code
      if (/^\d+$/.test(searchQuery)) {
        console.log('🔍 Detected phone number search');
        
        if (searchQuery.startsWith('0')) {
          // If starts with 0, also search for 233 + rest
          const withCountryCode = '233' + searchQuery.substring(1);
          const withPlusCountryCode = '+233' + searchQuery.substring(1);
          console.log('🔍 Also searching for:', withCountryCode, 'and', withPlusCountryCode);
          
          searchConditions.push(
            { recipientNumber: withCountryCode },
            { recipientNumber: withPlusCountryCode },
            { phoneNumber: withCountryCode },
            { phoneNumber: withPlusCountryCode }
          );
        } else if (searchQuery.startsWith('233')) {
          // If starts with 233, also search for 0 + rest
          const withoutCountryCode = '0' + searchQuery.substring(3);
          const withPlus = '+' + searchQuery;
          console.log('🔍 Also searching for:', withoutCountryCode, 'and', withPlus);
          
          searchConditions.push(
            { recipientNumber: withoutCountryCode },
            { recipientNumber: withPlus },
            { phoneNumber: withoutCountryCode },
            { phoneNumber: withPlus }
          );
        } else if (searchQuery.startsWith('+233')) {
          // If starts with +233, also search for 0 + rest and 233 + rest
          const withoutCountryCode = '0' + searchQuery.substring(4);
          const withoutPlus = searchQuery.substring(1);
          console.log('🔍 Also searching for:', withoutCountryCode, 'and', withoutPlus);
          
          searchConditions.push(
            { recipientNumber: withoutCountryCode },
            { recipientNumber: withoutPlus },
            { phoneNumber: withoutCountryCode },
            { phoneNumber: withoutPlus }
          );
        }
      }
      
      // For ObjectId search (order ID) - Only add if it's a valid ObjectId format
      if (searchQuery.length === 24 && /^[0-9a-fA-F]{24}$/.test(searchQuery)) {
        console.log('🔍 Valid ObjectId search');
        searchConditions.push({ _id: searchQuery });
      }
      
      // Combine all search conditions with OR
      filter.$or = searchConditions;
      
      console.log('🔍 Search conditions count:', searchConditions.length);
      console.log('🔍 First few conditions:', searchConditions.slice(0, 3));
    }
    
    // Capacity exclusions
    if (req.query.excludedCapacities) {
      const excluded = req.query.excludedCapacities.split(',').map(Number);
      filter.capacity = { $nin: excluded };
      console.log('🔍 Excluding capacities:', excluded);
    }
    
    // Network exclusions (requires lookup)
    if (req.query.excludedNetworks) {
      const excludedNetworks = req.query.excludedNetworks.split(',');
      const networkMap = {
        'MTN': ['mtnup2u', 'mtn-justforu'],
        'AirtelTigo': ['AT-ishare'],
        'Telecel': ['Telecel-5959'],
        'AfA': ['AfA-registration']
      };
      
      const excludedBundleTypes = [];
      excludedNetworks.forEach(network => {
        if (networkMap[network]) {
          excludedBundleTypes.push(...networkMap[network]);
        }
      });
      
      if (excludedBundleTypes.length > 0) {
        if (filter.bundleType) {
          // If there's already a bundleType filter, combine them
          filter.bundleType = { $nin: excludedBundleTypes, $eq: filter.bundleType };
        } else {
          filter.bundleType = { $nin: excludedBundleTypes };
        }
      }
      console.log('🔍 Excluding networks:', excludedNetworks);
    }
    
    // Network-Capacity combination exclusions
    if (req.query.excludedNetworkCapacities) {
      const excludedCombos = req.query.excludedNetworkCapacities.split(',');
      console.log('🔍 Excluding network-capacity combos:', excludedCombos);
      // This is complex to handle in MongoDB query, might need post-processing
    }
    
    // First, get users if we need to search by user fields
    if (req.query.search) {
      try {
        const searchRegex = new RegExp(req.query.search, 'i');
        const users = await User.find({
          $or: [
            { username: searchRegex },
            { email: searchRegex },
            { phone: searchRegex }
          ]
        }).select('_id');
        
        if (users.length > 0) {
          const userIds = users.map(u => u._id);
          console.log('🔍 Found', users.length, 'matching users');
          if (filter.$or) {
            filter.$or.push({ user: { $in: userIds } });
          } else {
            filter.$or = [{ user: { $in: userIds } }];
          }
        }
      } catch (userSearchError) {
        console.log('⚠️ User search error (non-critical):', userSearchError.message);
      }
    }
    
    // Get total count for pagination
    let total = 0;
    try {
      console.log('📊 Counting documents with filter...');
      total = await Order.countDocuments(filter);
      console.log('📊 Total documents count:', total);
    } catch (countError) {
      console.error('❌ Error counting documents:', countError.message);
      total = 0;
    }
    
    // Get orders with pagination
    console.log('📋 Fetching orders with pagination...');
    
    // When searching, don't sort by date to ensure we get the most relevant results
    const sortOptions = req.query.search ? {} : { createdAt: -1 };
    
    let orders = await Order.find(filter)
      .populate('user', 'username email phone')
      .populate('processedBy', 'username role')
      .sort(sortOptions)
      .skip(skip)
      .limit(limit);
    
    console.log('📋 Initial fetch returned', orders.length, 'orders');
    
    // Debug: Show a sample of what was found
    if (orders.length > 0 && req.query.search) {
      console.log('🔍 Sample of fetched orders:');
      orders.slice(0, 3).forEach(order => {
        console.log(`  - Order ${order._id}: recipient=${order.recipientNumber}, phone=${order.phoneNumber}, ref=${order.orderReference}`);
      });
    }
    
    // Post-query filtering for partial order ID search
    if (req.query.search && req.query.search.length >= 6 && req.query.search.length < 24) {
      const partialId = req.query.search.toLowerCase();
      // ONLY apply partial ID filter if it's a hex string (not a phone number)
      if (/^[0-9a-fA-F]+$/.test(partialId) && !/^[0-9]+$/.test(partialId)) {
        console.log('🔍 Applying partial ID filter:', partialId);
        const originalCount = orders.length;
        orders = orders.filter(order => 
          order._id.toString().toLowerCase().startsWith(partialId)
        );
        if (orders.length !== originalCount) {
          console.log('🔍 Partial ID filter reduced results from', originalCount, 'to', orders.length);
          // Update total for accurate pagination
          const allOrders = await Order.find(filter).select('_id');
          total = allOrders.filter(order => 
            order._id.toString().toLowerCase().startsWith(partialId)
          ).length;
        }
      }
    }
    
    // Post-query filtering for network-capacity exclusions
    if (req.query.excludedNetworkCapacities) {
      const excludedCombos = req.query.excludedNetworkCapacities.split(',');
      const networkMap = {
        'mtnup2u': 'MTN',
        'mtn-justforu': 'MTN',
        'AT-ishare': 'AirtelTigo',
        'Telecel-5959': 'Telecel',
        'AfA-registration': 'AfA'
      };
      
      orders = orders.filter(order => {
        const network = networkMap[order.bundleType] || 'Unknown';
        const combo = `${network}-${order.capacity}GB`;
        return !excludedCombos.includes(combo);
      });
    }
    
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
      details: 'Failed to fetch orders. Please check database connection and model initialization.'
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
          const message = generateSMSMessage(order, status, order.bundleType);
          
          if (message) {
            smsResult = await sendSMS(userPhone, message, {
              useCase: 'transactional',
              senderID: senderID
            });
            
            if (smsResult.success) {
              console.log(`SMS sent by Editor ${req.user.username} to user ${userPhone} for order ${order._id} using ${order.bundleType} template with senderID: ${senderID}`);
            } else {
              console.error(`Failed to send SMS: ${smsResult.error?.message || 'Unknown error'}`);
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

/**
 * @route   PUT /api/orders/bulk-status
 * @desc    Bulk update order statuses (EDITOR ROLE ONLY)
 * @access  Editor/Admin
 */
router.put('/bulk-status', adminAuth, requireEditor, validateModelsAndDb, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { orderIds, status, senderID = 'EL VENDER', sendSMSNotification = false } = req.body;
    
    // Validation
    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Order IDs array is required and cannot be empty'
      });
    }
    
    if (orderIds.length > 500) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 500 orders can be updated at once'
      });
    }
    
    const validStatuses = ['pending', 'processing', 'completed', 'failed', 'refunded'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Valid status is required',
        validStatuses: validStatuses
      });
    }
    
    console.log(`📝 Bulk status update initiated by Editor ${req.user.username} for ${orderIds.length} orders to status: ${status}`);
    
    // Get all orders that need to be updated
    const ordersToUpdate = await Order.find({ 
      _id: { $in: orderIds } 
    }).populate('user').session(session);
    
    if (ordersToUpdate.length === 0) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'No valid orders found with provided IDs'
      });
    }
    
    // Process refunds if status is 'refunded'
    const refundResults = [];
    if (status === 'refunded') {
      for (const order of ordersToUpdate) {
        if (order.status !== 'refunded' && order.user) {
          try {
            const user = await User.findById(order.user._id).session(session);
            if (user && user.wallet) {
              user.wallet.balance += order.price;
              await user.save({ session });
              refundResults.push({
                orderId: order._id,
                userId: user._id,
                amount: order.price,
                success: true
              });
            }
          } catch (refundError) {
            console.error(`Failed to refund order ${order._id}:`, refundError);
            refundResults.push({
              orderId: order._id,
              success: false,
              error: refundError.message
            });
          }
        }
      }
    }
    
    // Prepare bulk update operations
    const bulkOps = orderIds.map(orderId => ({
      updateOne: {
        filter: { _id: orderId },
        update: {
          $set: {
            status: status,
            processedBy: req.user.id,
            updatedAt: Date.now(),
            editorInfo: {
              editorId: req.user._id,
              editorUsername: req.user.username,
              editorRole: req.user.role,
              statusChangedAt: new Date(),
              bulkUpdate: true,
              totalInBatch: orderIds.length
            },
            ...(status === 'completed' ? { completedAt: new Date() } : {})
          }
        }
      }
    }));
    
    // Execute bulk update
    const bulkResult = await Order.bulkWrite(bulkOps, { session });
    
    // Commit transaction
    await session.commitTransaction();
    
    console.log(`✅ Bulk update completed: ${bulkResult.modifiedCount} orders updated`);
    
    // Handle SMS notifications asynchronously if enabled
    if (sendSMSNotification && bulkResult.modifiedCount > 0) {
      // Process SMS in background to not delay response
      setImmediate(async () => {
        try {
          console.log('📱 Starting background SMS notifications...');
          
          const updatedOrders = await Order.find({ 
            _id: { $in: orderIds } 
          }).populate('user');
          
          let smsSuccessCount = 0;
          let smsFailureCount = 0;
          
          // Send SMS in batches to avoid overwhelming the SMS API
          const smsBatchSize = 10;
          for (let i = 0; i < updatedOrders.length; i += smsBatchSize) {
            const batch = updatedOrders.slice(i, i + smsBatchSize);
            
            const smsPromises = batch.map(async (order) => {
              if (order.user?.phone) {
                try {
                  const userPhone = order.user.phone.replace(/^\+233/, '');
                  const message = generateSMSMessage(order, status, order.bundleType);
                  
                  if (message) {
                    const result = await sendSMS(userPhone, message, {
                      useCase: 'transactional',
                      senderID: senderID
                    });
                    
                    if (result.success) {
                      smsSuccessCount++;
                    } else {
                      smsFailureCount++;
                    }
                  }
                } catch (error) {
                  smsFailureCount++;
                  console.error(`SMS error for order ${order._id}:`, error.message);
                }
              }
            });
            
            await Promise.all(smsPromises);
            
            // Small delay between batches to avoid rate limiting
            if (i + smsBatchSize < updatedOrders.length) {
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
          
          console.log(`📱 SMS notifications completed: ${smsSuccessCount} sent, ${smsFailureCount} failed`);
          
        } catch (smsError) {
          console.error('Background SMS processing error:', smsError);
        }
      });
    }
    
    // Return response immediately
    res.status(200).json({
      success: true,
      message: `Successfully updated ${bulkResult.modifiedCount} orders`,
      data: {
        requested: orderIds.length,
        found: ordersToUpdate.length,
        modified: bulkResult.modifiedCount,
        status: status,
        refunds: refundResults.length > 0 ? {
          attempted: refundResults.length,
          successful: refundResults.filter(r => r.success).length,
          failed: refundResults.filter(r => !r.success).length,
          totalRefunded: refundResults
            .filter(r => r.success)
            .reduce((sum, r) => sum + r.amount, 0)
        } : null,
        smsNotification: sendSMSNotification ? {
          scheduled: true,
          processing: 'background'
        } : {
          scheduled: false
        }
      },
      updatedBy: {
        editorId: req.user._id,
        editorUsername: req.user.username,
        editorRole: req.user.role,
        timestamp: new Date()
      }
    });
    
  } catch (error) {
    await session.abortTransaction();
    console.error('❌ Bulk status update error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during bulk update',
      error: error.message
    });
  } finally {
    session.endSession();
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

// POST place order (main endpoint with API integration and stock validation)
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
    
    // CHECK IF THE BUNDLE IS IN STOCK - NEW STOCK VALIDATION
    const bundle = await Bundle.findOne({
      capacity: capacity,
      type: bundleType,
      isActive: true
    });
    
    if (bundle && (bundle.stockStatus?.isOutOfStock || !bundle.isInStock)) {
      return res.status(400).json({
        success: false,
        message: `This bundle (${capacity}MB ${bundleType}) is currently out of stock`,
        stockInfo: {
          reason: bundle.stockStatus?.reason || 'No reason provided',
          markedOutAt: bundle.stockStatus?.markedOutOfStockAt
        }
      });
    }
    
    // If bundle doesn't exist but we're creating orders dynamically, check if we should block it
    if (!bundle && req.user.role !== 'admin') {
      // For non-admin users, we might want to prevent creating new bundle types on the fly
      return res.status(400).json({
        success: false,
        message: 'This bundle configuration is not available'
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
              await session.abortTransaction();
              session.endSession();
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
            
            await session.abortTransaction();
            session.endSession();
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
              await session.abortTransaction();
              session.endSession();
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
            
            await session.abortTransaction();
            session.endSession();
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