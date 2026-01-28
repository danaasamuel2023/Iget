// routes/bundles.js with complete stock management functionality including units
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
      query['stockUnits.available'] = { $gt: 0 };
    }
    
    // Find bundles based on query
    const bundles = await Bundle.find(query);
    
    // Format response with role-specific pricing
    const bundlesWithUserPrices = bundles.map(bundle => {
      const bundleObj = bundle.toObject();
      
      // Get the role-specific price or default to standard price
      const rolePrice = bundle.rolePricing && bundle.rolePricing[userRole] !== undefined && bundle.rolePricing[userRole] !== null
        ? bundle.rolePricing[userRole]
        : bundle.price;
      
      // Replace the standard price with the role-specific price
      // but keep the original price for reference if admin
      if (userRole === 'admin') {
        bundleObj.userPrice = rolePrice;
        bundleObj.allPrices = bundle.rolePricing || { user: bundle.price };
        // Include detailed stock info for admin
        bundleObj.stockInfo = {
          available: bundle.stockUnits?.available || 0,
          reserved: bundle.stockUnits?.reserved || 0,
          sold: bundle.stockUnits?.sold || 0,
          initial: bundle.stockUnits?.initial || 0,
          stockPercentage: bundle.stockPercentage || 0,
          isLowStock: bundle.stockStatus?.isLowStock || false,
          isCriticallyLow: bundle.isCriticallyLow || false,
          lowStockThreshold: bundle.stockUnits?.lowStockThreshold || 10,
          isOutOfStock: bundle.stockStatus?.isOutOfStock || false,
          autoOutOfStock: bundle.stockStatus?.autoOutOfStock || false,
          reason: bundle.stockStatus?.reason,
          markedOutOfStockBy: bundle.stockStatus?.markedOutOfStockBy,
          markedOutOfStockAt: bundle.stockStatus?.markedOutOfStockAt
        };
      } else {
        bundleObj.price = rolePrice; // Override the price with role-specific price
        // Basic stock info for regular users
        bundleObj.stockInfo = {
          available: bundle.stockUnits?.available > 0,
          isLowStock: bundle.stockStatus?.isLowStock || false
        };
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
          inStock: bundles.filter(b => (b.stockUnits?.available || 0) > 0).length,
          outOfStock: bundles.filter(b => (b.stockUnits?.available || 0) === 0).length,
          lowStock: bundles.filter(b => b.stockStatus?.isLowStock).length
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
      query['stockUnits.available'] = { $gt: 0 };
    }
    
    // Find bundles based on query
    const bundles = await Bundle.find(query);
    
    // Format response with role-specific pricing
    const bundlesWithUserPrices = bundles.map(bundle => {
      const bundleObj = bundle.toObject();
      
      // Get the role-specific price or default to standard price
      const rolePrice = bundle.rolePricing && bundle.rolePricing[userRole] !== undefined && bundle.rolePricing[userRole] !== null
        ? bundle.rolePricing[userRole]
        : bundle.price;
      
      // Replace the standard price with the role-specific price
      // but keep the original price for reference if admin
      if (userRole === 'admin') {
        bundleObj.userPrice = rolePrice;
        bundleObj.allPrices = bundle.rolePricing || { user: bundle.price };
        // Include detailed stock info for admin
        bundleObj.stockInfo = {
          available: bundle.stockUnits?.available || 0,
          reserved: bundle.stockUnits?.reserved || 0,
          sold: bundle.stockUnits?.sold || 0,
          initial: bundle.stockUnits?.initial || 0,
          stockPercentage: bundle.stockPercentage || 0,
          isLowStock: bundle.stockStatus?.isLowStock || false,
          isCriticallyLow: bundle.isCriticallyLow || false,
          lowStockThreshold: bundle.stockUnits?.lowStockThreshold || 10,
          isOutOfStock: bundle.stockStatus?.isOutOfStock || false,
          autoOutOfStock: bundle.stockStatus?.autoOutOfStock || false
        };
      } else {
        bundleObj.price = rolePrice; // Override the price with role-specific price
        bundleObj.stockInfo = {
          available: bundle.stockUnits?.available > 0,
          isLowStock: bundle.stockStatus?.isLowStock || false
        };
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
          inStock: bundles.filter(b => (b.stockUnits?.available || 0) > 0).length,
          outOfStock: bundles.filter(b => (b.stockUnits?.available || 0) === 0).length,
          lowStock: bundles.filter(b => b.stockStatus?.isLowStock).length
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
    if (userRole !== 'admin' && (bundle.stockUnits?.available || 0) === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Bundle is currently out of stock',
        isOutOfStock: true
      });
    }
    
    // Format response with role-specific pricing
    const bundleObj = bundle.toObject();
    
    // Get the role-specific price or default to standard price
    // Use explicit check for undefined/null to allow 0 as a valid price
    const rolePrice = bundle.rolePricing && bundle.rolePricing[userRole] !== undefined && bundle.rolePricing[userRole] !== null
      ? bundle.rolePricing[userRole]
      : bundle.price;
    
    // Replace the standard price with the role-specific price
    // but keep the original price for reference if admin
    if (userRole === 'admin') {
      bundleObj.userPrice = rolePrice;
      bundleObj.allPrices = bundle.rolePricing || { user: bundle.price };
      // Include detailed stock status for admin
      bundleObj.stockInfo = {
        available: bundle.stockUnits?.available || 0,
        reserved: bundle.stockUnits?.reserved || 0,
        sold: bundle.stockUnits?.sold || 0,
        initial: bundle.stockUnits?.initial || 0,
        stockPercentage: bundle.stockPercentage || 0,
        isLowStock: bundle.stockStatus?.isLowStock || false,
        isCriticallyLow: bundle.isCriticallyLow || false,
        lowStockThreshold: bundle.stockUnits?.lowStockThreshold || 10,
        isOutOfStock: bundle.stockStatus?.isOutOfStock || false,
        autoOutOfStock: bundle.stockStatus?.autoOutOfStock || false,
        lastUpdatedAt: bundle.stockUnits?.lastUpdatedAt,
        lastUpdatedBy: bundle.stockUnits?.lastUpdatedBy
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

// Create a new bundle with initial stock (admin only)
router.post('/addbundle', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const { 
      capacity, 
      price, 
      type, 
      rolePricing, 
      initialStock = 0,
      lowStockThreshold = 10 
    } = req.body;
    
    if (!capacity || !price || !type) {
      return res.status(400).json({ 
        success: false, 
        message: 'Capacity, price, and type are required' 
      });
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
        admin: price,
        user: price,
        agent: price,
        Editor: price,
        Business: price,
        Dealers: price,
        Enterprise: price
      },
      // Initialize stock units
      stockUnits: {
        available: initialStock,
        initial: initialStock,
        reserved: 0,
        sold: 0,
        lowStockThreshold: lowStockThreshold,
        lastUpdatedBy: req.user.id,
        lastUpdatedAt: new Date(),
        restockHistory: initialStock > 0 ? [{
          previousUnits: 0,
          addedUnits: initialStock,
          newTotal: initialStock,
          restockedBy: req.user.id,
          restockedAt: new Date(),
          reason: 'Initial stock'
        }] : []
      }
    });
    
    // Update stock status based on initial stock
    await bundle.updateStockStatus();
    
    await bundle.save();
    
    // Log the action
    await ApiLog.create({
      user: req.user.id,
      endpoint: '/api/bundles/addbundle',
      method: 'POST',
      requestData: { capacity, type, price, initialStock },
      responseData: { success: true, bundleId: bundle._id },
      status: 201,
      adminMetadata: {
        adminRole: req.user.role,
        actionType: 'create_bundle',
        actionDescription: `Created bundle ${capacity}MB (${type}) with ${initialStock} units`,
        affectedRecords: 1,
        sensitiveAction: true
      }
    });
    
    res.status(201).json({ 
      success: true, 
      data: bundle,
      message: `Bundle created successfully with ${initialStock} units in stock`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update a bundle by ID (admin only)
router.put('/:id', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    // Don't allow updating stock through this endpoint
    const { stockStatus, isInStock, stockUnits, ...updateData } = req.body;
    
    if (stockStatus !== undefined || isInStock !== undefined || stockUnits !== undefined) {
      return res.status(400).json({ 
        success: false, 
        message: 'Use stock management endpoints to update stock' 
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
 * @route   PUT /api/bundles/stock/:id/restock
 * @desc    Restock a bundle by adding units
 * @access  Admin only
 */
router.put('/stock/:id/restock', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const { units, reason } = req.body;
    
    if (!units || units <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Units must be a positive number'
      });
    }
    
    const bundle = await Bundle.findById(req.params.id);
    
    if (!bundle) {
      return res.status(404).json({
        success: false,
        message: 'Bundle not found'
      });
    }
    
    const previousStock = bundle.stockUnits?.available || 0;
    
    // Restock the bundle
    await bundle.restock(units, req.user.id, reason);
    
    // Log the action
    await ApiLog.create({
      user: req.user.id,
      endpoint: `/api/bundles/stock/${req.params.id}/restock`,
      method: 'PUT',
      requestData: { bundleId: req.params.id, units, reason },
      responseData: { 
        success: true,
        previousStock,
        newStock: bundle.stockUnits.available
      },
      status: 200,
      adminMetadata: {
        adminRole: req.user.role,
        actionType: 'restock_bundle',
        actionDescription: `Restocked bundle ${bundle.capacity}MB (${bundle.type}) with ${units} units`,
        affectedRecords: 1,
        sensitiveAction: true
      }
    });
    
    res.status(200).json({
      success: true,
      message: `Successfully added ${units} units to stock`,
      data: {
        bundleId: bundle._id,
        capacity: bundle.capacity,
        type: bundle.type,
        previousStock,
        addedUnits: units,
        newStock: bundle.stockUnits.available,
        stockPercentage: bundle.stockPercentage,
        isLowStock: bundle.stockStatus.isLowStock,
        restockedBy: req.user.username
      }
    });
  } catch (error) {
    console.error('Error restocking bundle:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @route   PUT /api/bundles/stock/:id/adjust
 * @desc    Adjust bundle stock (increase or decrease)
 * @access  Admin only
 */
router.put('/stock/:id/adjust', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const { adjustment, reason } = req.body;
    
    if (adjustment === undefined || adjustment === 0) {
      return res.status(400).json({
        success: false,
        message: 'Adjustment value is required and must not be zero'
      });
    }
    
    const bundle = await Bundle.findById(req.params.id);
    
    if (!bundle) {
      return res.status(404).json({
        success: false,
        message: 'Bundle not found'
      });
    }
    
    const previousStock = bundle.stockUnits?.available || 0;
    
    // Adjust the stock
    await bundle.adjustStock(adjustment, req.user.id, reason);
    
    // Log the action
    await ApiLog.create({
      user: req.user.id,
      endpoint: `/api/bundles/stock/${req.params.id}/adjust`,
      method: 'PUT',
      requestData: { bundleId: req.params.id, adjustment, reason },
      responseData: { 
        success: true,
        previousStock,
        newStock: bundle.stockUnits.available
      },
      status: 200,
      adminMetadata: {
        adminRole: req.user.role,
        actionType: 'adjust_stock',
        actionDescription: `Adjusted stock for ${bundle.capacity}MB (${bundle.type}) by ${adjustment} units`,
        affectedRecords: 1,
        sensitiveAction: true
      }
    });
    
    res.status(200).json({
      success: true,
      message: `Successfully adjusted stock by ${adjustment} units`,
      data: {
        bundleId: bundle._id,
        capacity: bundle.capacity,
        type: bundle.type,
        previousStock,
        adjustment,
        newStock: bundle.stockUnits.available,
        stockPercentage: bundle.stockPercentage,
        isLowStock: bundle.stockStatus.isLowStock,
        isOutOfStock: bundle.stockStatus.isOutOfStock,
        adjustedBy: req.user.username
      }
    });
  } catch (error) {
    console.error('Error adjusting stock:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @route   PUT /api/bundles/stock/:id/set
 * @desc    Set exact stock units for a bundle
 * @access  Admin only
 */
router.put('/stock/:id/set', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const { units, reason } = req.body;
    
    if (units === undefined || units < 0) {
      return res.status(400).json({
        success: false,
        message: 'Units must be a non-negative number'
      });
    }
    
    const bundle = await Bundle.findById(req.params.id);
    
    if (!bundle) {
      return res.status(404).json({
        success: false,
        message: 'Bundle not found'
      });
    }
    
    const previousStock = bundle.stockUnits?.available || 0;
    const adjustment = units - previousStock;
    
    // Set the stock to exact value
    if (adjustment !== 0) {
      await bundle.adjustStock(adjustment, req.user.id, reason || `Set stock to ${units} units`);
    }
    
    // Log the action
    await ApiLog.create({
      user: req.user.id,
      endpoint: `/api/bundles/stock/${req.params.id}/set`,
      method: 'PUT',
      requestData: { bundleId: req.params.id, units, reason },
      responseData: { 
        success: true,
        previousStock,
        newStock: units
      },
      status: 200,
      adminMetadata: {
        adminRole: req.user.role,
        actionType: 'set_stock',
        actionDescription: `Set stock for ${bundle.capacity}MB (${bundle.type}) to ${units} units`,
        affectedRecords: 1,
        sensitiveAction: true
      }
    });
    
    res.status(200).json({
      success: true,
      message: `Successfully set stock to ${units} units`,
      data: {
        bundleId: bundle._id,
        capacity: bundle.capacity,
        type: bundle.type,
        previousStock,
        newStock: units,
        stockPercentage: bundle.stockPercentage,
        isLowStock: bundle.stockStatus.isLowStock,
        isOutOfStock: bundle.stockStatus.isOutOfStock,
        setBy: req.user.username
      }
    });
  } catch (error) {
    console.error('Error setting stock:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @route   PUT /api/bundles/stock/:id/low-threshold
 * @desc    Update low stock threshold for a bundle
 * @access  Admin only
 */
router.put('/stock/:id/low-threshold', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const { threshold } = req.body;
    
    if (threshold === undefined || threshold < 0) {
      return res.status(400).json({
        success: false,
        message: 'Threshold must be a non-negative number'
      });
    }
    
    const bundle = await Bundle.findById(req.params.id);
    
    if (!bundle) {
      return res.status(404).json({
        success: false,
        message: 'Bundle not found'
      });
    }
    
    // Initialize stockUnits if it doesn't exist
    if (!bundle.stockUnits) {
      bundle.stockUnits = {
        available: 0,
        initial: 0,
        reserved: 0,
        sold: 0,
        lowStockThreshold: 10
      };
    }
    
    const previousThreshold = bundle.stockUnits.lowStockThreshold || 10;
    bundle.stockUnits.lowStockThreshold = threshold;
    bundle.stockUnits.lastUpdatedBy = req.user.id;
    bundle.stockUnits.lastUpdatedAt = new Date();
    
    // Update stock status to reflect new threshold
    await bundle.updateStockStatus();
    await bundle.save();
    
    res.status(200).json({
      success: true,
      message: `Successfully updated low stock threshold to ${threshold} units`,
      data: {
        bundleId: bundle._id,
        type: bundle.type,
        capacity: bundle.capacity,
        previousThreshold,
        newThreshold: threshold,
        currentStock: bundle.stockUnits.available,
        isLowStock: bundle.stockStatus.isLowStock,
        updatedBy: req.user.username
      }
    });
  } catch (error) {
    console.error('Error updating low stock threshold:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @route   GET /api/bundles/stock/low
 * @desc    Get all bundles with low stock
 * @access  Admin only
 */
router.get('/stock/low', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const lowStockBundles = await Bundle.find({
      isActive: true,
      'stockStatus.isLowStock': true
    })
    .populate('stockUnits.lastUpdatedBy', 'username email')
    .sort({ 'stockUnits.available': 1 });
    
    const groupedByType = lowStockBundles.reduce((acc, bundle) => {
      if (!acc[bundle.type]) {
        acc[bundle.type] = [];
      }
      acc[bundle.type].push({
        id: bundle._id,
        capacity: bundle.capacity,
        price: bundle.price,
        available: bundle.stockUnits?.available || 0,
        threshold: bundle.stockUnits?.lowStockThreshold || 10,
        stockPercentage: bundle.stockPercentage || 0,
        isCriticallyLow: bundle.isCriticallyLow || false,
        lastUpdatedBy: bundle.stockUnits?.lastUpdatedBy?.username || 'Unknown',
        lastUpdatedAt: bundle.stockUnits?.lastUpdatedAt
      });
      return acc;
    }, {});
    
    res.status(200).json({
      success: true,
      count: lowStockBundles.length,
      data: lowStockBundles,
      groupedByType,
      summary: {
        totalLowStock: lowStockBundles.length,
        criticallyLow: lowStockBundles.filter(b => b.isCriticallyLow).length,
        byType: Object.keys(groupedByType).map(type => ({
          type,
          count: groupedByType[type].length,
          criticallyLow: groupedByType[type].filter(b => b.isCriticallyLow).length
        }))
      }
    });
  } catch (error) {
    console.error('Error fetching low stock bundles:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @route   GET /api/bundles/stock/:id/history
 * @desc    Get restock history for a specific bundle
 * @access  Admin only
 */
router.get('/stock/:id/history', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const bundle = await Bundle.findById(req.params.id)
      .populate('stockUnits.restockHistory.restockedBy', 'username email')
      .populate('stockUnits.lastUpdatedBy', 'username email');
    
    if (!bundle) {
      return res.status(404).json({
        success: false,
        message: 'Bundle not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: {
        bundleId: bundle._id,
        type: bundle.type,
        capacity: bundle.capacity,
        currentStock: {
          available: bundle.stockUnits?.available || 0,
          reserved: bundle.stockUnits?.reserved || 0,
          sold: bundle.stockUnits?.sold || 0,
          initial: bundle.stockUnits?.initial || 0,
          stockPercentage: bundle.stockPercentage || 0
        },
        lastUpdate: {
          by: bundle.stockUnits?.lastUpdatedBy,
          at: bundle.stockUnits?.lastUpdatedAt
        },
        restockHistory: bundle.stockUnits?.restockHistory?.sort((a, b) => 
          new Date(b.restockedAt) - new Date(a.restockedAt)
        ) || []
      }
    });
  } catch (error) {
    console.error('Error fetching stock history:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @route   PUT /api/bundles/stock/bulk-restock
 * @desc    Restock multiple bundles at once
 * @access  Admin only
 */
router.put('/stock/bulk-restock', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const { updates, reason } = req.body;
    
    // Validate input
    if (!updates || !Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Updates array is required'
      });
    }
    
    if (updates.length > 50) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 50 bundles can be updated at once'
      });
    }
    
    const results = [];
    const errors = [];
    
    // Process each update
    for (const update of updates) {
      try {
        const { bundleId, units } = update;
        
        if (!bundleId || !units || units <= 0) {
          errors.push({
            bundleId,
            error: 'Invalid bundleId or units'
          });
          continue;
        }
        
        const bundle = await Bundle.findById(bundleId);
        if (!bundle) {
          errors.push({
            bundleId,
            error: 'Bundle not found'
          });
          continue;
        }
        
        const previousStock = bundle.stockUnits?.available || 0;
        await bundle.restock(units, req.user.id, reason || 'Bulk restock');
        
        results.push({
          bundleId: bundle._id,
          type: bundle.type,
          capacity: bundle.capacity,
          previousStock,
          addedUnits: units,
          newStock: bundle.stockUnits.available
        });
      } catch (error) {
        errors.push({
          bundleId: update.bundleId,
          error: error.message
        });
      }
    }
    
    // Log the action
    await ApiLog.create({
      user: req.user.id,
      endpoint: '/api/bundles/stock/bulk-restock',
      method: 'PUT',
      requestData: { updates, reason },
      responseData: { 
        success: true,
        successCount: results.length,
        errorCount: errors.length
      },
      status: 200,
      adminMetadata: {
        adminRole: req.user.role,
        actionType: 'bulk_restock',
        actionDescription: `Bulk restocked ${results.length} bundles`,
        affectedRecords: results.length,
        sensitiveAction: true
      }
    });
    
    res.status(200).json({
      success: true,
      message: `Successfully restocked ${results.length} bundles`,
      data: {
        successCount: results.length,
        errorCount: errors.length,
        results,
        errors: errors.length > 0 ? errors : undefined,
        restockedBy: req.user.username,
        timestamp: new Date()
      }
    });
  } catch (error) {
    console.error('Error in bulk restock:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @route   PUT /api/bundles/stock/:id/out-of-stock
 * @desc    Mark a specific bundle as out of stock (legacy compatibility)
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
    
    // If bundle has stock units, set them to 0
    if (bundle.stockUnits) {
      bundle.stockUnits.available = 0;
      bundle.stockUnits.lastUpdatedBy = req.user.id;
      bundle.stockUnits.lastUpdatedAt = new Date();
    }
    
    // Update stock status
    bundle.isInStock = false;
    bundle.stockStatus = {
      isOutOfStock: true,
      reason: reason || 'Manually marked as out of stock',
      markedOutOfStockBy: req.user.id,
      markedOutOfStockAt: new Date(),
      autoOutOfStock: false
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
        stockUnits: bundle.stockUnits,
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
 * @desc    Mark a specific bundle as back in stock (legacy compatibility)
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
    
    // Note: This endpoint doesn't add stock units, just changes the status
    // Admin should use the restock endpoint to add actual units
    
    // Update stock status
    bundle.isInStock = true;
    bundle.stockStatus = {
      isOutOfStock: false,
      isLowStock: (bundle.stockUnits?.available || 0) <= (bundle.stockUnits?.lowStockThreshold || 10),
      reason: null,
      markedInStockBy: req.user.id,
      markedInStockAt: new Date(),
      autoOutOfStock: false
    };
    bundle.updatedAt = new Date();
    
    await bundle.save();
    
    // Log the action
    await ApiLog.create({
      user: req.user.id,
      endpoint: `/api/bundles/stock/${req.params.id}/in-stock`,
      method: 'PUT',
      requestData: { bundleId: req.params.id },
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
      message: 'Bundle marked as back in stock. Use restock endpoint to add units.',
      data: {
        bundleId: bundle._id,
        capacity: bundle.capacity,
        type: bundle.type,
        stockStatus: bundle.stockStatus,
        stockUnits: bundle.stockUnits,
        markedBy: req.user.username,
        note: 'Stock units remain at ' + (bundle.stockUnits?.available || 0) + '. Use restock endpoint to add units.'
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
      $or: [
        { 'stockStatus.isOutOfStock': true },
        { 'stockUnits.available': 0 }
      ]
    })
    .populate('stockStatus.markedOutOfStockBy', 'username email')
    .populate('stockUnits.lastUpdatedBy', 'username email')
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
        stockUnits: bundle.stockUnits?.available || 0,
        reason: bundle.stockStatus?.reason,
        markedOutBy: bundle.stockStatus?.markedOutOfStockBy?.username || 
                     bundle.stockUnits?.lastUpdatedBy?.username || 'Unknown',
        markedOutAt: bundle.stockStatus?.markedOutOfStockAt || bundle.stockUnits?.lastUpdatedAt,
        autoOutOfStock: bundle.stockStatus?.autoOutOfStock || false
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
        autoOutOfStock: outOfStockBundles.filter(b => b.stockStatus?.autoOutOfStock).length,
        manualOutOfStock: outOfStockBundles.filter(b => !b.stockStatus?.autoOutOfStock).length,
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
 * @desc    Get comprehensive stock status for all bundles
 * @access  Admin only
 */
router.get('/stock/status', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const allBundles = await Bundle.find({ isActive: true })
      .populate('stockUnits.lastUpdatedBy', 'username')
      .sort({ type: 1, capacity: 1 });
    
    const totalUnitsAvailable = allBundles.reduce((sum, b) => sum + (b.stockUnits?.available || 0), 0);
    const totalUnitsSold = allBundles.reduce((sum, b) => sum + (b.stockUnits?.sold || 0), 0);
    const totalUnitsReserved = allBundles.reduce((sum, b) => sum + (b.stockUnits?.reserved || 0), 0);
    
    const bundlesByType = allBundles.reduce((acc, bundle) => {
      if (!acc[bundle.type]) {
        acc[bundle.type] = {
          type: bundle.type,
          total: 0,
          inStock: 0,
          outOfStock: 0,
          lowStock: 0,
          totalUnits: 0,
          totalSold: 0,
          bundles: []
        };
      }
      
      acc[bundle.type].total++;
      acc[bundle.type].totalUnits += bundle.stockUnits?.available || 0;
      acc[bundle.type].totalSold += bundle.stockUnits?.sold || 0;
      
      if ((bundle.stockUnits?.available || 0) === 0) {
        acc[bundle.type].outOfStock++;
      } else {
        acc[bundle.type].inStock++;
        if (bundle.stockStatus?.isLowStock) {
          acc[bundle.type].lowStock++;
        }
      }
      
      acc[bundle.type].bundles.push({
        id: bundle._id,
        capacity: bundle.capacity,
        price: bundle.price,
        stockUnits: {
          available: bundle.stockUnits?.available || 0,
          reserved: bundle.stockUnits?.reserved || 0,
          sold: bundle.stockUnits?.sold || 0,
          initial: bundle.stockUnits?.initial || 0
        },
        stockPercentage: bundle.stockPercentage || 0,
        isLowStock: bundle.stockStatus?.isLowStock || false,
        isCriticallyLow: bundle.isCriticallyLow || false,
        isOutOfStock: bundle.stockStatus?.isOutOfStock || false
      });
      
      return acc;
    }, {});
    
    res.status(200).json({
      success: true,
      summary: {
        totalBundles: allBundles.length,
        totalUnitsAvailable,
        totalUnitsSold,
        totalUnitsReserved,
        inStock: allBundles.filter(b => (b.stockUnits?.available || 0) > 0).length,
        outOfStock: allBundles.filter(b => (b.stockUnits?.available || 0) === 0).length,
        lowStock: allBundles.filter(b => b.stockStatus?.isLowStock).length,
        criticallyLow: allBundles.filter(b => b.isCriticallyLow).length
      },
      byType: Object.values(bundlesByType),
      detailedBundles: allBundles
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
 * @desc    Update stock status for multiple bundles at once (legacy compatibility)
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
    
    // Get bundle details before update
    const bundlesToUpdate = await Bundle.find({ _id: { $in: bundleIds } });
    const bundleDetails = bundlesToUpdate.map(b => ({
      id: b._id,
      capacity: b.capacity,
      type: b.type,
      previousStatus: b.stockStatus?.isOutOfStock ? 'out-of-stock' : 'in-stock',
      previousUnits: b.stockUnits?.available || 0
    }));
    
    // Update each bundle
    const results = [];
    for (const bundle of bundlesToUpdate) {
      if (action === 'out-of-stock') {
        if (bundle.stockUnits) {
          bundle.stockUnits.available = 0;
          bundle.stockUnits.lastUpdatedBy = req.user.id;
          bundle.stockUnits.lastUpdatedAt = new Date();
        }
        bundle.isInStock = false;
        bundle.stockStatus = {
          isOutOfStock: true,
          reason: reason || 'Bulk update - marked out of stock',
          markedOutOfStockBy: req.user.id,
          markedOutOfStockAt: new Date(),
          autoOutOfStock: false
        };
      } else {
        bundle.isInStock = true;
        bundle.stockStatus = {
          isOutOfStock: false,
          isLowStock: (bundle.stockUnits?.available || 0) <= (bundle.stockUnits?.lowStockThreshold || 10),
          reason: null,
          markedInStockBy: req.user.id,
          markedInStockAt: new Date(),
          autoOutOfStock: false
        };
      }
      
      bundle.updatedAt = new Date();
      await bundle.save();
      results.push(bundle);
    }
    
    // Log the action
    await ApiLog.create({
      user: req.user.id,
      endpoint: '/api/bundles/stock/bulk-update',
      method: 'PUT',
      requestData: { bundleIds, action, reason },
      responseData: { 
        success: true, 
        modifiedCount: results.length,
        bundleDetails 
      },
      status: 200,
      adminMetadata: {
        adminRole: req.user.role,
        actionType: `bulk_${action.replace('-', '_')}`,
        actionDescription: `Bulk marked ${results.length} bundles as ${action}`,
        targetUserId: null,
        affectedRecords: results.length,
        sensitiveAction: true
      }
    });
    
    res.status(200).json({
      success: true,
      message: `Successfully updated ${results.length} bundles`,
      data: {
        requestedCount: bundleIds.length,
        modifiedCount: results.length,
        action: action,
        updatedBundles: bundleDetails,
        updatedBy: req.user.username,
        timestamp: new Date(),
        note: action === 'in-stock' ? 'Stock units not changed. Use bulk restock to add units.' : null
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
    const { type, capacity, action, reason, units } = req.body;
    
    // Validate input
    if (!type || capacity === undefined || !action) {
      return res.status(400).json({
        success: false,
        message: 'Type, capacity, and action are required'
      });
    }
    
    if (!['out-of-stock', 'in-stock', 'set-units'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Action must be "out-of-stock", "in-stock", or "set-units"'
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
    
    // Initialize stockUnits if it doesn't exist
    if (!bundle.stockUnits) {
      bundle.stockUnits = {
        available: 0,
        initial: 0,
        reserved: 0,
        sold: 0,
        lowStockThreshold: 10
      };
    }
    
    // Update based on action
    if (action === 'set-units' && units !== undefined) {
      const adjustment = units - (bundle.stockUnits.available || 0);
      await bundle.adjustStock(adjustment, req.user.id, reason || `Set stock to ${units} units`);
    } else if (action === 'out-of-stock') {
      bundle.stockUnits.available = 0;
      bundle.stockUnits.lastUpdatedBy = req.user.id;
      bundle.stockUnits.lastUpdatedAt = new Date();
      bundle.isInStock = false;
      bundle.stockStatus = {
        isOutOfStock: true,
        reason: reason || 'No reason provided',
        markedOutOfStockBy: req.user.id,
        markedOutOfStockAt: new Date()
      };
      await bundle.save();
    } else {
      bundle.isInStock = true;
      bundle.stockStatus = {
        isOutOfStock: false,
        isLowStock: bundle.stockUnits.available <= bundle.stockUnits.lowStockThreshold,
        reason: null,
        markedInStockBy: req.user.id,
        markedInStockAt: new Date()
      };
      await bundle.save();
    }
    
    // Log the action
    await ApiLog.create({
      user: req.user.id,
      endpoint: '/api/bundles/stock/by-type-capacity',
      method: 'PUT',
      requestData: { type, capacity, action, reason, units },
      responseData: { success: true, bundleId: bundle._id },
      status: 200,
      adminMetadata: {
        adminRole: req.user.role,
        actionType: `mark_${action.replace('-', '_')}`,
        actionDescription: `Updated ${type} ${capacity}MB bundle: ${action}`,
        targetUserId: null,
        affectedRecords: 1,
        sensitiveAction: true
      }
    });
    
    res.status(200).json({
      success: true,
      message: `Successfully updated ${type} ${capacity}MB bundle`,
      data: {
        bundleId: bundle._id,
        type: bundle.type,
        capacity: bundle.capacity,
        stockStatus: bundle.stockStatus,
        stockUnits: {
          available: bundle.stockUnits.available,
          reserved: bundle.stockUnits.reserved,
          sold: bundle.stockUnits.sold
        },
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
      .populate('stockUnits.lastUpdatedBy', 'username')
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
            outOfStock: 0,
            lowStock: 0,
            totalUnits: 0,
            totalSold: 0
          }
        };
      }
      
      acc[bundle.type].bundles.push(bundle);
      acc[bundle.type].summary.total++;
      acc[bundle.type].summary.totalUnits += bundle.stockUnits?.available || 0;
      acc[bundle.type].summary.totalSold += bundle.stockUnits?.sold || 0;
      
      if ((bundle.stockUnits?.available || 0) === 0) {
        acc[bundle.type].summary.outOfStock++;
      } else {
        acc[bundle.type].summary.inStock++;
        if (bundle.stockStatus?.isLowStock) {
          acc[bundle.type].summary.lowStock++;
        }
      }
      
      return acc;
    }, {});
    
    res.status(200).json({
      success: true,
      data: groupedBundles,
      overallSummary: {
        totalBundles: bundles.length,
        totalInStock: bundles.filter(b => (b.stockUnits?.available || 0) > 0).length,
        totalOutOfStock: bundles.filter(b => (b.stockUnits?.available || 0) === 0).length,
        totalLowStock: bundles.filter(b => b.stockStatus?.isLowStock).length,
        bundleTypes: Object.keys(groupedBundles).length
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;