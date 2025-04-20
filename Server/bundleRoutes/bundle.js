// routes/bundles.js with improved role-based pricing
const express = require('express');
const router = express.Router();
const { Bundle, User } = require('../schema/schema');
const authMiddleware = require('../AuthMiddle/middlewareauth');
const adminMiddleware = require('../adminMiddlware/middleware');

// Get all active bundles with prices based on user role
router.get('/bundle', authMiddleware, async (req, res) => {
  try {
    // Get user's role from auth middleware
    const userRole = req.user.role || 'user';
    
    // Find all active bundles
    const bundles = await Bundle.find({ isActive: true });
    
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
      } else {
        bundleObj.price = rolePrice; // Override the price with role-specific price
      }
      
      return bundleObj;
    });
    
    res.status(200).json({ 
      success: true, 
      userRole: userRole, // Include the user's role in the response
      data: bundlesWithUserPrices 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get bundles by type with prices based on user role
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
    
    // Find active bundles of the specified type
    const bundles = await Bundle.find({ isActive: true, type });
    
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
      } else {
        bundleObj.price = rolePrice; // Override the price with role-specific price
      }
      
      return bundleObj;
    });
    
    res.status(200).json({ 
      success: true, 
      userRole: userRole, // Include the user's role in the response
      data: bundlesWithUserPrices 
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
    } else {
      bundleObj.price = rolePrice; // Override the price with role-specific price
    }
    
    res.status(200).json({ 
      success: true, 
      userRole: userRole, // Include the user's role in the response
      data: bundleObj 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Create a new bundle (admin only)
router.post('/addbundle', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const { capacity, price, type, rolePricing } = req.body;
    
    if (!capacity || !price || !type) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
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
      }
    });
    
    await bundle.save();
    
    res.status(201).json({ success: true, data: bundle });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update a bundle by ID (admin only)
router.put('/:id', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const bundle = await Bundle.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedAt: Date.now() },
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
    
    res.status(200).json({ success: true, data: {} });
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

module.exports = router;