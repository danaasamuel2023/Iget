// Enhanced auth.routes.js with Admin Approval System
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

// ENHANCED LOGIN - Check approval status
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
    
    // Validate password first
    const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // NEW: Check approval status
    if (user.approvalStatus === 'pending') {
      return res.status(403).json({
        success: false,
        message: 'Your account is pending admin approval. Please wait for approval before logging in.',
        approvalStatus: 'pending',
        submittedAt: user.approvalInfo?.approvalRequestedAt
      });
    }
    
    if (user.approvalStatus === 'rejected') {
      return res.status(403).json({
        success: false,
        message: 'Your account has been rejected by an administrator.',
        approvalStatus: 'rejected',
        rejectionReason: user.approvalInfo?.rejectionReason || 'No reason provided',
        rejectedAt: user.approvalInfo?.rejectedAt
      });
    }
    
    // Check if user is active (should be true for approved users)
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account is disabled. Please contact administrator',
        approvalStatus: user.approvalStatus
      });
    }

    // Create payload for JWT
    const payload = {
      id: user._id,         // Add id directly for middleware compatibility
      userId: user.id,      // Keep userId for backward compatibility
      role: user.role,
      approvalStatus: user.approvalStatus // Include approval status in token
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
        approvalStatus: user.approvalStatus,
        approvedAt: user.approvalInfo?.approvedAt,
        wallet: {
          balance: user.wallet.balance,
          currency: user.wallet.currency
        }
      }
    });
    
    // Update last login timestamp
    if (!user.adminMetadata) {
      user.adminMetadata = {};
    }
    user.adminMetadata.lastLoginAt = Date.now();
    await user.save();
    
  } catch (error) {
    console.error('Login error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// ENHANCED REGISTRATION - User starts in pending status
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
    
    // Create new user with pending approval status
    user = new User({
      username,
      email,
      password,
      phone,
      role: 'user',
      approvalStatus: 'pending', // NEW: User starts as pending
      isActive: false, // NEW: User is inactive until approved
      approvalInfo: {
        approvalRequestedAt: new Date()
      }
    });
    
    // Hash password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);
    
    // Generate API key (but user can't use it until approved)
    user.generateApiKey();
    
    // Save user to database
    await user.save();
    
    // Return success message without token (user can't login until approved)
    res.status(201).json({
      success: true,
      message: 'Registration successful! Your account is pending admin approval. You will be notified once approved.',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        phone: user.phone,
        role: user.role,
        approvalStatus: user.approvalStatus,
        approvalRequestedAt: user.approvalInfo.approvalRequestedAt
      },
      nextSteps: [
        'Wait for admin approval',
        'You will receive notification once approved',
        'Contact administrator if approval takes too long'
      ]
    });
    
  } catch (error) {
    console.error('Registration error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// NEW: Check registration status endpoint
router.get('/registration-status/:email', async (req, res) => {
  try {
    const { email } = req.params;
    
    const user = await User.findOne({ email }).select('username email approvalStatus approvalInfo');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No registration found with this email'
      });
    }
    
    const statusInfo = {
      username: user.username,
      email: user.email,
      approvalStatus: user.approvalStatus,
      statusDescription: user.getApprovalStatusDescription(),
      submittedAt: user.approvalInfo?.approvalRequestedAt
    };
    
    // Add specific status information
    if (user.approvalStatus === 'approved') {
      statusInfo.approvedAt = user.approvalInfo?.approvedAt;
      statusInfo.canLogin = true;
    } else if (user.approvalStatus === 'rejected') {
      statusInfo.rejectedAt = user.approvalInfo?.rejectedAt;
      statusInfo.rejectionReason = user.approvalInfo?.rejectionReason || 'No reason provided';
      statusInfo.canLogin = false;
    } else {
      statusInfo.canLogin = false;
      statusInfo.message = 'Your registration is still pending admin approval';
    }
    
    res.json({
      success: true,
      ...statusInfo
    });
    
  } catch (error) {
    console.error('Registration status check error:', error.message);
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
    
    // Check if user is still approved and active
    if (!user.canUseApp()) {
      return res.status(403).json({
        success: false,
        message: 'Account access revoked or pending approval',
        approvalStatus: user.approvalStatus
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
 * Enhanced middleware to verify JWT token and check approval status
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
    req.approvalStatus = decoded.approvalStatus; // NEW: Add approval status
    
    // Add complete user payload to req object for easier access
    req.payload = {
      id: decoded.id,
      userId: decoded.userId,
      role: decoded.role,
      approvalStatus: decoded.approvalStatus
    };
    
    // NEW: Additional check for approval status
    if (decoded.approvalStatus && decoded.approvalStatus !== 'approved') {
      return res.status(403).json({
        success: false,
        message: 'Account not approved or access revoked',
        approvalStatus: decoded.approvalStatus
      });
    }
    
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