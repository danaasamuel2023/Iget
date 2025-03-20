// adminMiddleware/middleware.js
const jwt = require('jsonwebtoken');
const { User } = require('../schema/schema'); // Adjust path as needed

/**
 * Middleware to verify admin privileges
 */
module.exports = async function(req, res, next) {
  try {
    // Check if req.user exists from previous middleware
    if (!req.user) {
      // If authMiddleware hasn't set req.user, we can check directly
      const token = req.header('Authorization')?.replace('Bearer ', '');
      
      if (!token) {
        return res.status(401).json({
          success: false,
          message: 'No authentication token, access denied'
        });
      }
      
      // Verify token
      const decoded = jwt.verify(token, 'Igetbysamtech');
      
      // Access userId from the decoded token (matching your auth routes structure)
      const userId = decoded.userId;
      
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Invalid token structure'
        });
      }
      
      // Check if user exists and has admin role
      const user = await User.findById(userId).select('-password');
      
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'User not found'
        });
      }
      
      if (!user.isActive) {
        return res.status(401).json({
          success: false,
          message: 'User account is deactivated'
        });
      }
      
      if (user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Access denied: Admin privileges required'
        });
      }
      
      // Set req.user for downstream middleware and payload structure
      req.user = user;
      req.payload = {
        id: user._id,
        userId: user.id,
        role: user.role
      };
    } else {
      // If req.user is already set by authMiddleware
      // Just check if user has admin role
      if (req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Access denied: Admin privileges required'
        });
      }
      
      // Set payload structure for consistency
      req.payload = {
        id: req.user._id,
        userId: req.user.id,
        role: req.user.role
      };
    }
    
    next();
  } catch (error) {
    console.error('Admin auth middleware error:', error);
    res.status(401).json({
      success: false,
      message: 'Admin authorization failed',
      error: error.message
    });
  }
};