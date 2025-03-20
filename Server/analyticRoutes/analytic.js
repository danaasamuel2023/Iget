// routes/analytics.js
const express = require('express');
const router = express.Router();
const { Order, Transaction, Bundle, User } = require('../models/schema');
const authMiddleware = require('../middleware_Api/auth');
const adminMiddleware = require('../middleware_Api/admin');

/**
 * Get overall sales summary (admin only)
 * Provides total revenue, number of orders, and average order value
 */
router.get('/summary', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    // Get optional date range filters from query params
    const { startDate, endDate } = req.query;
    
    // Build date filter if provided
    const dateFilter = {};
    if (startDate) dateFilter.createdAt = { $gte: new Date(startDate) };
    if (endDate) dateFilter.createdAt = { ...dateFilter.createdAt, $lte: new Date(endDate) };
    
    // Get all completed orders within date range
    const completedOrders = await Order.find({
      ...dateFilter,
      status: 'completed'
    });
    
    // Calculate summary metrics
    const totalRevenue = completedOrders.reduce((sum, order) => sum + order.totalAmount, 0);
    const totalOrders = completedOrders.length;
    const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    
    // Get counts for different order statuses
    const statusCounts = await Order.aggregate([
      { $match: dateFilter },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    
    const orderStatusMap = statusCounts.reduce((acc, status) => {
      acc[status._id] = status.count;
      return acc;
    }, {});
    
    res.status(200).json({
      success: true,
      data: {
        totalRevenue,
        totalOrders,
        averageOrderValue,
        orderStatus: orderStatusMap,
        period: {
          start: startDate || 'all time',
          end: endDate || 'present'
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Get sales by bundle type (admin only)
 * Shows performance metrics grouped by bundle type
 */
router.get('/by-bundle-type', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Build date filter if provided
    const dateFilter = {};
    if (startDate) dateFilter['orders.createdAt'] = { $gte: new Date(startDate) };
    if (endDate) dateFilter['orders.createdAt'] = { ...dateFilter['orders.createdAt'], $lte: new Date(endDate) };
    
    // Aggregate sales by bundle type
    const salesByType = await Order.aggregate([
      { $match: { status: 'completed', ...dateFilter } },
      { $lookup: { from: 'bundles', localField: 'bundle', foreignField: '_id', as: 'bundleDetails' } },
      { $unwind: '$bundleDetails' },
      {
        $group: {
          _id: '$bundleDetails.type',
          totalRevenue: { $sum: '$totalAmount' },
          totalOrders: { $sum: 1 },
          averageOrderValue: { $avg: '$totalAmount' }
        }
      },
      { $sort: { totalRevenue: -1 } }
    ]);
    
    res.status(200).json({
      success: true,
      data: salesByType,
      period: {
        start: startDate || 'all time',
        end: endDate || 'present'
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Get sales trends over time (admin only)
 * Shows sales data grouped by day, week, or month
 */
router.get('/trends', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const { startDate, endDate, interval = 'day' } = req.query;
    
    // Build date filter
    const dateFilter = {};
    if (startDate) dateFilter.createdAt = { $gte: new Date(startDate) };
    if (endDate) dateFilter.createdAt = { ...dateFilter.createdAt, $lte: new Date(endDate) };
    
    // Determine grouping format based on interval
    let groupFormat;
    if (interval === 'day') {
      groupFormat = { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } };
    } else if (interval === 'week') {
      groupFormat = { 
        $dateToString: { 
          format: '%Y-W%V', 
          date: '$createdAt' 
        } 
      };
    } else if (interval === 'month') {
      groupFormat = { $dateToString: { format: '%Y-%m', date: '$createdAt' } };
    } else {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid interval. Use day, week, or month.'
      });
    }
    
    // Aggregate sales by time interval
    const salesTrends = await Order.aggregate([
      { $match: { status: 'completed', ...dateFilter } },
      {
        $group: {
          _id: groupFormat,
          revenue: { $sum: '$totalAmount' },
          orderCount: { $sum: 1 },
          averageValue: { $avg: '$totalAmount' }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    res.status(200).json({
      success: true,
      interval,
      data: salesTrends,
      period: {
        start: startDate || 'earliest record',
        end: endDate || 'latest record'
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Get top customers by revenue (admin only)
 */
router.get('/top-customers', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    const { limit = 10, startDate, endDate } = req.query;
    
    // Build date filter
    const dateFilter = {};
    if (startDate) dateFilter.createdAt = { $gte: new Date(startDate) };
    if (endDate) dateFilter.createdAt = { ...dateFilter.createdAt, $lte: new Date(endDate) };
    
    // Find top customers
    const topCustomers = await Order.aggregate([
      { $match: { status: 'completed', ...dateFilter } },
      {
        $group: {
          _id: '$user',
          totalSpent: { $sum: '$totalAmount' },
          orderCount: { $sum: 1 },
          averageOrderValue: { $avg: '$totalAmount' }
        }
      },
      { $sort: { totalSpent: -1 } },
      { $limit: parseInt(limit) },
      {
        $lookup: {
          from: 'igetusers', // Collection name from schema
          localField: '_id',
          foreignField: '_id',
          as: 'userDetails'
        }
      },
      { $unwind: '$userDetails' },
      {
        $project: {
          _id: 1,
          totalSpent: 1,
          orderCount: 1,
          averageOrderValue: 1,
          username: '$userDetails.username',
          email: '$userDetails.email',
          phone: '$userDetails.phone'
        }
      }
    ]);
    
    res.status(200).json({
      success: true,
      count: topCustomers.length,
      data: topCustomers,
      period: {
        start: startDate || 'all time',
        end: endDate || 'present'
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Get user's own order analytics (for all users)
 */
router.get('/my-orders', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get all completed orders for the user
    const userOrders = await Order.find({
      user: userId,
      status: 'completed'
    }).populate('bundle');
    
    // Calculate summary metrics
    const totalSpent = userOrders.reduce((sum, order) => sum + order.totalAmount, 0);
    const orderCount = userOrders.length;
    
    // Group purchases by bundle type
    const bundleTypeCounts = {};
    userOrders.forEach(order => {
      const type = order.bundle.type;
      bundleTypeCounts[type] = (bundleTypeCounts[type] || 0) + 1;
    });
    
    // Get recent orders
    const recentOrders = await Order.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('bundle');
    
    res.status(200).json({
      success: true,
      data: {
        totalSpent,
        orderCount,
        bundleTypeDistribution: bundleTypeCounts,
        averageOrderValue: orderCount > 0 ? totalSpent / orderCount : 0,
        recentOrders
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Get dashboard stats (admin only)
 * Provides a comprehensive overview for admin dashboard
 */
router.get('/dashboard', [authMiddleware, adminMiddleware], async (req, res) => {
  try {
    // Get today's date and start of day
    const today = new Date();
    const startOfToday = new Date(today.setHours(0, 0, 0, 0));
    
    // Get start of current month
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    
    // Get start of previous month
    const startOfPrevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const endOfPrevMonth = new Date(today.getFullYear(), today.getMonth(), 0);
    
    // Get today's revenue
    const todayRevenue = await Order.aggregate([
      { 
        $match: { 
          status: 'completed',
          createdAt: { $gte: startOfToday } 
        } 
      },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);
    
    // Get current month revenue
    const currentMonthRevenue = await Order.aggregate([
      { 
        $match: { 
          status: 'completed',
          createdAt: { $gte: startOfMonth } 
        } 
      },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);
    
    // Get previous month revenue
    const prevMonthRevenue = await Order.aggregate([
      { 
        $match: { 
          status: 'completed',
          createdAt: { $gte: startOfPrevMonth, $lte: endOfPrevMonth } 
        } 
      },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);
    
    // Get pending orders count
    const pendingOrdersCount = await Order.countDocuments({ status: 'pending' });
    
    // Get total users count
    const totalUsers = await User.countDocuments({ isActive: true });
    
    // Get most popular bundle
    const popularBundle = await Order.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: '$bundle', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 },
      { 
        $lookup: { 
          from: 'bundles', 
          localField: '_id', 
          foreignField: '_id', 
          as: 'bundleDetails' 
        } 
      },
      { $unwind: '$bundleDetails' }
    ]);
    
    res.status(200).json({
      success: true,
      data: {
        todayRevenue: todayRevenue.length > 0 ? todayRevenue[0].total : 0,
        currentMonthRevenue: currentMonthRevenue.length > 0 ? currentMonthRevenue[0].total : 0,
        prevMonthRevenue: prevMonthRevenue.length > 0 ? prevMonthRevenue[0].total : 0,
        monthOverMonthGrowth: prevMonthRevenue.length > 0 && prevMonthRevenue[0].total > 0 
          ? (((currentMonthRevenue.length > 0 ? currentMonthRevenue[0].total : 0) - prevMonthRevenue[0].total) / prevMonthRevenue[0].total * 100).toFixed(2) 
          : 0,
        pendingOrdersCount,
        totalUsers,
        mostPopularBundle: popularBundle.length > 0 ? {
          id: popularBundle[0]._id,
          type: popularBundle[0].bundleDetails.type,
          capacity: popularBundle[0].bundleDetails.capacity,
          price: popularBundle[0].bundleDetails.price,
          salesCount: popularBundle[0].count
        } : null
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;