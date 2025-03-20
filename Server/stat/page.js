// routes/walletStats.js
const express = require('express');
const router = express.Router();
const { Order, Transaction } = require('../schema/schema');
const auth = require('../AuthMiddle/middlewareauth');
// const adminAuth = require('../adminMiddlware/middleware');


router.get('/today/stats', auth, async (req, res) => {
  try {
    // Get today's date range (start of day to current time)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const now = new Date();
    
    // Find orders placed by the user today
    const ordersToday = await Order.find({
      user: req.user.id,
      createdAt: { $gte: today, $lte: now }
    });
    
    // Calculate total amount spent on orders today
    const totalOrderAmount = ordersToday.reduce((total, order) => {
      return total + order.totalAmount;
    }, 0);
    
    // Find transactions for the user today
    const transactionsToday = await Transaction.find({
      user: req.user.id,
      createdAt: { $gte: today, $lte: now }
    });
    
    // Calculate wallet revenue (deposits - withdrawals)
    const walletRevenue = transactionsToday.reduce((total, transaction) => {
      if (transaction.type === 'deposit') {
        return total + transaction.amount;
      } else if (transaction.type === 'withdrawal') {
        return total - transaction.amount;
      }
      return total;
    }, 0);
    
    res.status(200).json({
      success: true,
      data: {
        ordersToday: ordersToday.length,
        totalOrderAmount,
        walletRevenue,
        transactionsCount: transactionsToday.length
      }
    });
  } catch (error) {
    console.error('Error fetching wallet stats:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/wallet-stats/admin/today
 * @desc    Get all users' wallet revenue and order stats for today (admin only)
 * @access  Admin
 */
router.get('/admin/today',  async (req, res) => {
  try {
    // Get today's date range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const now = new Date();
    
    // Find all orders placed today
    const ordersToday = await Order.find({
      createdAt: { $gte: today, $lte: now }
    }).populate('user', 'username email');
    
    // Calculate total revenue from orders
    const totalOrderRevenue = ordersToday.reduce((total, order) => {
      return total + order.totalAmount;
    }, 0);
    
    // Get transactions today
    const transactionsToday = await Transaction.find({
      createdAt: { $gte: today, $lte: now }
    });
    
    // Calculate deposits and withdrawals
    const totalDeposits = transactionsToday.reduce((total, transaction) => {
      return transaction.type === 'deposit' ? total + transaction.amount : total;
    }, 0);
    
    const totalWithdrawals = transactionsToday.reduce((total, transaction) => {
      return transaction.type === 'withdrawal' ? total + transaction.amount : total;
    }, 0);
    
    // Group orders by status
    const ordersByStatus = {};
    ordersToday.forEach(order => {
      if (!ordersByStatus[order.status]) {
        ordersByStatus[order.status] = 0;
      }
      ordersByStatus[order.status]++;
    });
    
    // Group orders by bundle type
    const ordersByBundleType = {};
    for (const order of ordersToday) {
      if (order.bundle && order.bundle.type) {
        if (!ordersByBundleType[order.bundle.type]) {
          ordersByBundleType[order.bundle.type] = 0;
        }
        ordersByBundleType[order.bundle.type]++;
      }
    }
    
    res.status(200).json({
      success: true,
      data: {
        totalOrders: ordersToday.length,
        totalOrderRevenue,
        totalDeposits,
        totalWithdrawals,
        netRevenue: totalDeposits - totalWithdrawals,
        ordersByStatus,
        ordersByBundleType,
        transactionsCount: transactionsToday.length
      }
    });
  } catch (error) {
    console.error('Error fetching admin wallet stats:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

module.exports = router;