// adminRoutes.js
const express = require('express');
const router = express.Router();
const { User, ApiLog } = require('./../schema/schema');
const  authenticate  = require('../adminMiddlware/middleware'); // Import your existing authenticate middleware

/**
 * Check if the current user has admin role
 * Route: GET /api/auth/check-admin
 */
router.get('/check-admin', authenticate, async (req, res) => {
  try {
  
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    // Fetch the full user from database to ensure we have fresh data
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Check if user is active and has admin role
    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Account is inactive' });
    }
    
    const isAdmin = user.role === 'admin';
    
    // Log this admin check for audit purposes
    await ApiLog.create({
      user: user._id,
      endpoint: '/api/auth/check-admin',
      method: 'GET',
      ipAddress: req.ip,
      status: 200,
      requestData: {},
      responseData: { isAdmin },
    });
    
    return res.status(200).json({ 
      success: true, 
      isAdmin,
      username: user.username,
      role: user.role
    });
    
  } catch (error) {
    console.error('Admin check error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error during admin verification'
    });
  }
});

module.exports = router;