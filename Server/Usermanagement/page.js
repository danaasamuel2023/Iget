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
        
        // Log the API request
       
        
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

// POST add money to user wallet (admin only)
router.post('/users/:userId/wallet/deposit', auth, adminAuth, async (req, res) => {
  try {
    const { amount, description, paymentMethod, paymentDetails } = req.body;
    
    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ message: 'Valid amount is required' });
    }
    
    const user = await User.findById(req.params.userId);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const balanceBefore = user.wallet.balance;
    user.wallet.balance += parseFloat(amount);
    const balanceAfter = user.wallet.balance;
    user.updatedAt = Date.now();
    
    // Create transaction record
    const transaction = new Transaction({
      user: user._id,
      type: 'deposit',
      amount: parseFloat(amount),
      currency: user.wallet.currency,
      description: description || 'Admin deposit',
      status: 'completed',
      reference: 'DEP-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      balanceBefore,
      balanceAfter,
      processedBy: req.user.id,
      paymentMethod,
      paymentDetails
    });
    
    await transaction.save();
    
    // Add transaction to user's wallet transactions
    user.wallet.transactions.push(transaction._id);
    await user.save();
    
    res.status(200).json({
      message: 'Funds added successfully',
      transaction: {
        id: transaction._id,
        amount: transaction.amount,
        balanceBefore,
        balanceAfter,
        reference: transaction.reference
      }
    });
  } catch (error) {
    console.error('Error adding funds to wallet:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// PATCH change user role (admin only)
router.patch('/users/:userId/role', auth, adminAuth, async (req, res) => {
  try {
    const { role } = req.body;
    
    if (!role || !['admin', 'user', 'agent'].includes(role)) {
      return res.status(400).json({ message: 'Valid role is required (admin, user, or agent)' });
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

module.exports = router;