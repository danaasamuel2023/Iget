const jwt = require('jsonwebtoken');
const { User } = require('../schema/schema'); // Import your User model
const { executeWithRetry } = require('../connection/connection'); // Add this import

const authMiddleware = async (req, res, next) => {
  try {
    // Get token from Authorization header
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    // Check if token exists
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No authentication token provided.'
      });
    }
    
    // Verify token
    const decoded = jwt.verify(token, 'Igetbysamtech');
    
    // Get user ID from decoded token (handle different possible field names)
    const userId = decoded.id || decoded.userId || decoded._id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token structure'
      });
    }
    
    // Fetch complete user data from database with retry logic
    const user = await executeWithRetry(
      async () => await User.findById(userId).select('-password'), // Exclude password
      'Auth middleware: Find user by ID'
    );
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Check if user account is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'User account is deactivated'
      });
    }
    
    // Set complete user info on the request object
    req.user = user; // This gives you access to user._id, user.username, user.email, user.role, etc.
    
    // Also set a simplified payload for backward compatibility
    req.payload = {
      id: user._id,
      userId: user._id,
      role: user.role,
      username: user.username,
      email: user.email
    };
    
    next();
  } catch (error) {
    console.error('API Authentication Error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid authentication token'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Authentication token expired'
      });
    }
    
    // Handle MongoDB replica set errors
    if (error.name === 'MongoServerSelectionError' || 
        error.message?.includes('primary marked stale') ||
        error.message?.includes('ReplicaSetNoPrimary')) {
      return res.status(503).json({
        success: false,
        message: 'Database service temporarily unavailable. Please try again.',
        retryAfter: 5 // seconds
      });
    }
    
    // Handle database connection errors
    if (error.name === 'MongooseError' || error.name === 'MongoError') {
      return res.status(500).json({
        success: false,
        message: 'Database connection error'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Authentication failed',
      error: error.message
    });
  }
};

module.exports = authMiddleware;