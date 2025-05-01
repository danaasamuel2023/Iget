// routes/networkAvailability.js
const express = require('express');
const router = express.Router();
const NetworkAvailability = require('../NetworkStock/Schema.js'); 
const adminAuth = require('../adminMiddlware/middleware.js'); // Admin authentication middleware

/**
 * @route   GET /api/network/availability
 * @desc    Get all network availability statuses
 * @access  Public
 */
router.get('/', async (req, res) => {
  try {
    const availabilities = await NetworkAvailability.find()
      .sort({ networkType: 1 });
    
    res.status(200).json({
      success: true,
      count: availabilities.length,
      data: availabilities
    });
  } catch (error) {
    console.error('Error fetching network availabilities:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

/**
 * @route   PUT /api/network/availability/:networkType
 * @desc    Toggle availability status for a network
 * @access  Admin
 */
router.put('/:networkType', adminAuth, async (req, res) => {
  try {
    const { networkType } = req.params;
    const { isAvailable, unavailableMessage } = req.body;
    
    if (isAvailable === undefined) {
      return res.status(400).json({
        success: false,
        message: 'isAvailable status is required'
      });
    }
    
    const validNetworkTypes = ['mtnup2u', 'mtn-fibre', 'mtn-justforu', 'AT-ishare', 'Telecel-5959', 'AfA-registration', 'other'];
    if (!validNetworkTypes.includes(networkType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid network type'
      });
    }
    
    const updateData = {
      isAvailable,
      updatedBy: req.user.id,
      updatedAt: Date.now()
    };
    
    // Only update unavailableMessage if it's provided
    if (unavailableMessage) {
      updateData.unavailableMessage = unavailableMessage;
    }
    
    // Find and update or create if doesn't exist (upsert)
    const availability = await NetworkAvailability.findOneAndUpdate(
      { networkType },
      updateData,
      { new: true, upsert: true }
    );
    
    const statusText = isAvailable ? 'Available' : 'Out of Stock';
    
    res.status(200).json({
      success: true,
      message: `${networkType} has been marked as ${statusText}`,
      data: availability
    });
  } catch (error) {
    console.error('Error updating network availability:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/network/availability/:networkType
 * @desc    Get availability status for a specific network
 * @access  Public
 */
router.get('/:networkType', async (req, res) => {
  try {
    const { networkType } = req.params;
    
    const validNetworkTypes = ['mtnup2u', 'mtn-fibre', 'mtn-justforu', 'AT-ishare', 'Telecel-5959', 'AfA-registration', 'other'];
    if (!validNetworkTypes.includes(networkType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid network type'
      });
    }
    
    // Find or create default if doesn't exist
    let availability = await NetworkAvailability.findOne({ networkType });
    
    // If not found, create a default record
    if (!availability) {
      availability = new NetworkAvailability({ networkType });
      await availability.save();
    }
    
    res.status(200).json({
      success: true,
      data: availability
    });
  } catch (error) {
    console.error('Error fetching network availability:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/network/availability/initialize
 * @desc    Initialize all network types with default availability
 * @access  Admin
 */
router.post('/initialize', adminAuth, async (req, res) => {
  try {
    const networkTypes = ['mtnup2u', 'mtn-fibre', 'mtn-justforu', 'AT-ishare', 'Telecel-5959', 'AfA-registration', 'other'];
    
    const operations = networkTypes.map(networkType => ({
      updateOne: {
        filter: { networkType },
        update: { 
          $setOnInsert: { 
            networkType,
            isAvailable: true,
            unavailableMessage: 'This network is currently unavailable. Please try again later.',
            updatedBy: req.user.id,
            updatedAt: Date.now()
          }
        },
        upsert: true
      }
    }));
    
    await NetworkAvailability.bulkWrite(operations);
    
    const availabilities = await NetworkAvailability.find()
      .sort({ networkType: 1 });
    
    res.status(200).json({
      success: true,
      message: 'All network availabilities initialized',
      count: availabilities.length,
      data: availabilities
    });
  } catch (error) {
    console.error('Error initializing network availabilities:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

module.exports = router;