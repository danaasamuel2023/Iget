
const jwt = require('jsonwebtoken');


const authMiddleware = async (req, res, next) => {
  try {
    // Get token from Authorization header
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    // Check if token exists
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: 'No authentication token provided. ok bad.' 
      });
    }
    
    // Verify token
   
    const decoded = jwt.verify(token, 'Igetbysamtech');
    
    // Set user info on the request object
    req.user = {
      id: decoded.id,
      role: decoded.role
    };
    
    next();
  } catch (error) {
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
    
    res.status(500).json({ 
      success: false, 
      message: 'Authentication failed',
      error: error.message
    });
  }
};

module.exports = authMiddleware;