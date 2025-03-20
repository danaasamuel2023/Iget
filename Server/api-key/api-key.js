// routes/users.js
const express = require('express');
const router = express.Router();
const { User } = require('../schema/schema');
const authMiddleware = require('./../AuthMiddle/middlewareauth');

// Generate API key for authenticated user
router.post('/generate-api-key', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Generate a new API key
    const apiKey = user.generateApiKey();
    await user.save();
    
    res.status(200).json({ 
      success: true, 
      message: 'API key generated successfully',
      data: { 
        apiKey: apiKey 
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get current API key (if it exists)
router.get('/api-key', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    if (!user.apiKey) {
      return res.status(404).json({ 
        success: false, 
        message: 'No API key found. Please generate one.',
        hasApiKey: false
      });
    }
    
    res.status(200).json({ 
      success: true, 
      hasApiKey: true,
      // Only show last 4 characters for security
      apiKey: '••••••••' + user.apiKey.slice(-4)
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Revoke API key
router.delete('/api-key', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    user.apiKey = undefined;
    await user.save();
    
    res.status(200).json({ 
      success: true, 
      message: 'API key revoked successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;