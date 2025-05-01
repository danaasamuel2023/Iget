// routes/adminMessages.js
const express = require('express');
const router = express.Router();
const { User } = require('../schema/schema');
const auth = require('../AuthMiddle/middlewareauth'); 
const adminAuth = require('../adminMiddlware/middleware'); 
const ARKESEL_API_KEY = 'OnFqOUpMZXYyVGRFZHJWMmo=';
const axios = require('axios');

/**
 * Send SMS via Arkesel API
 * @param {string} phoneNumber - The recipient's phone number
 * @param {string} message - The SMS content
 * @param {Object} options - Optional parameters (scheduleTime, useCase, senderID)
 * @returns {Promise<Object>} - Response from API or error details
 */
const sendSMS = async (phoneNumber, message, options = {}) => {
  const {
    scheduleTime = null,
    useCase = null,
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

  // Add Nigerian use case if phone number starts with 234
  if (phoneNumber.startsWith('234') && !useCase) {
    params.use_case = 'transactional';
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

/**
 * Format phone number for SMS sending
 * @param {string} phoneNumber - The phone number to format
 * @returns {string} - Properly formatted phone number
 */
const formatPhoneForSms = (phoneNumber) => {
  if (!phoneNumber) return '';
  
  // Remove leading '+' if present
  let formatted = phoneNumber.replace(/^\+/, '');
  
  // Handle Ghana numbers - convert +233 format to 0 format if needed for SMS API
  if (formatted.startsWith('233')) {
    // Keep as is - Arkesel accepts this format
  } else if (formatted.startsWith('0')) {
    // Convert 0XX format to 233XX for Ghana numbers
    formatted = '233' + formatted.substring(1);
  }

  return formatted;
};

/**
 * @route   POST /api/admin/messages/send-to-all
 * @desc    Send message to all users
 * @access  Admin
 */
router.post('/send-to-all', auth, adminAuth, async (req, res) => {
  try {
    const { message, senderID, useCase = 'transactional', filters = {} } = req.body;
    
    if (!message) {
      return res.status(400).json({
        success: false,
        message: 'Message content is required'
      });
    }
    
    // Build query based on optional filters
    const query = { phone: { $exists: true, $ne: '' } };
    
    // Add optional filters
    if (filters.role) {
      query.role = filters.role;
    }
    
    if (filters.isActive !== undefined) {
      query.isActive = filters.isActive;
    }
    
    // Get all users with valid phone numbers
    const users = await User.find(query).select('phone username');
    
    if (!users.length) {
      return res.status(404).json({
        success: false,
        message: 'No users with valid phone numbers found'
      });
    }
    
    // Prepare results array
    const results = {
      total: users.length,
      successful: 0,
      failed: 0,
      failures: []
    };
    
    // Send SMS to each user
    for (const user of users) {
      try {
        const formattedPhone = formatPhoneForSms(user.phone);
        
        if (!formattedPhone) {
          results.failed++;
          results.failures.push({
            username: user.username,
            phone: user.phone,
            error: 'Invalid phone number format'
          });
          continue;
        }
        
        const smsResult = await sendSMS(formattedPhone, message, {
          senderID: senderID || 'EL VENDER',
          useCase
        });
        
        if (smsResult.success) {
          results.successful++;
        } else {
          results.failed++;
          results.failures.push({
            username: user.username,
            phone: user.phone,
            error: smsResult.error?.message || 'SMS sending failed'
          });
        }
      } catch (smsError) {
        results.failed++;
        results.failures.push({
          username: user.username,
          phone: user.phone,
          error: smsError.message
        });
      }
    }
    
    res.status(200).json({
      success: true,
      message: `Message sent to ${results.successful} out of ${results.total} users`,
      results
    });
    
  } catch (error) {
    console.error('Error sending bulk messages:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/admin/messages/send-to-selected
 * @desc    Send message to selected users
 * @access  Admin
 */
router.post('/send-to-selected', auth, adminAuth, async (req, res) => {
  try {
    const { message, senderID, useCase = 'transactional', userIds } = req.body;
    
    if (!message) {
      return res.status(400).json({
        success: false,
        message: 'Message content is required'
      });
    }
    
    if (!userIds || !Array.isArray(userIds) || !userIds.length) {
      return res.status(400).json({
        success: false,
        message: 'At least one user ID is required'
      });
    }
    
    // Get selected users with valid phone numbers
    const users = await User.find({
      _id: { $in: userIds },
      phone: { $exists: true, $ne: '' }
    }).select('phone username');
    
    if (!users.length) {
      return res.status(404).json({
        success: false,
        message: 'No selected users with valid phone numbers found'
      });
    }
    
    // Prepare results array
    const results = {
      total: users.length,
      successful: 0,
      failed: 0,
      failures: []
    };
    
    // Send SMS to each selected user
    for (const user of users) {
      try {
        const formattedPhone = formatPhoneForSms(user.phone);
        
        if (!formattedPhone) {
          results.failed++;
          results.failures.push({
            username: user.username,
            phone: user.phone,
            error: 'Invalid phone number format'
          });
          continue;
        }
        
        const smsResult = await sendSMS(formattedPhone, message, {
          senderID: senderID || 'EL VENDER',
          useCase
        });
        
        if (smsResult.success) {
          results.successful++;
        } else {
          results.failed++;
          results.failures.push({
            username: user.username,
            phone: user.phone,
            error: smsResult.error?.message || 'SMS sending failed'
          });
        }
      } catch (smsError) {
        results.failed++;
        results.failures.push({
          username: user.username,
          phone: user.phone,
          error: smsError.message
        });
      }
    }
    
    res.status(200).json({
      success: true,
      message: `Message sent to ${results.successful} out of ${results.total} selected users`,
      results
    });
    
  } catch (error) {
    console.error('Error sending messages to selected users:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/admin/messages/send-to-user/:userId
 * @desc    Send message to a specific user
 * @access  Admin
 */
router.post('/send-to-user/:userId', auth, adminAuth, async (req, res) => {
  try {
    const { message, senderID, useCase = 'transactional' } = req.body;
    const { userId } = req.params;
    
    if (!message) {
      return res.status(400).json({
        success: false,
        message: 'Message content is required'
      });
    }
    
    // Get user with phone number
    const user = await User.findById(userId).select('phone username');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    if (!user.phone) {
      return res.status(400).json({
        success: false,
        message: 'User does not have a registered phone number'
      });
    }
    
    const formattedPhone = formatPhoneForSms(user.phone);
    
    if (!formattedPhone) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format'
      });
    }
    
    // Send the SMS
    const smsResult = await sendSMS(formattedPhone, message, {
      senderID: senderID || 'EL VENDER',
      useCase
    });
    
    if (!smsResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Failed to send SMS',
        error: smsResult.error
      });
    }
    
    res.status(200).json({
      success: true,
      message: `Message sent successfully to ${user.username}`,
      data: {
        recipient: {
          id: user._id,
          username: user.username
        },
        smsResponse: smsResult.data
      }
    });
    
  } catch (error) {
    console.error('Error sending message to user:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/admin/messages/broadcast
 * @desc    Broadcast message based on advanced filters 
 * @access  Admin
 */
router.post('/broadcast', auth, adminAuth, async (req, res) => {
  try {
    const { 
      message, 
      senderID, 
      useCase = 'transactional',
      filters = {}, 
      scheduleTime = null 
    } = req.body;
    
    if (!message) {
      return res.status(400).json({
        success: false,
        message: 'Message content is required'
      });
    }
    
    // Build advanced filter query
    const query = { phone: { $exists: true, $ne: '' } };
    
    // Apply role filter
    if (filters.role) {
      query.role = filters.role;
    }
    
    // Apply active status filter
    if (filters.isActive !== undefined) {
      query.isActive = filters.isActive;
    }
    
    // Apply registration date filter
    if (filters.registeredAfter) {
      query.createdAt = { ...query.createdAt || {}, $gte: new Date(filters.registeredAfter) };
    }
    
    if (filters.registeredBefore) {
      query.createdAt = { ...query.createdAt || {}, $lte: new Date(filters.registeredBefore) };
    }
    
    // Apply wallet balance filter if provided
    if (filters.minWalletBalance !== undefined) {
      query['wallet.balance'] = { ...query['wallet.balance'] || {}, $gte: parseFloat(filters.minWalletBalance) };
    }
    
    if (filters.maxWalletBalance !== undefined) {
      query['wallet.balance'] = { ...query['wallet.balance'] || {}, $lte: parseFloat(filters.maxWalletBalance) };
    }
    
    // Handle last login filter 
    if (filters.lastLoginAfter) {
      query.lastLogin = { ...query.lastLogin || {}, $gte: new Date(filters.lastLoginAfter) };
    }
    
    if (filters.lastLoginBefore) {
      query.lastLogin = { ...query.lastLogin || {}, $lte: new Date(filters.lastLoginBefore) };
    }

    // Apply "has placed order" filter if needed
    if (filters.hasPlacedOrder !== undefined) {
      if (filters.hasPlacedOrder) {
        query.orders = { $exists: true, $ne: [] };
      } else {
        query.$or = [
          { orders: { $exists: false } },
          { orders: { $size: 0 } }
        ];
      }
    }
    
    // Get all users matching the filters
    const users = await User.find(query).select('phone username');
    
    if (!users.length) {
      return res.status(404).json({
        success: false,
        message: 'No users match the specified filter criteria'
      });
    }
    
    // Prepare results array
    const results = {
      total: users.length,
      successful: 0,
      failed: 0,
      failures: []
    };
    
    // Send SMS to each user
    for (const user of users) {
      try {
        const formattedPhone = formatPhoneForSms(user.phone);
        
        if (!formattedPhone) {
          results.failed++;
          results.failures.push({
            username: user.username,
            phone: user.phone,
            error: 'Invalid phone number format'
          });
          continue;
        }
        
        const smsResult = await sendSMS(formattedPhone, message, {
          senderID: senderID || 'EL VENDER',
          useCase,
          scheduleTime
        });
        
        if (smsResult.success) {
          results.successful++;
        } else {
          results.failed++;
          results.failures.push({
            username: user.username,
            phone: user.phone,
            error: smsResult.error?.message || 'SMS sending failed'
          });
        }
      } catch (smsError) {
        results.failed++;
        results.failures.push({
          username: user.username,
          phone: user.phone,
          error: smsError.message
        });
      }
    }
    
    res.status(200).json({
      success: true,
      message: `Message ${scheduleTime ? 'scheduled' : 'sent'} to ${results.successful} out of ${results.total} users`,
      scheduled: !!scheduleTime,
      scheduledTime: scheduleTime,
      filterCriteria: filters,
      results
    });
    
  } catch (error) {
    console.error('Error broadcasting messages:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/admin/messages/sms-balance
 * @desc    Check SMS account balance
 * @access  Admin
 */
router.get('/sms-balance', auth, adminAuth, async (req, res) => {
  try {
    const params = {
      action: 'check-balance',
      api_key: ARKESEL_API_KEY
    };

    const response = await axios.get('https://sms.arkesel.com/sms/api', {
      params,
      timeout: 10000
    });

    if (response.data.code !== 'ok') {
      return res.status(400).json({
        success: false,
        message: 'Failed to retrieve SMS balance',
        error: response.data
      });
    }

    res.status(200).json({
      success: true,
      data: {
        balance: response.data.balance,
        currency: response.data.currency || 'GHS',
        mainBalance: response.data.main_balance
      }
    });
  } catch (error) {
    console.error('Error checking SMS balance:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/admin/messages/template
 * @desc    Save message template for reuse
 * @access  Admin
 */
router.post('/template', auth, adminAuth, async (req, res) => {
  try {
    const { name, content, description, variables } = req.body;
    
    if (!name || !content) {
      return res.status(400).json({
        success: false,
        message: 'Template name and content are required'
      });
    }
    
    // Create new template schema entry
    // Note: You'll need to add a MessageTemplate schema to your models
    const newTemplate = new MessageTemplate({
      name,
      content,
      description,
      variables: variables || [],
      createdBy: req.user.id
    });
    
    await newTemplate.save();
    
    res.status(201).json({
      success: true,
      message: 'Message template saved successfully',
      data: newTemplate
    });
    
  } catch (error) {
    console.error('Error saving message template:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

module.exports = router;