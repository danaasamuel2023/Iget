// adminMiddleware/middleware.js - Updated version
const jwt = require('jsonwebtoken');
const { User } = require('../schema/schema');
const { executeWithRetry } = require('../connection/connection'); // Add this import

/**
 * Middleware to verify admin privileges
 * Works with both scenarios: when auth middleware has run or standalone
 */
module.exports = async function(req, res, next) {
  try {
    console.log('🛡️ AdminAuth middleware started');
    console.log('👤 Current req.user from auth middleware:', {
      exists: !!req.user,
      id: req.user?.id || req.user?._id,
      username: req.user?.username,
      role: req.user?.role
    });

    let user = req.user;

    // If req.user doesn't exist or is incomplete, try to authenticate directly
    if (!req.user || !req.user.role) {
      console.log('🔄 Auth middleware didn\'t set req.user properly, authenticating directly...');
      
      const authHeader = req.headers.authorization || req.header('Authorization');
      
      if (!authHeader) {
        console.error('❌ No authorization header found');
        return res.status(401).json({
          success: false,
          message: 'No authentication token, access denied'
        });
      }
      
      // Extract token
      const token = authHeader.startsWith('Bearer ') 
        ? authHeader.slice(7) 
        : authHeader.replace('Bearer ', '');
      
      if (!token) {
        console.error('❌ No token found in header');
        return res.status(401).json({
          success: false,
          message: 'No authentication token found'
        });
      }
      
      console.log('🎫 Token found, verifying...');
      
      // Verify token
      let decoded;
      try {
        decoded = jwt.verify(token, 'Igetbysamtech');
        console.log('✅ Token verified directly in admin middleware');
        console.log('📄 Token structure:', Object.keys(decoded));
      } catch (jwtError) {
        console.error('❌ JWT verification failed:', jwtError.message);
        return res.status(401).json({
          success: false,
          message: 'Invalid token',
          error: jwtError.message
        });
      }
      
      // Get user ID from token - try different field names
      const userId = decoded.userId || decoded.id || decoded._id;
      
      if (!userId) {
        console.error('❌ No user ID found in token');
        return res.status(401).json({
          success: false,
          message: 'Invalid token structure - no user ID found',
          debug: 'Available fields: ' + Object.keys(decoded).join(', ')
        });
      }
      
      console.log('🔍 Looking up user with ID:', userId);
      
      // Get user from database with retry logic for MongoDB replica set errors
      try {
        user = await executeWithRetry(
          async () => await User.findById(userId).select('-password'),
          'Admin middleware: Find user by ID'
        );
      } catch (dbError) {
        console.error('❌ Database error when fetching user:', dbError.message);
        
        // If executeWithRetry still fails after retries, handle the error
        if (dbError.name === 'MongoServerSelectionError' || 
            dbError.message?.includes('primary marked stale') ||
            dbError.message?.includes('ReplicaSetNoPrimary')) {
          return res.status(503).json({
            success: false,
            message: 'Database service temporarily unavailable. Please try again in a few seconds.',
            retryAfter: 5 // seconds
          });
        }
        
        // For other database errors
        return res.status(500).json({
          success: false,
          message: 'Database error occurred',
          error: process.env.NODE_ENV === 'development' ? dbError.message : undefined
        });
      }
      
      if (!user) {
        console.error('❌ User not found in database');
        return res.status(401).json({
          success: false,
          message: 'User not found'
        });
      }
      
      console.log('✅ User found:', {
        id: user._id,
        username: user.username,
        role: user.role
      });
      
      // Set req.user for downstream middleware
      req.user = {
        id: user._id,
        _id: user._id,
        userId: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        isActive: user.isActive
      };
    }
    
    // Check if user account is active
    if (!user.isActive) {
      console.error('❌ User account is deactivated:', user.username);
      return res.status(401).json({
        success: false,
        message: 'User account is deactivated'
      });
    }
    
    // Check if user has admin privileges (allow multiple admin roles)
    const allowedRoles = ['admin', 'wallet_admin', 'Editor'];
    
    if (!allowedRoles.includes(user.role)) {
      console.error('❌ User does not have admin privileges:', user.role);
      return res.status(403).json({
        success: false,
        message: 'Access denied: Admin privileges required',
        yourRole: user.role,
        allowedRoles: allowedRoles,
        note: 'Only Admins, Wallet Admins, and Editors can access this resource'
      });
    }
    
    console.log('✅ Admin authentication successful:', {
      username: user.username,
      role: user.role
    });
    
    // Set payload structure for consistency with your existing code
    req.payload = {
      id: user._id,
      userId: user._id,
      role: user.role
    };
    
    next();
  } catch (error) {
    console.error('💥 Admin auth middleware error:', error);
    
    // Handle MongoDB replica set errors that might occur elsewhere
    if (error.name === 'MongoServerSelectionError' || 
        error.message?.includes('primary marked stale') ||
        error.message?.includes('ReplicaSetNoPrimary')) {
      return res.status(503).json({
        success: false,
        message: 'Database service temporarily unavailable. Please try again in a few seconds.',
        retryAfter: 5
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Admin authorization failed',
      error: error.message
    });
  }
};