// routes/bundles.js with complete stock management functionality
const express = require('express');
const router = express.Router();
const { Bundle, User, ApiLog } = require('../schema/schema');
const authMiddleware = require('../AuthMiddle/middlewareauth');
const adminMiddleware = require('../adminMiddlware/middleware');

// Get all active bundles with prices based on user role and stock status
router.get('/bundle', authMiddleware, async (req, res) => {
  try {
    // Get user's role from auth middleware
    const userRole = req.user.role || 'user';
    
    // Build query based on user role
    let query = { isActive: true };
    
    // For non-admin users, also filter out out-of-stock bundles
    if (userRole !== 'admin') {
      query['stockStatus.isOutOfStock'] = { $ne: true };
      query.isInStock = { $ne: false };
    }
    
    // Find bundles based on query
    const bundles = await Bundle.find(query);
    
    // Format response with role-specific pricing
    const bundlesWithUserPrices = bundles.map(bundle => {
      const bundleObj = bundle.toObject();
      
      // Get the role-specific price or default to standard price
      const rolePrice = bundle.rolePricing && bundle.rolePricing[userRole] 
        ? bundle.rolePricing[userRole] 
        : bundle.price;
      
      // Replace the standard price with the role-specific price
      // but keep the original price for reference if admin
      if (userRole === 'admin') {
        bundleObj.userPrice = rolePrice;
        bundleObj.allPrices = bundle.rolePricing || { user: bundle.price };
        // Include stock status for admin
        bundleObj.stockInfo = {
          isInStock: bundle.isInStock,
          isOutOfStock: bundle.stockStatus?.isOutOfStock || false,
          reason: bundle.stockStatus?.reason,
          markedOutOfStockBy: bundle.stockStatus?.markedOutOfStockBy,
          markedOutOfStockAt: bundle.stockStatus?.markedOutOfStockAt
        };
      } else {
        bundleObj.price = rolePrice; // Override the price with role-specific price
      }
      
      return bundleObj;
    });
    
    res.status(200).json({ 
      success: true, 
      userRole: userRole,
      data: bundlesWithUserPrices,
      // Include stock summary for admins
      ...(userRole === 'admin' && {
        stockSummary: {
          total: bundles.length,
          inStock: bundles.filter(b => !b.stockStatus?.isOutOfStock).length,
          outOfStock: bundles.filter(b => b.stockStatus?.isOutOfStock).length
        }
      })
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get bundles by type with prices based on user role and stock status
router.get('/bundle/:type', authMiddleware, async (req, res) => {
  try {
    const { type } = req.params;
    
    // Get user's role from auth middleware
    const userRole = req.user.role || 'user';
    
    // Validate if type is one of the allowed enum values
    const allowedTypes = ['mtnup2u', 'mtn-fibre', 'mtn-justforu', 'AT-ishare', 'Telecel-5959', 'AfA-registration', 'other'];
    
    if (!allowedTypes.includes(type)) {
      return res.status(400).json({ success: false, message: 'Invalid bundle type' });
    }
    
    // Build query based on user role
    let query = { isActive: true, type };
    
    // For non-admin users, also filter out out-of-stock bundles
    if (userRole !== 'admin') {
      query['stockStatus.isOutOfStock'] = { $ne: true };
      query.isInStock = { $ne: false };
    }
    
    // Find bundles based on query
    const bundles = await Bundle.find(query);
    
    // Format response with role-specific pricing
    const bundlesWithUserPrices = bundles.map(bundle => {
      const bundleObj = bundle.toObject();
      
      // Get the role-specific price or default to standard price
      const rolePrice = bundle.rolePricing && bundle.rolePricing[userRole] 
        ? bundle.rolePricing[userRole] 
        : bundle.price;
      
      // Replace the standard price with the role-specific price
      // but keep the original price for reference if admin
      if (userRole === 'admin') {
        bundleObj.userPrice = rolePrice;
        bundleObj.allPrices = bundle.rolePricing || { user: bundle.price };
        // Include stock status for admin
        bundleObj.stockInfo = {
          isInStock: bundle.isInStock,
          isOutOfStock: bundle.stockStatus?.isOutOfStock || false,
          reason: bundle.stockStatus?.reason,
          markedOutOfStockBy: bundle.stockStatus?.markedOutOfStockBy,
          markedOutOfStockAt: bundle.stockStatus?.markedOutOfStockAt
        };
      } else {
        bundleObj.price = rolePrice; // Override the price with role-specific price
      }
      
      return bundleObj;
    });
    
    res.status(200).json({ 
      success: true, 
      userRole: userRole,
      bundleType: type,
      data: bundlesWithUserPrices,
      // Include stock summary for admins
      ...(userRole === 'admin' && {
        stockSummary: {
          total: bundles.length,
          inStock: bundles.filter(b => !b.stockStatus?.isOutOfStock).length,
          outOfStock: bundles.filter(b => b.stockStatus?.isOutOfStock).length
        }
      })
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get a single bundle by ID with price based on user role
router.get('/bundle-details/:id', authMiddleware, async (req, res) => {
  try {
    // Get user's role from auth middleware
    const userRole = req.user.role || 'user';
    
    // Find the bundle by ID
    const bundle = await Bundle.findOne({ _id: req.params.id, isActive: true });
    
    if (!bundle) {
      return res.status(404).json({ success: false, message: 'Bundle not found' });
    }
    
    // Check if bundle is out of stock and user is not admin
    if (userRole !== 'admin' && bundle.stockStatus?.isOutOfStock) {
      return res.status(404).json({ 
        success: false, 
        message: 'Bundle is currently out of stock',
        isOutOfStock: true
      });
    }
    
    // Format response with role-specific pricing
    const bundleObj = bundle.toObject();
    
    // Get the role-specific price or default to standard price
    const rolePrice = bundle.rolePricing && bundle.rolePricing[userRole] 
      ? bundle.rolePricing[userRole] 
      : bundle.price;
    
    // Replace the standard price with the role-specific price
    // but keep the original price for reference if admin
    if (userRole === 'admin') {
      bundleObj.userPrice = rolePrice;
      bundleObj.allPrices = bundle.rolePricing || { user: bundle.price };
      // Include detailed stock status for admin
      bundleObj.stockInfo = {
        isInStock: bundle.isInStock,
        isOutOfStock: bundle.stockStatus?.isOutOfStock || false,
        reason: bundle.stockStatus?.reason,
        markedOutOfStockBy: bundle.stockStatus?.markedOutOfStockBy,
        markedOutOfStockAt: bundle.stockStatus?.markedOutOfStockAt,
        markedInStockBy: bundle.stockStatus?.markedInStockBy,
        markedInStockAt: bundle.stockStatus?.markedInStockAt
      };
    } else {
      bundleObj.price = rolePrice; // Override the price with role-specific price
    }
    
    res.status(200).json({ 
      success: true, 
      userRole: userRole,
      data: bundleObj 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Create a new bundle (admin only)
router.post('/addbundle', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const { capacity, price, type, rolePricing, isInStock = true } = req.body;
    
    if (!capacity || !price || !type) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }
    
    // Check if bundle with same capacity and type already exists
    const existingBundle = await Bundle.findOne({ capacity, type });
    if (existingBundle) {
      return res.status(400).json({ 
        success: false, 
        message: 'Bundle with this capacity and type already exists',
        existingBundleId: existingBundle._id
      });
    }
    
    const bundle = new Bundle({
      capacity,
      price,
      type,
      // Include role-specific pricing if provided
      rolePricing: rolePricing || {
        admin: price,  // Default same as standard price
        user: price,   // Default same as standard price
        agent: price,  // Default same as standard price
        Editor: price  // Default same as standard price
      },
      isInStock: isInStock,
      stockStatus: {
        isOutOfStock: !isInStock,
        reason: !isInStock ? 'Initially marked as out of stock' : null,
        markedOutOfStockBy: !isInStock ? req.user.id : null,
        markedOutOfStockAt: !isInStock ? new Date() : null
      }
    });
    
    await bundle.save();
    
    res.status(201).json({ 
      success: true, 
      data: bundle,
      message: `Bundle created successfully${!isInStock ? ' (marked as out of stock)' : ''}`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update a bundle by ID (admin only)
router.put('/:id', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    // Don't allow updating stock status through this endpoint
    const { stockStatus, isInStock, ...updateData } = req.body;
    
    if (stockStatus !== undefined || isInStock !== undefined) {
      return res.status(400).json({ 
        success: false, 
        message: 'Use stock management endpoints to update stock status' 
      });
    }
    
    const bundle = await Bundle.findByIdAndUpdate(
      req.params.id,
      { ...updateData, updatedAt: Date.now() },
      { new: true, runValidators: true }
    );
    
    if (!bundle) {
      return res.status(404).json({ success: false, message: 'Bundle not found' });
    }
    
    res.status(200).json({ success: true, data: bundle });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Delete/deactivate a bundle (admin only)
router.delete('/:id', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const bundle = await Bundle.findByIdAndUpdate(
      req.params.id,
      { isActive: false, updatedAt: Date.now() },
      { new: true }
    );
    
    if (!bundle) {
      return res.status(404).json({ success: false, message: 'Bundle not found' });
    }
    
    res.status(200).json({ 
      success: true, 
      message: 'Bundle deactivated successfully',
      data: {} 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get user wallet balance
router.get('/balance', authMiddleware, async (req, res) => {
  try {
    // The user ID is available from the authentication middleware
    const userId = req.user.id;
    
    // Find the user and select only the wallet field
    const user = await User.findById(userId).select('wallet');
    
    if (!user || !user.wallet) {
      return res.status(404).json({ 
        success: false, 
        message: 'User wallet not found' 
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
    res.status(500).json({ success: false, message: error.message });
  }
});

// STOCK MANAGEMENT ENDPOINTS

/**
 * @route   PUT /api/bundles/stock/:id/out-of-stock
 * @desc    Mark a specific bundle as out of stock
 * @access  Admin only
 */
router.put('/stock/:id/out-of-stock', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const { reason } = req.body;
    
    const bundle = await Bundle.findById(req.params.id);
    
    if (!bundle) {
      return res.status(404).json({ 
        success: false, 
        message: 'Bundle not found' 
      });
    }
    
    // Check if already out of stock
    if (bundle.stockStatus?.isOutOfStock) {
      return res.status(400).json({ 
        success: false, 
        message: 'Bundle is already marked as out of stock',
        currentStatus: {
          markedBy: bundle.stockStatus.markedOutOfStockBy,
          markedAt: bundle.stockStatus.markedOutOfStockAt,
          reason: bundle.stockStatus.reason
        }
      });
    }
    
    // Update stock status
    bundle.isInStock = false;
    bundle.stockStatus = {
      isOutOfStock: true,
      reason: reason || 'No reason provided',
      markedOutOfStockBy: req.user.id,
      markedOutOfStockAt: new Date(),
      // Preserve previous in-stock info if exists
      markedInStockBy: bundle.stockStatus?.markedInStockBy || null,
      markedInStockAt: bundle.stockStatus?.markedInStockAt || null
    };
    bundle.updatedAt = new Date();
    
    await bundle.save();
    
    // Log the action
    await ApiLog.create({
      user: req.user.id,
      endpoint: `/api/bundles/stock/${req.params.id}/out-of-stock`,
      method: 'PUT',
      requestData: { bundleId: req.params.id, reason },
      responseData: { success: true },
      status: 200,
      adminMetadata: {
        adminRole: req.user.role,
        actionType: 'mark_out_of_stock',
        actionDescription: `Marked bundle ${bundle.capacity}MB (${bundle.type}) as out of stock`,
        targetUserId: null,
        affectedRecords: 1,
        sensitiveAction: true
      }
    });
    
    res.status(200).json({ 
      success: true, 
      message: 'Bundle marked as out of stock',
      data: {
        bundleId: bundle._id,
        capacity: bundle.capacity,
        type: bundle.type,
        stockStatus: bundle.stockStatus,
        markedBy: req.user.username
      }
    });
  } catch (error) {
    console.error('Error marking bundle out of stock:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

/**
 * @route   PUT /api/bundles/stock/:id/in-stock
 * @desc    Mark a specific bundle as back in stock
 * @access  Admin only
 */
router.put('/stock/:id/in-stock', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const bundle = await Bundle.findById(req.params.id);
    
    if (!bundle) {
      return res.status(404).json({ 
        success: false, 
        message: 'Bundle not found' 
      });
    }
    
    // Check if already in stock
    if (!bundle.stockStatus?.isOutOfStock && bundle.isInStock) {
      return res.status(400).json({ 
        success: false, 
        message: 'Bundle is already in stock' 
      });
    }
    
    // Store previous out of stock info for history
    const previousOutOfStockInfo = bundle.stockStatus?.isOutOfStock ? {
      wasOutOfStock: true,
      previousReason: bundle.stockStatus.reason,
      previousMarkedBy: bundle.stockStatus.markedOutOfStockBy,
      previousMarkedAt: bundle.stockStatus.markedOutOfStockAt
    } : null;
    
    // Update stock status
    bundle.isInStock = true;
    bundle.stockStatus = {
      isOutOfStock: false,
      reason: null,
      markedInStockBy: req.user.id,
      markedInStockAt: new Date(),
      // Clear out of stock info
      markedOutOfStockBy: null,
      markedOutOfStockAt: null
    };
    bundle.updatedAt = new Date();
    
    await bundle.save();
    
    // Log the action with previous status info
    await ApiLog.create({
      user: req.user.id,
      endpoint: `/api/bundles/stock/${req.params.id}/in-stock`,
      method: 'PUT',
      requestData: { 
        bundleId: req.params.id,
        previousStatus: previousOutOfStockInfo
      },
      responseData: { success: true },
      status: 200,
      adminMetadata: {
        adminRole: req.user.role,
        actionType: 'mark_in_stock',
        actionDescription: `Marked bundle ${bundle.capacity}MB (${bundle.type}) as back in stock`,
        targetUserId: null,
        affectedRecords: 1,
        sensitiveAction: true
      }
    });
    
    res.status(200).json({ 
      success: true, 
      message: 'Bundle marked as back in stock',
      data: {
        bundleId: bundle._id,
        capacity: bundle.capacity,
        type: bundle.type,
        stockStatus: bundle.stockStatus,
        markedBy: req.user.username,
        previousOutOfStockInfo
      }
    });
  } catch (error) {
    console.error('Error marking bundle in stock:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

/**
 * @route   GET /api/bundles/stock/out-of-stock
 * @desc    Get all bundles that are currently out of stock
 * @access  Admin only
 */
router.get('/stock/out-of-stock', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const outOfStockBundles = await Bundle.find({ 
      'stockStatus.isOutOfStock': true 
    })
    .populate('stockStatus.markedOutOfStockBy', 'username email')
    .sort({ 'stockStatus.markedOutOfStockAt': -1 });
    
    // Group by bundle type for easier viewing
    const groupedByType = outOfStockBundles.reduce((acc, bundle) => {
      if (!acc[bundle.type]) {
        acc[bundle.type] = [];
      }
      acc[bundle.type].push({
        id: bundle._id,
        capacity: bundle.capacity,
        price: bundle.price,
        reason: bundle.stockStatus.reason,
        markedOutBy: bundle.stockStatus.markedOutOfStockBy?.username || 'Unknown',
        markedOutAt: bundle.stockStatus.markedOutOfStockAt
      });
      return acc;
    }, {});
    
    res.status(200).json({ 
      success: true, 
      count: outOfStockBundles.length,
      data: outOfStockBundles,
      groupedByType,
      summary: {
        totalOutOfStock: outOfStockBundles.length,
        byType: Object.keys(groupedByType).map(type => ({
          type,
          count: groupedByType[type].length
        }))
      }
    });
  } catch (error) {
    console.error('Error fetching out of stock bundles:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

/**
 * @route   GET /api/bundles/stock/status
 * @desc    Get stock status for all bundles (overview)
 * @access  Admin only
 */
router.get('/stock/status', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const allBundles = await Bundle.find({ isActive: true })
      .populate('stockStatus.markedOutOfStockBy', 'username')
      .populate('stockStatus.markedInStockBy', 'username')
      .sort({ type: 1, capacity: 1 });
    
    const inStockCount = allBundles.filter(b => !b.stockStatus?.isOutOfStock).length;
    const outOfStockCount = allBundles.filter(b => b.stockStatus?.isOutOfStock).length;
    
    const bundlesByType = allBundles.reduce((acc, bundle) => {
      if (!acc[bundle.type]) {
        acc[bundle.type] = {
          type: bundle.type,
          total: 0,
          inStock: 0,
          outOfStock: 0,
          bundles: []
        };
      }
      
      acc[bundle.type].total++;
      if (bundle.stockStatus?.isOutOfStock) {
        acc[bundle.type].outOfStock++;
      } else {
        acc[bundle.type].inStock++;
      }
      
      acc[bundle.type].bundles.push({
        id: bundle._id,
        capacity: bundle.capacity,
        price: bundle.price,
        isInStock: !bundle.stockStatus?.isOutOfStock,
        stockStatus: bundle.stockStatus
      });
      
      return acc;
    }, {});
    
    res.status(200).json({
      success: true,
      summary: {
        total: allBundles.length,
        inStock: inStockCount,
        outOfStock: outOfStockCount,
        stockPercentage: allBundles.length > 0 ? ((inStockCount / allBundles.length) * 100).toFixed(1) : 0
      },
      byType: Object.values(bundlesByType),
      allBundles: allBundles
    });
  } catch (error) {
    console.error('Error fetching stock status:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @route   PUT /api/bundles/stock/bulk-update
 * @desc    Update stock status for multiple bundles at once
 * @access  Admin only
 */
router.put('/stock/bulk-update', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const { bundleIds, action, reason } = req.body;
    
    // Validate input
    if (!bundleIds || !Array.isArray(bundleIds) || bundleIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Bundle IDs array is required'
      });
    }
    
    if (!['out-of-stock', 'in-stock'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Action must be either "out-of-stock" or "in-stock"'
      });
    }
    
    if (bundleIds.length > 50) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 50 bundles can be updated at once'
      });
    }
    
    // Prepare update data
    const updateData = {
      isInStock: action === 'in-stock',
      updatedAt: new Date()
    };
    
    if (action === 'out-of-stock') {
      updateData.stockStatus = {
        isOutOfStock: true,
        reason: reason || 'Bulk update - no reason provided',
        markedOutOfStockBy: req.user.id,
        markedOutOfStockAt: new Date()
      };
    } else {
      updateData.stockStatus = {
        isOutOfStock: false,
        reason: null,
        markedInStockBy: req.user.id,
        markedInStockAt: new Date(),
        markedOutOfStockBy: null,
        markedOutOfStockAt: null
      };
    }
    
    // Get bundle details before update for logging
    const bundlesToUpdate = await Bundle.find({ _id: { $in: bundleIds } });
    const bundleDetails = bundlesToUpdate.map(b => ({
      id: b._id,
      capacity: b.capacity,
      type: b.type,
      previousStatus: b.stockStatus?.isOutOfStock ? 'out-of-stock' : 'in-stock'
    }));
    
    // Perform bulk update
    const result = await Bundle.updateMany(
      { _id: { $in: bundleIds } },
      updateData
    );
    
    // Log the action
    await ApiLog.create({
      user: req.user.id,
      endpoint: '/api/bundles/stock/bulk-update',
      method: 'PUT',
      requestData: { bundleIds, action, reason },
      responseData: { 
        success: true, 
        modifiedCount: result.modifiedCount,
        bundleDetails 
      },
      status: 200,
      adminMetadata: {
        adminRole: req.user.role,
        actionType: `bulk_${action.replace('-', '_')}`,
        actionDescription: `Bulk marked ${result.modifiedCount} bundles as ${action}`,
        targetUserId: null,
        affectedRecords: result.modifiedCount,
        sensitiveAction: true
      }
    });
    
    res.status(200).json({
      success: true,
      message: `Successfully updated ${result.modifiedCount} bundles`,
      data: {
        requestedCount: bundleIds.length,
        modifiedCount: result.modifiedCount,
        action: action,
        updatedBundles: bundleDetails,
        updatedBy: req.user.username,
        timestamp: new Date()
      }
    });
  } catch (error) {
    console.error('Error in bulk stock update:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @route   PUT /api/bundles/stock/by-type-capacity
 * @desc    Update stock status for bundles by type and capacity
 * @access  Admin only
 */
router.put('/stock/by-type-capacity', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const { type, capacity, action, reason } = req.body;
    
    // Validate input
    if (!type || capacity === undefined || !action) {
      return res.status(400).json({
        success: false,
        message: 'Type, capacity, and action are required'
      });
    }
    
    if (!['out-of-stock', 'in-stock'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Action must be either "out-of-stock" or "in-stock"'
      });
    }
    
    // Find the bundle
    const bundle = await Bundle.findOne({ type, capacity, isActive: true });
    
    if (!bundle) {
      return res.status(404).json({
        success: false,
        message: `No active bundle found for ${type} with ${capacity}MB capacity`
      });
    }
    
    // Update the bundle
    bundle.isInStock = action === 'in-stock';
    bundle.updatedAt = new Date();
    
    if (action === 'out-of-stock') {
      bundle.stockStatus = {
        isOutOfStock: true,
        reason: reason || 'No reason provided',
        markedOutOfStockBy: req.user.id,
        markedOutOfStockAt: new Date()
      };
    } else {
      bundle.stockStatus = {
        isOutOfStock: false,
        reason: null,
        markedInStockBy: req.user.id,
        markedInStockAt: new Date()
      };
    }
    
    await bundle.save();
    
    // Log the action
    await ApiLog.create({
      user: req.user.id,
      endpoint: '/api/bundles/stock/by-type-capacity',
      method: 'PUT',
      requestData: { type, capacity, action, reason },
      responseData: { success: true, bundleId: bundle._id },
      status: 200,
      adminMetadata: {
        adminRole: req.user.role,
        actionType: `mark_${action.replace('-', '_')}`,
        actionDescription: `Marked ${type} ${capacity}MB bundle as ${action}`,
        targetUserId: null,
        affectedRecords: 1,
        sensitiveAction: true
      }
    });
    
    res.status(200).json({
      success: true,
      message: `Successfully marked ${type} ${capacity}MB bundle as ${action}`,
      data: {
        bundleId: bundle._id,
        type: bundle.type,
        capacity: bundle.capacity,
        stockStatus: bundle.stockStatus,
        updatedBy: req.user.username
      }
    });
  } catch (error) {
    console.error('Error updating bundle by type and capacity:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Get bundles grouped by type (admin only) - includes stock information
router.get('/grouped/by-type', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const bundles = await Bundle.find({ isActive: true })
      .populate('stockStatus.markedOutOfStockBy', 'username')
      .populate('stockStatus.markedInStockBy', 'username')
      .sort({ type: 1, capacity: 1 });
    
    // Group bundles by type
    const groupedBundles = bundles.reduce((acc, bundle) => {
      if (!acc[bundle.type]) {
        acc[bundle.type] = {
          type: bundle.type,
          bundles: [],
          summary: {
            total: 0,
            inStock: 0,
            outOfStock: 0
          }
        };
      }
      
      acc[bundle.type].bundles.push(bundle);
      acc[bundle.type].summary.total++;
      
      if (bundle.stockStatus?.isOutOfStock) {
        acc[bundle.type].summary.outOfStock++;
      } else {
        acc[bundle.type].summary.inStock++;
      }
      
      return acc;
    }, {});
    
    res.status(200).json({
      success: true,
      data: groupedBundles,
      overallSummary: {
        totalBundles: bundles.length,
        totalInStock: bundles.filter(b => !b.stockStatus?.isOutOfStock).length,
        totalOutOfStock: bundles.filter(b => b.stockStatus?.isOutOfStock).length,
        bundleTypes: Object.keys(groupedBundles).length
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;