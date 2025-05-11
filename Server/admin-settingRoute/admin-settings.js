// routes/admin-settings.js
const express = require('express');
const router = express.Router();
const AdminSettings = require('../AdminSettingSchema/AdminSettings.js');
const adminAuth = require('../adminMiddlware/middleware.js'); 

/**
 * @route   GET /api/admin/settings
 * @desc    Get current admin settings
 * @access  Admin
 */
router.get('/', adminAuth, async (req, res) => {
  try {
    const settings = await AdminSettings.getSettings();
    
    res.status(200).json({
      success: true,
      data: settings
    });
  } catch (error) {
    console.error('Error fetching admin settings:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

/**
 * @route   PUT /api/admin/settings
 * @desc    Update admin settings
 * @access  Admin
 */
router.put('/', adminAuth, async (req, res) => {
  try {
    const { apiIntegrations, notifications } = req.body;
    
    // Create updates object with only the fields that are provided
    const updates = {};
    
    if (apiIntegrations !== undefined) {
      updates.apiIntegrations = apiIntegrations;
    }
    
    if (notifications !== undefined) {
      updates.notifications = notifications;
    }
    
    // Update settings
    const updatedSettings = await AdminSettings.updateSettings(updates, req.user.id);
    
    res.status(200).json({
      success: true,
      message: 'Settings updated successfully',
      data: updatedSettings
    });
  } catch (error) {
    console.error('Error updating admin settings:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

/**
 * @route   PUT /api/admin/settings/toggle-mtn-api
 * @desc    Toggle MTN Hubnet API integration on/off
 * @access  Admin
 */
router.put('/toggle-mtn-api', adminAuth, async (req, res) => {
  try {
    const settings = await AdminSettings.getSettings();
    
    // Toggle the mtnHubnetEnabled setting
    const currentValue = settings.apiIntegrations?.mtnHubnetEnabled ?? true;
    const newValue = !currentValue;
    
    // Update the setting
    const updates = {
      apiIntegrations: {
        mtnHubnetEnabled: newValue
      }
    };
    
    const updatedSettings = await AdminSettings.updateSettings(updates, req.user.id);
    
    res.status(200).json({
      success: true,
      message: `MTN Hubnet API integration has been ${newValue ? 'enabled' : 'disabled'}`,
      data: {
        mtnHubnetEnabled: newValue
      }
    });
  } catch (error) {
    console.error('Error toggling MTN API setting:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

/**
 * @route   PUT /api/admin/settings/toggle-at-api
 * @desc    Toggle AT-ishare Hubnet API integration on/off
 * @access  Admin
 */
router.put('/toggle-at-api', adminAuth, async (req, res) => {
  try {
    const settings = await AdminSettings.getSettings();
    
    // Toggle the atHubnetEnabled setting
    const currentValue = settings.apiIntegrations?.atHubnetEnabled ?? true;
    const newValue = !currentValue;
    
    // Update the setting
    const updates = {
      apiIntegrations: {
        atHubnetEnabled: newValue
      }
    };
    
    const updatedSettings = await AdminSettings.updateSettings(updates, req.user.id);
    
    res.status(200).json({
      success: true,
      message: `AT-ishare Hubnet API integration has been ${newValue ? 'enabled' : 'disabled'}`,
      data: {
        atHubnetEnabled: newValue
      }
    });
  } catch (error) {
    console.error('Error toggling AT API setting:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

module.exports = router;