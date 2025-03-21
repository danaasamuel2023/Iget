const express = require('express');
const axios = require('axios');

const router = express.Router();
const { Order, Bundle, User, Transaction } = require('../schema/schema');
const auth = require('../AuthMiddle/middlewareauth.js'); // Authentication middleware
const adminAuth = require('../adminMiddlware/middleware.js'); // Admin authentication middleware
const mongoose = require('mongoose');
const verifyToken = require('../verifytoken/page.js');


router.get('/today', auth, async (req, res) => {
  try {
    // Get today's date at 00:00:00
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    
    // Get end of today at 23:59:59
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    
    // Find all orders made by this user today
    const todayOrders = await Order.find({
      user: req.user.id,
      createdAt: { $gte: startOfDay, $lte: endOfDay }
    }).sort({ createdAt: -1 });
    
    // Calculate today's total revenue (sum of all today's orders)
    const todayRevenue = todayOrders.reduce((total, order) => {
      return total + (order.price || 0);
    }, 0);
    
    // Get user's current wallet balance
    const user = await User.findById(req.user.id).select('wallet.balance');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: {
        todayOrdersCount: todayOrders.length,
        todayRevenue,
        todayOrders,
        currentBalance: user.wallet.balance,
        date: startOfDay.toISOString().split('T')[0]
      }
    });
  } catch (error) {
    console.error('Error fetching today\'s orders and revenue:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});


/**
 * @route   GET /api/verify-token
 * @desc    Verify if token is valid
 * @access  Public
 */
router.get('/verify-token', verifyToken, async (req, res) => {
  try {
    // If the auth middleware passes, the token is valid
    // You can return the user data if needed
    return res.status(200).json({ 
      valid: true,
      user: req.user 
    });
  } catch (error) {
    console.error('Token verification error:', error.message);
    return res.status(401).json({ 
      valid: false,
      message: 'Token is invalid' 
    });
  }
});





module.exports = router;