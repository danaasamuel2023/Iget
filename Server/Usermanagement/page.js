const express = require('express');
const router = express.Router();
const { User, Transaction } = require('../schema/schema');
const auth = require('../AuthMiddle/middlewareauth'); 
const adminAuth = require('../adminMiddlware/middleware'); 

// GET all users (admin only)
router.get('/users', auth, adminAuth, async (req, res) => {
    try {
        // Add pagination support
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;
        
        // Add filtering options
        const filter = {};
        
        if (req.query.role) {
            filter.role = req.query.role;
        }
        
        if (req.query.isActive !== undefined) {
            filter.isActive = req.query.isActive === 'true';
        }
        
        // Support search by username or email
        if (req.query.search) {
            filter.$or = [
                { username: { $regex: req.query.search, $options: 'i' } },
                { email: { $regex: req.query.search, $options: 'i' } }
            ];
        }
        
        // Count total documents for pagination metadata
        const total = await User.countDocuments(filter);
        
        // Fetch users with pagination and filtering
        const users = await User.find(filter)
            .select('-password -apiKey')  // Exclude sensitive fields
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
        
        // Add pagination metadata
        const totalPages = Math.ceil(total / limit);
        
        res.status(200).json({
            success: true,
            data: users,
            pagination: {
                total,
                page,
                limit,
                totalPages,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1
            }
        });
    } catch (error) {
        console.error('Error fetching users:', error);
        
        res.status(500).json({
            success: false,
            message: 'Server error while fetching users',
            error: error.message
        });
    }
});

// GET user's transaction history (admin only)
router.get('/users/:userId/transactions', auth, adminAuth, async (req, res) => {
    try {
        const userId = req.params.userId;
        
        // Verify user exists
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        // Add pagination support
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const skip = (page - 1) * limit;
        
        // Add filtering options
        const filter = { user: userId };
        
        if (req.query.type) {
            filter.type = req.query.type;
        }
        
        if (req.query.startDate && req.query.endDate) {
            filter.createdAt = {
                $gte: new Date(req.query.startDate),
                $lte: new Date(req.query.endDate)
            };
        }
        
        // Count total transactions for pagination metadata
        const total = await Transaction.countDocuments(filter);
        
        // Fetch transactions with admin details
        const transactions = await Transaction.find(filter)
            .populate({
                path: 'processedBy',
                select: 'username email'
            })
            .populate({
                path: 'user',
                select: 'username email'
            })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
        
        // Process transactions to ensure processedByInfo is available
        const processedTransactions = transactions.map(txn => {
            const transaction = txn.toObject();
            
            // If processedByInfo doesn't exist but processedBy does, create it
            if (!transaction.processedByInfo && transaction.processedBy) {
                transaction.processedByInfo = {
                    username: transaction.processedBy.username,
                    email: transaction.processedBy.email
                };
            }
            
            return transaction;
        });
        
        // Add pagination metadata
        const totalPages = Math.ceil(total / limit);
        
        res.status(200).json({
            success: true,
            data: processedTransactions,
            pagination: {
                total,
                page,
                limit,
                totalPages,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1
            }
        });
    } catch (error) {
        console.error('Error fetching transactions:', error);
        
        res.status(500).json({
            success: false,
            message: 'Server error while fetching transactions',
            error: error.message
        });
    }
});

// GET all transactions (admin only)
router.get('/transactions', auth, adminAuth, async (req, res) => {
    try {
        // Add pagination support
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const skip = (page - 1) * limit;
        
        // Add filtering options
        const filter = {};
        
        if (req.query.type) {
            filter.type = req.query.type;
        }
        
        if (req.query.userId) {
            filter.user = req.query.userId;
        }
        
        if (req.query.reference) {
            filter.reference = { $regex: req.query.reference, $options: 'i' };
        }
        
        if (req.query.description) {
            filter.description = { $regex: req.query.description, $options: 'i' };
        }
        
        if (req.query.startDate && req.query.endDate) {
            filter.createdAt = {
                $gte: new Date(req.query.startDate),
                $lte: new Date(req.query.endDate)
            };
        }
        
        // Count total documents for pagination metadata
        const total = await Transaction.countDocuments(filter);
        
        // Fetch transactions with related user and admin details
        const transactions = await Transaction.find(filter)
            .populate({
                path: 'user',
                select: 'username email'
            })
            .populate({
                path: 'processedBy',
                select: 'username email'
            })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
        
        // Process transactions to ensure processedByInfo is available
        const processedTransactions = transactions.map(txn => {
            const transaction = txn.toObject();
            
            // If processedByInfo doesn't exist but processedBy does, create it
            if (!transaction.processedByInfo && transaction.processedBy) {
                transaction.processedByInfo = {
                    username: transaction.processedBy.username,
                    email: transaction.processedBy.email
                };
            }
            
            return transaction;
        });
        
        // Add pagination metadata
        const totalPages = Math.ceil(total / limit);
        
        res.status(200).json({
            success: true,
            data: processedTransactions,
            pagination: {
                total,
                page,
                limit,
                totalPages,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1
            }
        });
    } catch (error) {
        console.error('Error fetching transactions:', error);
        
        res.status(500).json({
            success: false,
            message: 'Server error while fetching transactions',
            error: error.message
        });
    }
});

// POST add money to user wallet (admin only)
router.post('/users/:userId/wallet/deposit', auth, adminAuth, async (req, res) => {
    try {
        const { amount, description, paymentMethod, paymentDetails } = req.body;
        
        if (!amount || isNaN(amount) || amount <= 0) {
            return res.status(400).json({ 
                success: false,
                message: 'Valid amount is required' 
            });
        }
        
        const user = await User.findById(req.params.userId);
        
        if (!user) {
            return res.status(404).json({ 
                success: false,
                message: 'User not found' 
            });
        }
        
        // Get admin information
        const admin = await User.findById(req.user.id).select('username email');
        
        // Perform wallet operation
        const balanceBefore = user.wallet ? user.wallet.balance || 0 : 0;
        
        // Initialize wallet if it doesn't exist
        if (!user.wallet) {
            user.wallet = {
                balance: 0,
                currency: 'GHS', // Changed to GHS
                transactions: []
            };
        }
        
        user.wallet.balance = balanceBefore + parseFloat(amount);
        const balanceAfter = user.wallet.balance;
        user.updatedAt = Date.now();
        
        // Create transaction record with admin tracking
        const transaction = new Transaction({
            user: user._id,
            type: 'deposit',
            amount: parseFloat(amount),
            currency: user.wallet.currency || 'GHS', // Changed to GHS
            description: description || 'Admin deposit',
            status: 'completed',
            reference: 'DEP-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
            balanceBefore,
            balanceAfter,
            processedBy: req.user.id,
            processedByInfo: {
                username: admin.username,
                email: admin.email
            },
            paymentMethod: paymentMethod || 'admin',
            paymentDetails: paymentDetails || { method: 'manual', by: admin.username }
        });
        
        await transaction.save();
        
        // Add transaction to user's wallet transactions
        if (!user.wallet.transactions) {
            user.wallet.transactions = [];
        }
        
        user.wallet.transactions.push(transaction._id);
        await user.save();
        
        res.status(200).json({
            success: true,
            message: 'Funds added successfully',
            transaction: {
                id: transaction._id,
                type: 'deposit',
                amount: transaction.amount,
                balanceBefore,
                balanceAfter,
                reference: transaction.reference,
                processedBy: admin.username,
                date: transaction.createdAt
            }
        });
    } catch (error) {
        console.error('Error adding funds to wallet:', error);
        res.status(500).json({ 
            success: false,
            message: 'Server error', 
            error: error.message 
        });
    }
});

// POST deduct money from user wallet (admin only)
router.post('/users/:userId/wallet/debit', auth, adminAuth, async (req, res) => {
    try {
        const { amount, description, paymentMethod, paymentDetails } = req.body;
        
        if (!amount || isNaN(amount) || amount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Valid amount is required'
            });
        }
        
        const user = await User.findById(req.params.userId);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        // Check if user has wallet and sufficient balance
        if (!user.wallet || user.wallet.balance < parseFloat(amount)) {
            return res.status(400).json({
                success: false,
                message: 'Insufficient wallet balance'
            });
        }
        
        // Get admin information
        const admin = await User.findById(req.user.id).select('username email');
        
        const balanceBefore = user.wallet.balance;
        user.wallet.balance = balanceBefore - parseFloat(amount);
        const balanceAfter = user.wallet.balance;
        user.updatedAt = Date.now();
        
        // Create transaction record with admin tracking
        const transaction = new Transaction({
            user: user._id,
            type: 'debit',
            amount: parseFloat(amount),
            currency: user.wallet.currency || 'GHS', // Changed to GHS
            description: description || 'Admin debit',
            status: 'completed',
            reference: 'DEB-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
            balanceBefore,
            balanceAfter,
            processedBy: req.user.id,
            processedByInfo: {
                username: admin.username,
                email: admin.email
            },
            paymentMethod: paymentMethod || 'admin',
            paymentDetails: paymentDetails || { method: 'manual', by: admin.username }
        });
        
        await transaction.save();
        
        // Add transaction to user's wallet transactions
        if (!user.wallet.transactions) {
            user.wallet.transactions = [];
        }
        
        user.wallet.transactions.push(transaction._id);
        await user.save();
        
        res.status(200).json({
            success: true,
            message: 'Funds deducted successfully',
            transaction: {
                id: transaction._id,
                type: 'debit',
                amount: transaction.amount,
                balanceBefore,
                balanceAfter,
                reference: transaction.reference,
                processedBy: admin.username,
                date: transaction.createdAt
            }
        });
    } catch (error) {
        console.error('Error deducting funds from wallet:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

// DELETE a user (admin only)
router.delete('/users/:userId', auth, adminAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    await User.findByIdAndDelete(req.params.userId);
    res.status(200).json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// PATCH disable a user (toggle isActive status)
router.patch('/users/:userId/status', auth, adminAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    user.isActive = !user.isActive;
    user.updatedAt = Date.now();
    
    await user.save();
    
    res.status(200).json({
      message: `User ${user.isActive ? 'enabled' : 'disabled'} successfully`,
      isActive: user.isActive
    });
  } catch (error) {
    console.error('Error updating user status:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// DELETE user API key
router.delete('/users/:userId/api-key', auth, async (req, res) => {
  try {
    // Check if user is requesting their own API key deletion or is an admin
    if (req.user.id !== req.params.userId && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to perform this action' });
    }
    
    const user = await User.findById(req.params.userId);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    user.apiKey = undefined;
    user.updatedAt = Date.now();
    
    await user.save();
    
    res.status(200).json({ message: 'API key deleted successfully' });
  } catch (error) {
    console.error('Error deleting API key:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// PATCH change user role (admin only)
router.patch('/users/:userId/role', auth, adminAuth, async (req, res) => {
  try {
    const { role } = req.body;
    
    if (!role || !['admin', 'user', 'agent', 'Editor'].includes(role)) {
      return res.status(400).json({ message: 'Valid role is required (admin, user, agent, or Editor)' });
    }
    
    const user = await User.findById(req.params.userId);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Don't allow the last admin to change their role
    if (user.role === 'admin' && role !== 'admin') {
      const adminCount = await User.countDocuments({ role: 'admin' });
      if (adminCount <= 1) {
        return res.status(400).json({ message: 'Cannot change role of the last admin user' });
      }
    }
    
    user.role = role;
    user.updatedAt = Date.now();
    
    await user.save();
    
    res.status(200).json({
      message: `User role updated to ${role} successfully`,
      username: user.username,
      role: user.role
    });
  } catch (error) {
    console.error('Error changing user role:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET top users with most sales in the past 6 days
router.get('/top-sales-users', auth, adminAuth, async (req, res) => {
    try {
      // Calculate the date 6 days ago from today
      const sixDaysAgo = new Date();
      sixDaysAgo.setDate(sixDaysAgo.getDate() - 6);
      
      console.log('Looking for transactions since:', sixDaysAgo);
      
      // Aggregate transactions to find users with most sales
      const topUsers = await Transaction.aggregate([
        // Match transactions from the past 6 days with type 'purchase'
        {
          $match: {
            createdAt: { $gte: sixDaysAgo },
            type: 'purchase'
          }
        },
        // Group by user and sum their sales
        {
          $group: {
            _id: '$user',
            totalSales: { $sum: '$amount' },
            transactions: { $push: '$$ROOT' }
          }
        },
        // Sort by total sales (descending)
        {
          $sort: { totalSales: -1 }
        },
        // Limit to top performers (default 3, configurable via query)
        {
          $limit: parseInt(req.query.limit) || 3
        },
        // Get additional user information
        {
          $lookup: {
            from: 'igetusers', // Changed from 'users' to 'igetusers' to match your model
            localField: '_id',
            foreignField: '_id',
            as: 'userInfo'
          }
        },
        // Transform the output format
        {
          $project: {
            userId: '$_id',
            username: { $arrayElemAt: ['$userInfo.username', 0] },
            email: { $arrayElemAt: ['$userInfo.email', 0] },
            totalSales: 1,
            transactionCount: { $size: '$transactions' }
          }
        }
      ]);
      
      console.log('Found top users:', topUsers);
      
      res.status(200).json({
        success: true,
        data: topUsers,
        period: {
          from: sixDaysAgo,
          to: new Date()
        }
      });
      
    } catch (error) {
      console.error('Error fetching top sales users:', error);
      res.status(500).json({
        success: false,
        message: 'Server error while fetching top sales users',
        error: error.message
      });
    }
  });
  
  // POST reward top sales performers
  router.post('/reward-top-performers', auth, adminAuth, async (req, res) => {
    try {
      const { percentages, description } = req.body;
      
      // Validate input
      if (!percentages || !Array.isArray(percentages) || percentages.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Valid percentages array is required'
        });
      }
      
      // Calculate date range (past 6 days)
      const sixDaysAgo = new Date();
      sixDaysAgo.setDate(sixDaysAgo.getDate() - 6);
      
      // Get top performers - Changed to match the GET route
      const topPerformers = await Transaction.aggregate([
        {
          $match: {
            createdAt: { $gte: sixDaysAgo },
            type: 'purchase'  // Changed from 'sale' to 'purchase'
          }
        },
        {
          $group: {
            _id: '$user',
            totalSales: { $sum: '$amount' }
          }
        },
        {
          $sort: { totalSales: -1 }
        },
        {
          $limit: 3
        }
      ]);
      
      if (topPerformers.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'No sales performers found in the past 6 days'
        });
      }
      
      // Get admin information
      const admin = await User.findById(req.user.id).select('username email');
      
      // Process rewards for each top performer
      const rewards = [];
      
      for (let i = 0; i < Math.min(topPerformers.length, percentages.length); i++) {
        const performer = topPerformers[i];
        const percentage = parseFloat(percentages[i]);
        
        // Validate percentage
        if (isNaN(percentage) || percentage <= 0 || percentage > 100) {
          return res.status(400).json({
            success: false,
            message: `Invalid percentage at position ${i}: must be between 0 and 100`
          });
        }
        
        // Calculate reward amount
        const rewardAmount = (performer.totalSales * percentage) / 100;
        
        // Get user
        const user = await User.findById(performer._id);
        
        if (!user) {
          return res.status(404).json({
            success: false,
            message: `User with ID ${performer._id} not found`
          });
        }
        
        // Log user info for debugging
        console.log(`Found user for reward:`, {
          userId: user._id,
          username: user.username,
          email: user.email
        });
        
        // Initialize wallet if it doesn't exist
        if (!user.wallet) {
          user.wallet = {
            balance: 0,
            currency: 'GHS',
            transactions: []
          };
        }
        
        // Update user wallet
        const balanceBefore = user.wallet.balance || 0;
        user.wallet.balance = balanceBefore + rewardAmount;
        const balanceAfter = user.wallet.balance;
        user.updatedAt = Date.now();
        
        // Create transaction record
        const rewardDescription = description || `Sales performance reward (${percentage}% of total sales)`;
        const transaction = new Transaction({
          user: user._id,
          type: 'reward',
          amount: rewardAmount,
          currency: user.wallet.currency || 'GHS',
          description: rewardDescription,
          status: 'completed',
          reference: 'REW-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
          balanceBefore,
          balanceAfter,
          processedBy: req.user.id,
          processedByInfo: {
            username: admin.username,
            email: admin.email
          },
          paymentMethod: 'admin',
          paymentDetails: { 
            method: 'sales_reward',
            percentage: percentage,
            salesPeriod: {
              from: sixDaysAgo,
              to: new Date()
            },
            totalSales: performer.totalSales
          }
        });
        
        await transaction.save();
        
        // Add transaction to user's wallet transactions
        if (!user.wallet.transactions) {
          user.wallet.transactions = [];
        }
        user.wallet.transactions.push(transaction._id);
        await user.save();
        
        // Add to rewards array
        rewards.push({
          userId: user._id,
          username: user.username,
          email: user.email,
          totalSales: performer.totalSales,
          percentage: percentage,
          rewardAmount: rewardAmount,
          transactionId: transaction._id
        });
      }
      
      res.status(200).json({
        success: true,
        message: 'Top performers rewarded successfully',
        rewards: rewards,
        period: {
          from: sixDaysAgo,
          to: new Date()
        }
      });
      
    } catch (error) {
      console.error('Error rewarding top performers:', error);
      res.status(500).json({
        success: false,
        message: 'Server error while rewarding top performers',
        error: error.message
      });
    }
  });
  
  // POST reward top sales performers
  

module.exports = router;