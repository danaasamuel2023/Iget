const express = require('express');
const router = express.Router();
const axios = require('axios');
const { User, Transaction, ApiLog } = require('../schema/schema');
const auth = require('../AuthMiddle/middlewareauth'); 
const adminAuth = require('../adminMiddlware/middleware');

// SMS configuration
const ARKESEL_API_KEY = 'OnFqOUpMZXYyVGRFZHJWMmo=';

// SMS sending function (reusable across modules)
const sendSMS = async (phoneNumber, message, options = {}) => {
  const {
    scheduleTime = null,
    useCase = 'transactional',
    senderID = 'EL VENDER'
  } = options;

  // Input validation
  if (!phoneNumber || !message) {
    throw new Error('Phone number and message are required');
  }

  // Base parameters
  const params = {
    action: 'send-sms',
    api_key: ARKESEL_API_KEY,
    to: phoneNumber,
    from: senderID,
    sms: message
  };

  // Add optional parameters
  if (scheduleTime) {
    params.schedule = scheduleTime;
  }

  if (useCase && ['promotional', 'transactional'].includes(useCase)) {
    params.use_case = useCase;
  }

  try {
    const response = await axios.get('https://sms.arkesel.com/sms/api', {
      params,
      timeout: 10000 // 10 second timeout
    });

    // Map error codes to meaningful messages
    const errorCodes = {
      '100': 'Bad gateway request',
      '101': 'Wrong action',
      '102': 'Authentication failed',
      '103': 'Invalid phone number',
      '104': 'Phone coverage not active',
      '105': 'Insufficient balance',
      '106': 'Invalid Sender ID',
      '109': 'Invalid Schedule Time',
      '111': 'SMS contains spam word. Wait for approval'
    };

    if (response.data.code !== 'ok') {
      const errorMessage = errorCodes[response.data.code] || 'Unknown error occurred';
      throw new Error(`SMS sending failed: ${errorMessage}`);
    }

    console.log('SMS sent successfully:', {
      to: phoneNumber,
      status: response.data.code,
      balance: response.data.balance,
      mainBalance: response.data.main_balance
    });

    return {
      success: true,
      data: response.data
    };

  } catch (error) {
    // Handle specific error types
    if (error.response) {
      console.error('SMS API responded with error:', {
        status: error.response.status,
        data: error.response.data
      });
    } else if (error.request) {
      console.error('No response received from SMS API:', error.message);
    } else {
      console.error('SMS request setup error:', error.message);
    }

    return {
      success: false,
      error: {
        message: error.message,
        code: error.response?.data?.code,
        details: error.response?.data
      }
    };
  }
};

// Format phone number for SMS - remove country code prefix if present
const formatPhoneForSms = (phone) => {
  if (!phone) return null;
  // Remove +233 or 233 prefix and return the number
  return phone.replace(/^\+?233/, '0');
};

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
            canApproveUsers: admin.role === 'admin', // NEW: User approval permission
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
                admin: 'Full administrative access to all features including user approval',
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

// ============================================
// USER APPROVAL ROUTES (ADMIN ONLY)
// ============================================

// GET all pending approval users (ADMIN ONLY)
router.get('/users/pending-approval', auth, adminAuth, requireFullAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    // Count total pending users
    const total = await User.countDocuments({ approvalStatus: 'pending' });
    
    // Get pending users
    const pendingUsers = await User.find({ approvalStatus: 'pending' })
      .select('-password -apiKey') // Exclude sensitive fields
      .sort({ 'approvalInfo.approvalRequestedAt': 1 }) // Oldest first
      .skip(skip)
      .limit(limit);
    
    // Log admin action
    await logAdminAction(req.user._id, 'view_pending_approvals', null, { 
      ipAddress: req.ip,
      totalPending: total
    });
    
    const totalPages = Math.ceil(total / limit);
    
    res.status(200).json({
      success: true,
      data: pendingUsers,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      },
      message: total > 0 ? `${total} users pending approval` : 'No users pending approval'
    });
    
  } catch (error) {
    console.error('Error fetching pending approval users:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching pending approvals',
      error: error.message
    });
  }
});

// GET all approved users (ADMIN ONLY)
router.get('/users/approved', auth, adminAuth, requireFullAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    const total = await User.countDocuments({ approvalStatus: 'approved' });
    
    const approvedUsers = await User.find({ approvalStatus: 'approved' })
      .select('-password -apiKey')
      .populate({
        path: 'approvalInfo.approvedBy',
        select: 'username email'
      })
      .sort({ 'approvalInfo.approvedAt': -1 }) // Most recently approved first
      .skip(skip)
      .limit(limit);
    
    const totalPages = Math.ceil(total / limit);
    
    res.status(200).json({
      success: true,
      data: approvedUsers,
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
    console.error('Error fetching approved users:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching approved users',
      error: error.message
    });
  }
});

// GET all rejected users (ADMIN ONLY)
router.get('/users/rejected', auth, adminAuth, requireFullAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    const total = await User.countDocuments({ approvalStatus: 'rejected' });
    
    const rejectedUsers = await User.find({ approvalStatus: 'rejected' })
      .select('-password -apiKey')
      .populate({
        path: 'approvalInfo.rejectedBy',
        select: 'username email'
      })
      .sort({ 'approvalInfo.rejectedAt': -1 }) // Most recently rejected first
      .skip(skip)
      .limit(limit);
    
    const totalPages = Math.ceil(total / limit);
    
    res.status(200).json({
      success: true,
      data: rejectedUsers,
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
    console.error('Error fetching rejected users:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching rejected users',
      error: error.message
    });
  }
});

// POST approve a user (ADMIN ONLY)
router.post('/users/:userId/approve', auth, adminAuth, requireFullAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { notes, sendSMSNotification = true } = req.body; // Optional approval notes and SMS
    
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    if (user.approvalStatus === 'approved') {
      return res.status(400).json({
        success: false,
        message: 'User is already approved'
      });
    }
    
    // Approve the user
    user.approveUser(req.user._id, notes);
    await user.save();
    
    // Send SMS notification if enabled and user has a phone number
    let smsResult = null;
    if (sendSMSNotification && user.phone) {
      try {
        const formattedPhone = formatPhoneForSms(user.phone);
        const smsMessage = `Good news! Your account has been approved by our admin team. You can now login and use all features of our platform. Welcome aboard!`;
        
        smsResult = await sendSMS(formattedPhone, smsMessage, {
          useCase: 'transactional',
          senderID: 'EL VENDER'
        });
        
        if (smsResult.success) {
          console.log(`Approval SMS sent to: ${user.username} (${formattedPhone})`);
        } else {
          console.error(`Failed to send approval SMS: ${smsResult.error?.message || 'Unknown error'}`);
        }
      } catch (smsError) {
        console.error('Error sending approval SMS:', smsError.message);
        smsResult = { success: false, error: { message: smsError.message } };
      }
    }
    
    // Log admin action
    await logAdminAction(req.user._id, 'approve_user', userId, {
      ipAddress: req.ip,
      approvalNotes: notes,
      targetUser: {
        username: user.username,
        email: user.email
      },
      approvedBy: {
        username: req.user.username,
        role: req.user.role
      },
      smsNotification: smsResult ? {
        attempted: true,
        success: smsResult.success || false,
        error: smsResult.error?.message || null
      } : {
        attempted: false,
        reason: 'No phone number available or SMS disabled'
      }
    });
    
    res.status(200).json({
      success: true,
      message: 'User approved successfully',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        approvalStatus: user.approvalStatus,
        approvedAt: user.approvalInfo.approvedAt,
        approvedBy: req.user.username,
        approvalNotes: notes
      },
      smsNotification: smsResult ? {
        sent: smsResult.success || false,
        error: smsResult.error?.message || null
      } : null
    });
    
  } catch (error) {
    console.error('Error approving user:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while approving user',
      error: error.message
    });
  }
});

// POST reject a user (ADMIN ONLY)
router.post('/users/:userId/reject', auth, adminAuth, requireFullAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason, sendSMSNotification = true } = req.body; // Required rejection reason
    
    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Rejection reason is required'
      });
    }
    
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    if (user.approvalStatus === 'rejected') {
      return res.status(400).json({
        success: false,
        message: 'User is already rejected'
      });
    }
    
    if (user.approvalStatus === 'approved') {
      return res.status(400).json({
        success: false,
        message: 'Cannot reject an already approved user. Use the disable user function instead.'
      });
    }
    
    // Reject the user
    user.rejectUser(req.user._id, reason);
    await user.save();
    
    // Send SMS notification if enabled and user has a phone number
    let smsResult = null;
    if (sendSMSNotification && user.phone) {
      try {
        const formattedPhone = formatPhoneForSms(user.phone);
        const smsMessage = `Unfortunately, your account registration has been rejected. Reason: ${reason}. Please contact support if you have questions.`;
        
        smsResult = await sendSMS(formattedPhone, smsMessage, {
          useCase: 'transactional',
          senderID: 'EL VENDER'
        });
        
        if (smsResult.success) {
          console.log(`Rejection SMS sent to: ${user.username} (${formattedPhone})`);
        } else {
          console.error(`Failed to send rejection SMS: ${smsResult.error?.message || 'Unknown error'}`);
        }
      } catch (smsError) {
        console.error('Error sending rejection SMS:', smsError.message);
        smsResult = { success: false, error: { message: smsError.message } };
      }
    }
    
    // Log admin action
    await logAdminAction(req.user._id, 'reject_user', userId, {
      ipAddress: req.ip,
      rejectionReason: reason,
      targetUser: {
        username: user.username,
        email: user.email
      },
      rejectedBy: {
        username: req.user.username,
        role: req.user.role
      },
      smsNotification: smsResult ? {
        attempted: true,
        success: smsResult.success || false,
        error: smsResult.error?.message || null
      } : {
        attempted: false,
        reason: 'No phone number available or SMS disabled'
      }
    });
    
    res.status(200).json({
      success: true,
      message: 'User rejected successfully',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        approvalStatus: user.approvalStatus,
        rejectedAt: user.approvalInfo.rejectedAt,
        rejectedBy: req.user.username,
        rejectionReason: reason
      },
      smsNotification: smsResult ? {
        sent: smsResult.success || false,
        error: smsResult.error?.message || null
      } : null
    });
    
  } catch (error) {
    console.error('Error rejecting user:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while rejecting user',
      error: error.message
    });
  }
});

// POST bulk approve users (ADMIN ONLY)
router.post('/users/bulk-approve', auth, adminAuth, requireFullAdmin, async (req, res) => {
  try {
    const { userIds, notes, sendSMSNotification = true } = req.body;
    
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid userIds array is required'
      });
    }
    
    const approvedUsers = [];
    const errors = [];
    const smsResults = [];
    
    for (const userId of userIds) {
      try {
        const user = await User.findById(userId);
        
        if (!user) {
          errors.push({ userId, error: 'User not found' });
          continue;
        }
        
        if (user.approvalStatus === 'approved') {
          errors.push({ userId, error: 'User already approved' });
          continue;
        }
        
        user.approveUser(req.user._id, notes);
        await user.save();
        
        approvedUsers.push({
          id: user._id,
          username: user.username,
          email: user.email
        });
        
        // Send SMS notification if enabled and user has a phone number
        let smsResult = null;
        if (sendSMSNotification && user.phone) {
          try {
            const formattedPhone = formatPhoneForSms(user.phone);
            const smsMessage = `Good news! Your account has been approved by our admin team. You can now login and use all features of our platform. Welcome aboard!`;
            
            smsResult = await sendSMS(formattedPhone, smsMessage, {
              useCase: 'transactional',
              senderID: 'EL VENDER'
            });
            
            if (smsResult.success) {
              console.log(`Bulk approval SMS sent to: ${user.username} (${formattedPhone})`);
            }
          } catch (smsError) {
            console.error('Error sending bulk approval SMS:', smsError.message);
            smsResult = { success: false, error: { message: smsError.message } };
          }
        }
        
        smsResults.push({
          userId: user._id,
          username: user.username,
          smsResult: smsResult
        });
        
        // Log individual approval
        await logAdminAction(req.user._id, 'bulk_approve_user', userId, {
          ipAddress: req.ip,
          bulkOperation: true,
          approvalNotes: notes,
          targetUser: {
            username: user.username,
            email: user.email
          }
        });
        
      } catch (error) {
        errors.push({ userId, error: error.message });
      }
    }
    
    res.status(200).json({
      success: true,
      message: `Bulk approval completed. ${approvedUsers.length} users approved, ${errors.length} errors.`,
      approvedUsers,
      errors,
      summary: {
        totalRequested: userIds.length,
        successful: approvedUsers.length,
        failed: errors.length
      },
      smsNotifications: {
        attempted: smsResults.filter(r => r.smsResult !== null).length,
        successful: smsResults.filter(r => r.smsResult?.success).length,
        failed: smsResults.filter(r => r.smsResult && !r.smsResult.success).length
      }
    });
    
  } catch (error) {
    console.error('Error in bulk approval:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during bulk approval',
      error: error.message
    });
  }
});

// GET approval statistics (ADMIN ONLY)
router.get('/users/approval-stats', auth, adminAuth, requireFullAdmin, async (req, res) => {
  try {
    const stats = await Promise.all([
      User.countDocuments({ approvalStatus: 'pending' }),
      User.countDocuments({ approvalStatus: 'approved' }),
      User.countDocuments({ approvalStatus: 'rejected' }),
      User.countDocuments({ approvalStatus: 'approved', isActive: true }),
      User.countDocuments({ approvalStatus: 'approved', isActive: false })
    ]);
    
    const [pendingCount, approvedCount, rejectedCount, activeApprovedCount, inactiveApprovedCount] = stats;
    
    // Get recent approval activity (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const recentActivity = await Promise.all([
      User.countDocuments({ 
        approvalStatus: 'approved', 
        'approvalInfo.approvedAt': { $gte: sevenDaysAgo } 
      }),
      User.countDocuments({ 
        approvalStatus: 'rejected', 
        'approvalInfo.rejectedAt': { $gte: sevenDaysAgo } 
      }),
      User.countDocuments({ 
        approvalStatus: 'pending',
        'approvalInfo.approvalRequestedAt': { $gte: sevenDaysAgo } 
      })
    ]);
    
    const [recentApprovals, recentRejections, recentRegistrations] = recentActivity;
    
    res.status(200).json({
      success: true,
      stats: {
        pending: pendingCount,
        approved: approvedCount,
        rejected: rejectedCount,
        activeApproved: activeApprovedCount,
        inactiveApproved: inactiveApprovedCount,
        total: pendingCount + approvedCount + rejectedCount
      },
      recentActivity: {
        period: '7 days',
        approvals: recentApprovals,
        rejections: recentRejections,
        newRegistrations: recentRegistrations
      },
      actionRequired: {
        pendingApprovals: pendingCount,
        urgentAction: pendingCount > 10 ? 'High number of pending approvals' : null
      }
    });
    
  } catch (error) {
    console.error('Error fetching approval stats:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching approval statistics',
      error: error.message
    });
  }
});

// ============================================
// EXISTING USER MANAGEMENT ROUTES
// ============================================

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
        
        // NEW: Filter by approval status
        if (req.query.approvalStatus) {
            filter.approvalStatus = req.query.approvalStatus;
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
            // Full admin gets all user data including approval info
            selectFields = '-password -apiKey';
            const users = await User.find(filter)
                .select(selectFields)
                .populate({
                    path: 'approvalInfo.approvedBy',
                    select: 'username email'
                })
                .populate({
                    path: 'approvalInfo.rejectedBy',
                    select: 'username email'
                })
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
            // wallet_admin gets limited user data - only approved users for wallet operations
            filter.approvalStatus = 'approved'; // Only show approved users to wallet admins
            
            selectFields = 'username email wallet role isActive createdAt phone approvalStatus';
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
                note: `Limited user data for ${req.user.role} role - wallet operations only (approved users only)`
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
        const { amount, description, paymentMethod, paymentDetails, sendSMSNotification = true } = req.body;
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
        
        // NEW: Check if user is approved
        if (user.approvalStatus !== 'approved') {
            return res.status(400).json({
                success: false,
                message: 'Cannot perform wallet operations on non-approved users',
                userApprovalStatus: user.approvalStatus
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
        
        // Send SMS notification if enabled and user has a phone number
        let smsResult = null;
        if (sendSMSNotification && user.phone) {
            try {
                const formattedPhone = formatPhoneForSms(user.phone);
                const smsMessage = `GH¢${parseFloat(amount).toFixed(2)} has been credited to your account. Your current balance is GH¢${balanceAfter.toFixed(2)}.`;
                
                smsResult = await sendSMS(formattedPhone, smsMessage, {
                    useCase: 'transactional',
                    senderID: 'EL VENDER'
                });
                
                if (smsResult.success) {
                    console.log(`SMS sent for wallet credit: ${user.username} (${formattedPhone}), Amount: ${amount}`);
                } else {
                    console.error(`Failed to send credit SMS: ${smsResult.error?.message || 'Unknown error'}`);
                }
            } catch (smsError) {
                console.error('Error sending credit SMS:', smsError.message);
                smsResult = { success: false, error: { message: smsError.message } };
            }
        }
        
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
            },
            smsNotification: smsResult ? {
                attempted: true,
                success: smsResult.success || false,
                error: smsResult.error?.message || null
            } : {
                attempted: false,
                reason: 'No phone number available'
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
            },
            smsNotification: smsResult ? {
                sent: smsResult.success || false,
                error: smsResult.error?.message || null
            } : null
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
        const { amount, description, paymentMethod, paymentDetails, sendSMSNotification = true } = req.body;
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
        
        // NEW: Check if user is approved
        if (user.approvalStatus !== 'approved') {
            return res.status(400).json({
                success: false,
                message: 'Cannot perform wallet operations on non-approved users',
                userApprovalStatus: user.approvalStatus
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
        
        // Send SMS notification if enabled and user has a phone number
        let smsResult = null;
        if (sendSMSNotification && user.phone) {
            try {
                const formattedPhone = formatPhoneForSms(user.phone);
                const smsMessage = `GH¢${parseFloat(amount).toFixed(2)} has been debited from your account. Your current balance is GH¢${balanceAfter.toFixed(2)}.`;
                
                smsResult = await sendSMS(formattedPhone, smsMessage, {
                    useCase: 'transactional',
                    senderID: 'EL VENDER'
                });
                
                if (smsResult.success) {
                    console.log(`SMS sent for wallet debit: ${user.username} (${formattedPhone}), Amount: ${amount}`);
                } else {
                    console.error(`Failed to send debit SMS: ${smsResult.error?.message || 'Unknown error'}`);
                }
            } catch (smsError) {
                console.error('Error sending debit SMS:', smsError.message);
                smsResult = { success: false, error: { message: smsError.message } };
            }
        }
        
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
            },
            smsNotification: smsResult ? {
                attempted: true,
                success: smsResult.success || false,
                error: smsResult.error?.message || null
            } : {
                attempted: false,
                reason: 'No phone number available'
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
            },
            smsNotification: smsResult ? {
                sent: smsResult.success || false,
                error: smsResult.error?.message || null
            } : null
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
                canApproveUsers: role === 'admin', // NEW: User approval permission
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
            approvalStatus: user.approvalStatus, // NEW: Include approval status
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
      res
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
      const { percentages, description, sendSMSNotification = true } = req.body;
      
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
      const smsResults = [];
      
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
        
        // Send SMS notification if enabled and user has a phone number
        let smsResult = null;
        if (sendSMSNotification && user.phone) {
          try {
            const formattedPhone = formatPhoneForSms(user.phone);
            const smsMessage = `Congratulations! GH¢${rewardAmount.toFixed(2)} reward has been credited to your account for excellent sales performance. Your current balance is GH¢${balanceAfter.toFixed(2)}.`;
            
            smsResult = await sendSMS(formattedPhone, smsMessage, {
              useCase: 'transactional',
              senderID: 'iGet'
            });
            
            if (smsResult.success) {
              console.log(`SMS sent for reward: ${user.username} (${formattedPhone}), Amount: ${rewardAmount}`);
            } else {
              console.error(`Failed to send reward SMS: ${smsResult.error?.message || 'Unknown error'}`);
            }
          } catch (smsError) {
            console.error('Error sending reward SMS:', smsError.message);
            smsResult = { success: false, error: { message: smsError.message } };
          }
        }
        
        smsResults.push({
          userId: user._id,
          username: user.username,
          smsResult: smsResult
        });
        
        // Add to rewards array
        rewards.push({
          userId: user._id,
          username: user.username,
          email: user.email,
          totalSales: performer.totalSales,
          percentage: percentage,
          rewardAmount: rewardAmount,
          transactionId: transaction._id,
          smsNotification: smsResult ? {
            sent: smsResult.success || false,
            error: smsResult.error?.message || null
          } : null
        });
      }
      
      res.status(200).json({
        success: true,
        message: 'Top performers rewarded successfully',
        rewards: rewards,
        period: {
          from: sixDaysAgo,
          to: new Date()
        },
        smsNotifications: {
          attempted: smsResults.filter(r => r.smsResult !== null).length,
          successful: smsResults.filter(r => r.smsResult?.success).length,
          failed: smsResults.filter(r => r.smsResult && !r.smsResult.success).length
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