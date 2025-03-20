// auth.routes.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User } = require('../schema/schema'); // Import the User model from your schema file


const JWT_SECRET = 'Igetbysamtech';  
const JWT_EXPIRES_IN = '7d'; // Token validity: 7 days

// Middleware to validate request body
const validateLoginInput = (req, res, next) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ 
      success: false, 
      message: 'Username and password are required' 
    });
  }
  
  next();
};

router.post('/login', validateLoginInput, async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Check if user exists
    const user = await User.findOne({ 
      $or: [
        { username: username },
        { email: username } // Allow login with email as well
      ]
    });
    
    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    // Check if user is active
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account is disabled. Please contact administrator'
      });
    }
    
    // Validate password
    const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Create payload for JWT
    const payload = {
      id: user._id,         // Add id directly for middleware compatibility
      userId: user.id,      // Keep userId for backward compatibility
      role: user.role
    };
    
    // Generate JWT token
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    
    // Return token and user info
    res.json({
      success: true,
      token: token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        phone: user.phone,
        role: user.role,
        wallet: {
          balance: user.wallet.balance,
          currency: user.wallet.currency
        }
      }
    });
    
    // Update last login timestamp
    user.lastLogin = Date.now();
    await user.save();
    
  } catch (error) {
    console.error('Login error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

/**
 * @route   POST /api/auth/register
 * @desc    Register a new user
 * @access  Public
 */
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, phone } = req.body;
    
    // Validate input
    if (!username || !email || !password || !phone) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required'
      });
    }
    
    // Check if user already exists
    let user = await User.findOne({ 
      $or: [
        { username },
        { email }
      ]
    });
    
    if (user) {
      return res.status(400).json({
        success: false,
        message: 'User already exists'
      });
    }
    
    // Create new user
    user = new User({
      username,
      email,
      password,
      phone,
      role: 'admin' 
    });
    
    // Hash password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);
    
    // Generate API key
    user.generateApiKey();
    
    // Save user to database
    await user.save();
    
    // Create payload for JWT - UPDATED for consistency with login route
    const payload = {
      id: user._id,         // Add id directly for middleware compatibility
      userId: user.id,      // Keep userId for backward compatibility
      role: user.role
    };
    
    // Generate JWT token
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    
    // Return token and user info for localStorage
    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token: token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        phone: user.phone,
        role: user.role,
        apiKey: user.apiKey,
        wallet: {
          balance: user.wallet.balance,
          currency: user.wallet.currency
        }
      }
    });
    
  } catch (error) {
    console.error('Registration error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

/**
 * @route   GET /api/auth/user
 * @desc    Get user info using token
 * @access  Private (with JWT authentication)
 */
router.get('/user', verifyToken, async (req, res) => {
  try {
    // Use either req.userId or req.user.id depending on middleware
    const userId = req.userId || (req.user && req.user.id);
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User ID not found in token'
      });
    }
    
    const user = await User.findById(userId).select('-password');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    res.json({
      success: true,
      user
    });
    
  } catch (error) {
    console.error('Get user error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

/**
 * Middleware to verify JWT token
 */
function verifyToken(req, res, next) {
  // Get token from header
  const bearerHeader = req.headers['authorization'];
  
  // Check if bearer is undefined
  if (typeof bearerHeader === 'undefined') {
    return res.status(401).json({
      success: false,
      message: 'Access denied. No token provided.'
    });
  }
  
  try {
    // Format of token: "Bearer <token>"
    const bearer = bearerHeader.split(' ');
    const token = bearer[1];
    
    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Add user id and role to request object
    req.userId = decoded.userId;
    req.userRole = decoded.role;
    
    // Add complete user payload to req object for easier access
    req.payload = {
      id: decoded.id,
      userId: decoded.userId,
      role: decoded.role
    };
    
    next();
  } catch (error) {
    console.error('Token verification error:', error.message);
    return res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }
}

module.exports = router;