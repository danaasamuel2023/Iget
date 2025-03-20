// routes/bundles.js
const express = require('express');
const router = express.Router();
const { Bundle ,User} = require('../schema/schema');
const authMiddleware = require('../AuthMiddle/middlewareauth');
const adminMiddleware = require('../adminMiddlware/middleware');

// Create a new bundle (admin only)
router.post('/addbundle', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const {capacity, price, type } = req.body;
    
    if (!capacity || !price || !type) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }
    
    const bundle = new Bundle({
      capacity,
      price,
      type
    });
    
    await bundle.save();
    
    res.status(201).json({ success: true, data: bundle });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
 
// Get all active bundles
router.get('/bundle', async (req, res) => {
  try {
    const bundles = await Bundle.find({ isActive: true });
    res.status(200).json({ success: true, data: bundles });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get bundles by type
router.get('/bundle/:type', async (req, res) => {
  try {
    const { type } = req.params;
    
    // Validate if type is one of the allowed enum values
    const allowedTypes = ['mtnup2u', 'mtn-fibre', 'mtn-justforu', 'AT-ishare', 'Telecel-5959', 'AfA-registration', 'other'];
    
    if (!allowedTypes.includes(type)) {
      return res.status(400).json({ success: false, message: 'Invalid bundle type' });
    }
    
    // Find active bundles of the specified type
    const bundles = await Bundle.find({ isActive: true, type });
    
    res.status(200).json({ success: true, data: bundles });
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

// Update all bundles by type (admin only)
router.put('/type/:type', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const { type } = req.params;
    
    // Validate if type is one of the allowed enum values
    const allowedTypes = ['mtnup2u', 'mtn-fibre', 'mtn-justforu', 'AT-ishare', 'Telecel-5959', 'AfA-registration', 'other'];
    
    if (!allowedTypes.includes(type)) {
      return res.status(400).json({ success: false, message: 'Invalid bundle type' });
    }
    
    const updateData = req.body;
    
    // Remove any fields that shouldn't be bulk-updated
    delete updateData._id;
    delete updateData.type; // Don't allow changing the type itself in bulk update
    
    // Add updated timestamp
    updateData.updatedAt = Date.now();
    
    // Update all active bundles of the specified type
    const result = await Bundle.updateMany(
      { type, isActive: true },
      { $set: updateData },
      { runValidators: true }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: 'No active bundles found with this type' });
    }
    
    res.status(200).json({ 
      success: true, 
      message: `Updated ${result.modifiedCount} bundle(s)`,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount
    });
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