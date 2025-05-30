const express = require('express');
const router = express.Router();
const { User, Transaction, ApiLog } = require('../schema/schema');
const auth = require('../AuthMiddle/middlewareauth'); 
const adminAuth = require('../adminMiddlware/middleware');

// Specific role checking middleware
const requireFullAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Full admin privileges required for this action'
    });
  }
  next();
};

// Updated middleware for unified wallet operations (both credit and debit) - EXCLUDES EDITORS
const requireWalletAdmin = (req, res, next) => {
  if (!req.user || !['admin', 'wallet_admin'].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: 'Wallet admin privileges required for this action. You need admin or wallet_admin role.',
      currentRole: req.user?.role,
      note: 'Editors cannot access wallet operations'
    });
  }
  next();
};

// Middleware for Editor role (order status updates) - EDITORS ONLY FOR ORDERS
const requireEditor = (req, res, next) => {
  if (!req.user || !['admin', 'Editor'].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: 'Editor privileges required for this action. You need admin or Editor role.',
      currentRole: req.user?.role
    });
  }
  next();
};

// NEW: Middleware to block Editors from user operations
const blockEditors = (req, res, next) => {
  if (req.user && req.user.role === 'Editor') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Editors cannot access user management features.',
      currentRole: req.user.role,
      allowedActions: ['View and update order statuses only'],
      redirectTo: '/admin-orders'
    });
  }
  next();
};

// Helper function to log admin actions
const logAdminAction = async (adminId, action, targetUserId = null, details = {}) => {
  try {
    await ApiLog.create({
      user: adminId,
      endpoint: `/admin/${action}`,
      method: 'POST',
      requestData: {
        action,
        targetUser: targetUserId,
        details
      },
      responseData: { success: true },
      ipAddress: details.ipAddress || 'unknown',
      status: 200,
      executionTime: Date.now()
    });
  } catch (error) {
    console.error('Failed to log admin action:', error);
  }
};

// GET current admin permissions (available to all admin types)
router.get('/my-permissions', auth, adminAuth, async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'User authentication failed'
            });
        }

        const admin = req.user;
        
        const permissions = {
            role: admin.role,
            // Editors cannot view users
            canViewAllUsers: ['admin', 'wallet_admin'].includes(admin.role),
            canViewUsersForWallet: ['admin', 'wallet_admin'].includes(admin.role),
            canViewAllTransactions: admin.role === 'admin',
            canCredit: ['admin', 'wallet_admin'].includes(admin.role), // Unified wallet admin
            canDebit: ['admin', 'wallet_admin'].includes(admin.role),  // Unified wallet admin
            canChangeRoles: admin.role === 'admin',
            canDeleteUsers: admin.role === 'admin',
            canChangeUserStatus: admin.role === 'admin',
            canViewAdminLogs: admin.role === 'admin',
            canRewardUsers: admin.role === 'admin',
            canUpdateOrderStatus: ['admin', 'Editor'].includes(admin.role), // Editor can update orders
            // New detailed permissions
            hasFullUserAccess: admin.role === 'admin',
            hasLimitedUserAccess: admin.role === 'wallet_admin', // Editors removed
            isUnifiedWalletAdmin: admin.role === 'wallet_admin',
            isEditor: admin.role === 'Editor',
            // Editor-specific restrictions
            editorRestrictions: admin.role === 'Editor' ? {
                cannotAccessUsers: true,
                cannotAccessWallet: true,
                cannotAccessTransactions: true,
                cannotAccessSettings: true,
                onlyOrderAccess: true
            } : null
        };
        
        res.status(200).json({
            success: true,
            admin: {
                id: admin._id,
                username: admin.username,
                email: admin.email,
                role: admin.role
            },
            permissions,
            roleDescription: {
                admin: 'Full administrative access to all features',
                wallet_admin: 'Can view users and perform both credit and debit wallet operations',
                Editor: 'Can ONLY view and update order statuses - NO access to users, wallets, or other admin features'
            }[admin.role]
        });
    } catch (error) {
        console.error('Error fetching admin permissions:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching permissions',
            error: error.message
        });
    }
});

// GET all users (ADMIN & WALLET_ADMIN ONLY - EDITORS BLOCKED)
router.get('/users', auth, adminAuth, blockEditors, requireWalletAdmin, async (req, res) => {
    try {
        // Log admin action
        await logAdminAction(req.user._id, 'view_users', null, { 
          ipAddress: req.ip,
          queryParams: req.query 
        });

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;
        
        const filter = {};
        
        if (req.query.role) {
            filter.role = req.query.role;
        }
        
        if (req.query.isActive !== undefined) {
            filter.isActive = req.query.isActive === 'true';
        }
        
        if (req.query.search) {
            filter.$or = [
                { username: { $regex: req.query.search, $options: 'i' } },
                { email: { $regex: req.query.search, $options: 'i' } }
            ];
        }
        
        const total = await User.countDocuments(filter);
        
        // Different data selection based on admin role
        let selectFields = '-password'; // Always exclude password
        let responseData = {};
        
        if (req.user.role === 'admin') {
            // Full admin gets all user data
            selectFields = '-password -apiKey';
            const users = await User.find(filter)
                .select(selectFields)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit);
            
            responseData = {
                success: true,
                data: users,
                pagination: {
                    total,
                    page,
                    limit,
                    totalPages: Math.ceil(total / limit),
                    hasNextPage: page < Math.ceil(total / limit),
                    hasPrevPage: page > 1
                },
                accessedBy: {
                    adminId: req.user._id,
                    adminUsername: req.user.username,
                    adminRole: req.user.role,
                    timestamp: new Date()
                }
            };
        } else if (req.user.role === 'wallet_admin') {
            // wallet_admin gets limited user data - only what they need for wallet operations
            selectFields = 'username email wallet role isActive createdAt';
            const users = await User.find(filter)
                .select(selectFields)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit);
            
            responseData = {
                success: true,
                data: users,
                pagination: {
                    total,
                    page,
                    limit,
                    totalPages: Math.ceil(total / limit),
                    hasNextPage: page < Math.ceil(total / limit),
                    hasPrevPage: page > 1
                },
                accessedBy: {
                    adminId: req.user._id,
                    adminUsername: req.user.username,
                    adminRole: req.user.role,
                    timestamp: new Date()
                },
                limitedAccess: true,
                note: `Limited user data for ${req.user.role} role - wallet operations only`
            };
        }
        
        res.status(200).json(responseData);
    } catch (error) {
        console.error('Error fetching users:', error);
        
        res.status(500).json({
            success: false,
            message: 'Server error while fetching users',
            error: error.message
        });
    }
});

// GET user's transaction history (FULL ADMIN ONLY - EDITORS BLOCKED)
router.get('/users/:userId/transactions', auth, adminAuth, blockEditors, requireFullAdmin, async (req, res) => {
    try {
        const userId = req.params.userId;
        
        await logAdminAction(req.user._id, 'view_user_transactions', userId, { 
          ipAddress: req.ip 
        });
        
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const skip = (page - 1) * limit;
        
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
        
        const total = await Transaction.countDocuments(filter);
        
        const transactions = await Transaction.find(filter)
            .populate({
                path: 'processedBy',
                select: 'username email role'
            })
            .populate({
                path: 'user',
                select: 'username email'
            })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
        
        const processedTransactions = transactions.map(txn => {
            const transaction = txn.toObject();
            
            if (transaction.processedBy) {
                transaction.processedByInfo = {
                    adminId: transaction.processedBy._id,
                    username: transaction.processedBy.username,
                    email: transaction.processedBy.email,
                    role: transaction.processedBy.role
                };
            }
            
            return transaction;
        });
        
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
            },
            accessedBy: {
                adminId: req.user._id,
                adminUsername: req.user.username,
                adminRole: req.user.role,
                timestamp: new Date()
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

// GET all transactions (FULL ADMIN ONLY - EDITORS BLOCKED)
router.get('/transactions', auth, adminAuth, blockEditors, requireFullAdmin, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const skip = (page - 1) * limit;
        
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
        
        const total = await Transaction.countDocuments(filter);
        
        const transactions = await Transaction.find(filter)
            .populate({
                path: 'user',
                select: 'username email'
            })
            .populate({
                path: 'processedBy',
                select: 'username email role'
            })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
        
        const processedTransactions = transactions.map(txn => {
            const transaction = txn.toObject();
            
            if (transaction.processedBy) {
                transaction.processedByInfo = {
                    adminId: transaction.processedBy._id,
                    username: transaction.processedBy.username,
                    email: transaction.processedBy.email,
                    role: transaction.processedBy.role
                };
            }
            
            return transaction;
        });
        
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

// POST add money to user wallet (ADMIN & WALLET_ADMIN ONLY - EDITORS BLOCKED)
router.post('/users/:userId/wallet/deposit', auth, adminAuth, blockEditors, requireWalletAdmin, async (req, res) => {
    try {
        const { amount, description, paymentMethod, paymentDetails } = req.body;
        const targetUserId = req.params.userId;
        
        if (!amount || isNaN(amount) || amount <= 0) {
            return res.status(400).json({ 
                success: false,
                message: 'Valid amount is required' 
            });
        }
        
        const user = await User.findById(targetUserId);
        
        if (!user) {
            return res.status(404).json({ 
                success: false,
                message: 'User not found' 
            });
        }
        
        // Admin is already fetched in adminAuth middleware
        const admin = req.user;
        
        // Perform wallet operation
        const balanceBefore = user.wallet ? user.wallet.balance || 0 : 0;
        
        // Initialize wallet if it doesn't exist
        if (!user.wallet) {
            user.wallet = {
                balance: 0,
                currency: 'GHS',
                transactions: []
            };
        }
        
        user.wallet.balance = balanceBefore + parseFloat(amount);
        const balanceAfter = user.wallet.balance;
        user.updatedAt = Date.now();
        
        // Create transaction record with unified wallet admin tracking
        const transaction = new Transaction({
            user: user._id,
            type: 'deposit',
            amount: parseFloat(amount),
            currency: user.wallet.currency || 'GHS',
            description: description || `Wallet credit by ${admin.username} (${admin.role})`,
            status: 'completed',
            reference: 'DEP-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
            balanceBefore,
            balanceAfter,
            processedBy: admin._id,
            processedByInfo: {
                adminId: admin._id,
                username: admin.username,
                email: admin.email,
                role: admin.role,
                actionType: 'credit',
                actionTimestamp: new Date(),
                ipAddress: req.ip,
                // Add unified admin identifier
                isUnifiedWalletAdmin: admin.role === 'wallet_admin'
            },
            paymentMethod: paymentMethod || 'admin_credit',
            paymentDetails: {
                ...paymentDetails,
                method: 'manual_credit',
                creditedBy: admin.username,
                creditedByRole: admin.role,
                originalAmount: parseFloat(amount),
                targetUser: {
                    id: user._id,
                    username: user.username,
                    email: user.email
                },
                unifiedWalletAdmin: admin.role === 'wallet_admin'
            },
            metadata: {
                adminAction: 'wallet_credit',
                performedBy: admin._id,
                performedByRole: admin.role,
                performedAt: new Date(),
                clientIp: req.ip,
                userAgent: req.get('User-Agent'),
                unifiedWalletOperation: true // Flag for unified wallet operations
            }
        });
        
        await transaction.save();
        
        // Add transaction to user's wallet transactions
        if (!user.wallet.transactions) {
            user.wallet.transactions = [];
        }
        
        user.wallet.transactions.push(transaction._id);
        await user.save();
        
        // Log admin action
        await logAdminAction(admin._id, 'credit_user_wallet', targetUserId, {
            amount: parseFloat(amount),
            description,
            balanceBefore,
            balanceAfter,
            transactionId: transaction._id,
            ipAddress: req.ip,
            adminRole: admin.role,
            unifiedWalletAdmin: admin.role === 'wallet_admin',
            targetUser: {
                username: user.username,
                email: user.email
            }
        });
        
        res.status(200).json({
            success: true,
            message: 'Funds credited successfully',
            transaction: {
                id: transaction._id,
                type: 'deposit',
                amount: transaction.amount,
                balanceBefore,
                balanceAfter,
                reference: transaction.reference,
                creditedBy: {
                    adminId: admin._id,
                    username: admin.username,
                    role: admin.role,
                    isUnifiedWalletAdmin: admin.role === 'wallet_admin',
                    canCredit: ['admin', 'wallet_admin'].includes(admin.role),
                    canDebit: ['admin', 'wallet_admin'].includes(admin.role)
                },
                date: transaction.createdAt,
                targetUser: {
                    username: user.username,
                    email: user.email
                }
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

// POST deduct money from user wallet (ADMIN & WALLET_ADMIN ONLY - EDITORS BLOCKED)  
router.post('/users/:userId/wallet/debit', auth, adminAuth, blockEditors, requireWalletAdmin, async (req, res) => {
    try {
        const { amount, description, paymentMethod, paymentDetails } = req.body;
        const targetUserId = req.params.userId;
        
        if (!amount || isNaN(amount) || amount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Valid amount is required'
            });
        }
        
        const user = await User.findById(targetUserId);
        
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
        
        // Admin is already fetched in adminAuth middleware
        const admin = req.user;
        
        const balanceBefore = user.wallet.balance;
        user.wallet.balance = balanceBefore - parseFloat(amount);
        const balanceAfter = user.wallet.balance;
        user.updatedAt = Date.now();
        
        // Create transaction record with unified wallet admin tracking
        const transaction = new Transaction({
            user: user._id,
            type: 'debit',
            amount: parseFloat(amount),
            currency: user.wallet.currency || 'GHS',
            description: description || `Wallet debit by ${admin.username} (${admin.role})`,
            status: 'completed',
            reference: 'DEB-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
            balanceBefore,
            balanceAfter,
            processedBy: admin._id,
            processedByInfo: {
                adminId: admin._id,
                username: admin.username,
                email: admin.email,
                role: admin.role,
                actionType: 'debit',
                actionTimestamp: new Date(),
                ipAddress: req.ip,
                // Add unified admin identifier
                isUnifiedWalletAdmin: admin.role === 'wallet_admin'
            },
            paymentMethod: paymentMethod || 'admin_debit',
            paymentDetails: {
                ...paymentDetails,
                method: 'manual_debit',
                debitedBy: admin.username,
                debitedByRole: admin.role,
                originalAmount: parseFloat(amount),
                targetUser: {
                    id: user._id,
                    username: user.username,
                    email: user.email
                },
                unifiedWalletAdmin: admin.role === 'wallet_admin'
            },
            metadata: {
                adminAction: 'wallet_debit',
                performedBy: admin._id,
                performedByRole: admin.role,
                performedAt: new Date(),
                clientIp: req.ip,
                userAgent: req.get('User-Agent'),
                unifiedWalletOperation: true // Flag for unified wallet operations
            }
        });
        
        await transaction.save();
        
        // Add transaction to user's wallet transactions
        if (!user.wallet.transactions) {
            user.wallet.transactions = [];
        }
        user.wallet.transactions.push(transaction._id);
        await user.save();
        
        // Log admin action
        await logAdminAction(admin._id, 'debit_user_wallet', targetUserId, {
            amount: parseFloat(amount),
            description,
            balanceBefore,
            balanceAfter,
            transactionId: transaction._id,
            ipAddress: req.ip,
            adminRole: admin.role,
            unifiedWalletAdmin: admin.role === 'wallet_admin',
            targetUser: {
                username: user.username,
                email: user.email
            }
        });
        
        res.status(200).json({
            success: true,
            message: 'Funds debited successfully',
            transaction: {
                id: transaction._id,
                type: 'debit',
                amount: transaction.amount,
                balanceBefore,
                balanceAfter,
                reference: transaction.reference,
                debitedBy: {
                    adminId: admin._id,
                    username: admin.username,
                    role: admin.role,
                    isUnifiedWalletAdmin: admin.role === 'wallet_admin',
                    canCredit: ['admin', 'wallet_admin'].includes(admin.role),
                    canDebit: ['admin', 'wallet_admin'].includes(admin.role)
                },
                date: transaction.createdAt,
                targetUser: {
                    username: user.username,
                    email: user.email
                }
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

// PATCH change user role (FULL ADMIN ONLY - EDITORS BLOCKED)
router.patch('/users/:userId/role', auth, adminAuth, blockEditors, requireFullAdmin, async (req, res) => {
    try {
        const { role } = req.body;
        const targetUserId = req.params.userId;
        
        // Updated role list to include wallet_admin instead of separate credit/debit admins
        if (!role || !['admin', 'user', 'agent', 'Editor', 'wallet_admin'].includes(role)) {
            return res.status(400).json({ 
                success: false,
                message: 'Valid role is required (admin, user, agent, Editor, or wallet_admin)' 
            });
        }
        
        const user = await User.findById(targetUserId);
        
        if (!user) {
            return res.status(404).json({ 
                success: false,
                message: 'User not found' 
            });
        }
        
        // Don't allow the last admin to change their role
        if (user.role === 'admin' && role !== 'admin') {
            const adminCount = await User.countDocuments({ role: 'admin' });
            if (adminCount <= 1) {
                return res.status(400).json({ 
                    success: false,
                    message: 'Cannot change role of the last admin user' 
                });
            }
        }
        
        const previousRole = user.role;
        user.role = role;
        user.updatedAt = Date.now();
        
        await user.save();
        
        // Admin is already fetched in adminAuth middleware
        const admin = req.user;
        
        // Log admin action
        await logAdminAction(admin._id, 'change_user_role', targetUserId, {
            previousRole,
            newRole: role,
            ipAddress: req.ip,
            targetUser: {
                username: user.username,
                email: user.email
            },
            changedBy: {
                username: admin.username,
                role: admin.role
            }
        });
        
        res.status(200).json({
            success: true,
            message: `User role updated from ${previousRole} to ${role} successfully`,
            username: user.username,
            previousRole,
            newRole: role,
            rolePermissions: {
                canViewAllUsers: role === 'admin',
                canViewAllTransactions: role === 'admin',
                canCredit: ['admin', 'wallet_admin'].includes(role),
                canDebit: ['admin', 'wallet_admin'].includes(role),
                canChangeRoles: role === 'admin',
                canDeleteUsers: role === 'admin',
                canUpdateOrderStatus: ['admin', 'Editor'].includes(role),
                isUnifiedWalletAdmin: role === 'wallet_admin',
                isEditor: role === 'Editor'
            },
            changedBy: {
                adminId: admin._id,
                username: admin.username,
                role: admin.role,
                timestamp: new Date()
            }
        });
    } catch (error) {
        console.error('Error changing user role:', error);
        res.status(500).json({ 
            success: false,
            message: 'Server error', 
            error: error.message 
        });
    }
});

// PATCH disable/enable user (FULL ADMIN ONLY - EDITORS BLOCKED)
router.patch('/users/:userId/status', auth, adminAuth, blockEditors, requireFullAdmin, async (req, res) => {
    try {
        const targetUserId = req.params.userId;
        const user = await User.findById(targetUserId);
        
        if (!user) {
            return res.status(404).json({ 
                success: false,
                message: 'User not found' 
            });
        }
        
        const previousStatus = user.isActive;
        user.isActive = !user.isActive;
        user.updatedAt = Date.now();
        
        await user.save();
        
        // Admin is already fetched in adminAuth middleware
        const admin = req.user;
        
        // Log admin action
        await logAdminAction(admin._id, 'change_user_status', targetUserId, {
            previousStatus,
            newStatus: user.isActive,
            action: user.isActive ? 'enabled' : 'disabled',
            ipAddress: req.ip,
            targetUser: {
                username: user.username,
                email: user.email
            },
            changedBy: {
                username: admin.username,
                role: admin.role
            }
        });
        
        res.status(200).json({
            success: true,
            message: `User ${user.isActive ? 'enabled' : 'disabled'} successfully`,
            isActive: user.isActive,
            username: user.username,
            changedBy: {
                adminId: admin._id,
                username: admin.username,
                role: admin.role,
                timestamp: new Date()
            }
        });
    } catch (error) {
        console.error('Error updating user status:', error);
        res.status(500).json({ 
            success: false,
            message: 'Server error', 
            error: error.message 
        });
    }
});

// DELETE a user (FULL ADMIN ONLY - EDITORS BLOCKED)
router.delete('/users/:userId', auth, adminAuth, blockEditors, requireFullAdmin, async (req, res) => {
    try {
        const targetUserId = req.params.userId;
        const user = await User.findById(targetUserId);
        
        if (!user) {
            return res.status(404).json({ 
                success: false,
                message: 'User not found' 
            });
        }
        
        // Store user info for logging before deletion
        const deletedUserInfo = {
            username: user.username,
            email: user.email,
            role: user.role,
            isActive: user.isActive,
            createdAt: user.createdAt
        };
        
        await User.findByIdAndDelete(targetUserId);
        
        // Admin is already fetched in adminAuth middleware
        const admin = req.user;
        
        // Log admin action
        await logAdminAction(admin._id, 'delete_user', targetUserId, {
            deletedUser: deletedUserInfo,
            ipAddress: req.ip,
            deletedBy: {
                username: admin.username,
                role: admin.role
            }
        });
        
        res.status(200).json({ 
            success: true,
            message: 'User deleted successfully',
            deletedUser: {
                username: deletedUserInfo.username,
                email: deletedUserInfo.email
            },
            deletedBy: {
                adminId: admin._id,
                username: admin.username,
                role: admin.role,
                timestamp: new Date()
            }
        });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ 
            success: false,
            message: 'Server error', 
            error: error.message 
        });
    }
});

// GET admin activity log (FULL ADMIN ONLY - EDITORS BLOCKED)
router.get('/admin-logs', auth, adminAuth, blockEditors, requireFullAdmin, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const skip = (page - 1) * limit;
        
        // Filter options
        const filter = {};
        
        if (req.query.adminId) {
            filter.user = req.query.adminId;
        }
        
        if (req.query.action) {
            filter['requestData.action'] = req.query.action;
        }
        
        if (req.query.startDate && req.query.endDate) {
            filter.createdAt = {
                $gte: new Date(req.query.startDate),
                $lte: new Date(req.query.endDate)
            };
        }
        
        const total = await ApiLog.countDocuments(filter);
        
        const logs = await ApiLog.find(filter)
            .populate({
                path: 'user',
                select: 'username email role'
            })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
        
        const totalPages = Math.ceil(total / limit);
        
        res.status(200).json({
            success: true,
            data: logs,
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
        console.error('Error fetching admin logs:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching admin logs',
            error: error.message
        });
    }
});

// GET top users with most sales in the past 6 days (FULL ADMIN ONLY - EDITORS BLOCKED)
router.get('/top-sales-users', auth, adminAuth, blockEditors, requireFullAdmin, async (req, res) => {
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
  
// POST reward top sales performers (FULL ADMIN ONLY - EDITORS BLOCKED)
router.post('/reward-top-performers', auth, adminAuth, blockEditors, requireFullAdmin, async (req, res) => {
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
      
      // Admin is already fetched in adminAuth middleware
      const admin = req.user;
      
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
          processedBy: admin._id,
          processedByInfo: {
            adminId: admin._id,
            username: admin.username,
            email: admin.email,
            role: admin.role
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

module.exports = router;