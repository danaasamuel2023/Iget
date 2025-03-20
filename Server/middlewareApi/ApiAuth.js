// middleware/apiAuth.js
const { User } = require('../schema/schema');

/**
 * API Key Authentication Middleware
 * Verifies the API key in the request header and attaches the user to the request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const apiAuth = async (req, res, next) => {
  try {
    // Check if API key is provided in the header
    const apiKey = req.header('X-API-Key');
    
    if (!apiKey) {
      return res.status(401).json({ 
        success: false, 
        message: 'API key is required' 
      });
    }
    
    // Find the user with the provided API key
    const user = await User.findOne({ apiKey, isActive: true });
    
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid API key' 
      });
    }
    
    // Attach user to request object
    req.user = {
      id: user._id,
      username: user.username,
      email: user.email,
      role: user.role
    };
    
    // Add API request information for logging
    req.apiRequest = {
      userId: user._id,
      apiKey: apiKey,
      timestamp: new Date()
    };
    
    next();
  } catch (error) {
    console.error('API Authentication Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
};

module.exports = apiAuth;