// routes/api.js - Updated to accept custom reference from developers
const express = require('express');
const router = express.Router();
const { Order, User, Transaction, Bundle } = require('../schema/schema');
const apiAuth = require('../middlewareApi/ApiAuth');
const { ApiLog } = require('../schema/schema');
const mongoose = require('mongoose');
const AdminSettings = require('../AdminSettingSchema/AdminSettings.js');

/**
 * Generate a 6-character alphanumeric reference
 * @returns {string} 6-character reference
 */
function generateReference() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * @route   POST /api/v1/orders/place
 * @desc    Place an order using API key auth with stock validation
 * @access  Private (API Key)
 */
router.post('/orders/place', apiAuth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { recipientNumber, capacity, bundleType, quantity = 1, reference } = req.body;
    
    // Validate required fields
    if (!recipientNumber || !capacity || !bundleType) {
      return res.status(400).json({
        success: false,
        message: 'Recipient number, capacity, and bundle type are all required'
      });
    }
    
    // Validate reference if provided
    let orderReference;
    if (reference) {
      // Check if reference is a string and has reasonable length (but enforce 6 characters for consistency)
      if (typeof reference !== 'string' || reference.length !== 6) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: 'Reference must be exactly 6 characters long'
        });
      }
      
      // Check if reference already exists for this user
      const existingOrder = await Order.findOne({
        orderReference: reference,
        user: req.user.id
      }).session(session);
      
      if (existingOrder) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: 'Reference already exists for your account. Please use a unique 6-character reference.',
          existingOrderId: existingOrder._id
        });
      }
      
      orderReference = reference.toUpperCase(); // Normalize to uppercase
      console.log(`Using developer-provided reference: ${orderReference}`);
    } else {
      // Generate our own 6-character reference if not provided
      let attempts = 0;
      do {
        orderReference = generateReference();
        attempts++;
        
        // Check if generated reference already exists (very unlikely but good practice)
        const existingOrder = await Order.findOne({
          orderReference: orderReference,
          user: req.user.id
        }).session(session);
        
        if (!existingOrder) break;
        
        if (attempts > 10) {
          throw new Error('Unable to generate unique reference after multiple attempts');
        }
      } while (attempts <= 10);
      
      console.log(`Generated system reference: ${orderReference}`);
    }
    
    // Find the matching bundle to get the correct price and check stock
    const bundle = await Bundle.findOne({ 
      type: bundleType,
      capacity: capacity,
      isActive: true
    }).session(session);
    
    if (!bundle) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: `No active bundle found matching type ${bundleType} with capacity ${capacity}GB`
      });
    }
    
    // CHECK STOCK STATUS - ENHANCED VALIDATION
    if (bundle.stockStatus?.isOutOfStock || bundle.isInStock === false) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `This bundle (${capacity}GB ${bundleType}) is currently out of stock`,
        stockInfo: {
          reason: bundle.stockStatus?.reason || 'No reason provided',
          markedOutAt: bundle.stockStatus?.markedOutOfStockAt,
          isOutOfStock: true
        }
      });
    }
    
    // CHECK STOCK UNITS - NEW VALIDATION
    const availableStock = bundle.stockUnits?.available || 0;
    if (availableStock < quantity) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Insufficient stock for ${capacity}GB ${bundleType}`,
        stockInfo: {
          available: availableStock,
          requested: quantity,
          isOutOfStock: availableStock === 0,
          isLowStock: bundle.stockStatus?.isLowStock || false,
          reason: bundle.stockStatus?.reason
        }
      });
    }
    
    // Get user for wallet balance check
    const user = await User.findById(req.user.id).session(session);
    if (!user) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Calculate price based on user role (if role-based pricing exists)
    const rolePrice = bundle.getPriceForRole ? bundle.getPriceForRole(user.role) : 
                     (bundle.rolePricing && bundle.rolePricing[user.role]) || bundle.price;
    const totalPrice = rolePrice * quantity;
    
    // Check if user has enough balance
    if (user.wallet.balance < totalPrice) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Insufficient balance in wallet. Required: ${totalPrice} ${user.wallet.currency}`,
        required: totalPrice,
        available: user.wallet.balance
      });
    }
    
    // RESERVE STOCK UNITS
    try {
      await bundle.reserveStock(quantity, session);
      console.log(`Stock reserved via API: ${quantity} units of ${bundleType} ${capacity}GB`);
    } catch (stockError) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: stockError.message,
        stockInfo: {
          available: bundle.stockUnits?.available || 0,
          requested: quantity
        }
      });
    }
    
    // Get admin settings to check if API integrations are enabled
    let adminSettings;
    try {
      adminSettings = await AdminSettings.getSettings();
    } catch (settingsError) {
      console.error('Error fetching admin settings:', settingsError);
      adminSettings = { apiIntegrations: {} };
    }
    
    // Create new order with stock metadata
    const newOrder = new Order({
      user: req.user.id,
      bundleType: bundleType,
      capacity: capacity,
      price: totalPrice,
      recipientNumber: recipientNumber,
      status: 'pending',
      orderReference: orderReference, // Use the determined 6-character reference
      metadata: {
        quantity: quantity,
        unitPrice: rolePrice,
        bundleId: bundle._id,
        stockReserved: quantity,
        stockSnapshot: {
          availableBefore: availableStock,
          availableAfter: bundle.stockUnits.available
        },
        placedVia: 'API',
        referenceProvidedByDeveloper: !!reference // Track if developer provided reference
      },
      updatedAt: Date.now()
    });
    
    // Handle API integrations for specific bundle types
    let apiError = null;
    
    if (bundleType.toLowerCase() === 'mtnup2u') {
      const mtnApiEnabled = adminSettings.apiIntegrations?.mtnHubnetEnabled !== false;
      
      if (mtnApiEnabled) {
        try {
          let volumeInMB = capacity;
          if (capacity < 100) {
            volumeInMB = parseFloat(capacity) * 1000;
          }
          
          console.log('Making Hubnet API request for mtnup2u bundle via API');
          
          const hubnetResponse = await fetch(`https://console.hubnet.app/live/api/context/business/transaction/mtn-new-transaction`, {
            method: 'POST',
            headers: {
              'token': 'Bearer biWUr20SFfp8W33BRThwqTkg2PhoaZTkeWx',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              phone: recipientNumber,
              volume: volumeInMB,
              reference: orderReference, // Use the same 6-character reference for external API
              referrer: '0598617011',
              webhook: ''
            })
          });
          
          const hubnetData = await hubnetResponse.json();
          console.log('Hubnet API Response:', hubnetData);
          
          if (!hubnetResponse.ok) {
            apiError = hubnetData.message || 'Hubnet API error';
            throw new Error(apiError);
          }
          
          newOrder.apiReference = orderReference;
          newOrder.hubnetReference = orderReference;
          
        } catch (error) {
          console.error('Error calling Hubnet API:', error.message);
          // Release reserved stock on API failure
          await bundle.releaseReservation(quantity, session);
          await session.abortTransaction();
          
          return res.status(400).json({
            success: false,
            message: 'API purchase failed. No payment has been processed.',
            error: error.message,
            stockReleased: true
          });
        }
      }
    } else if (bundleType.toLowerCase() === 'at-ishare') {
      const atApiEnabled = adminSettings.apiIntegrations?.atHubnetEnabled !== false;
      
      if (atApiEnabled) {
        try {
          let volumeInMB = capacity;
          if (capacity < 100) {
            volumeInMB = parseFloat(capacity) * 1000;
          }
          
          console.log('Making Hubnet API request for AT-ishare bundle via API');
          
          const hubnetResponse = await fetch(`https://console.hubnet.app/live/api/context/business/transaction/at-new-transaction`, {
            method: 'POST',
            headers: {
              'token': 'Bearer biWUr20SFfp8W33BRThwqTkg2PhoaZTkeWx',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              phone: recipientNumber,
              volume: volumeInMB,
              reference: orderReference, // Use the same 6-character reference for external API
              referrer: recipientNumber,
              webhook: ''
            })
          });
          
          const hubnetData = await hubnetResponse.json();
          console.log('Hubnet API Response:', hubnetData);
          
          if (!hubnetResponse.ok) {
            apiError = hubnetData.message || 'Hubnet API error';
            throw new Error(apiError);
          }
          
          newOrder.apiReference = orderReference;
          newOrder.hubnetReference = orderReference;
          
        } catch (error) {
          console.error('Error calling Hubnet API:', error.message);
          // Release reserved stock on API failure
          await bundle.releaseReservation(quantity, session);
          await session.abortTransaction();
          
          return res.status(400).json({
            success: false,
            message: 'Purchase failed. No payment has been processed.',
            error: error.message,
            stockReleased: true
          });
        }
      }
    }
    
    // Save the order
    await newOrder.save({ session });
    
    // Create transaction record with stock info
    const transaction = new Transaction({
      user: req.user.id,
      type: 'purchase',
      amount: -totalPrice,
      currency: user.wallet.currency,
      description: `API: Bundle purchase: ${quantity}x ${capacity}GB ${bundleType} for ${recipientNumber}`,
      status: 'completed',
      reference: 'API-TXN-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      orderId: newOrder._id,
      balanceBefore: user.wallet.balance,
      balanceAfter: user.wallet.balance - totalPrice,
      paymentMethod: 'wallet',
      metadata: {
        bundleId: bundle._id,
        quantity: quantity,
        stockReserved: quantity,
        placedVia: 'API',
        developerReference: reference || null
      }
    });
    
    await transaction.save({ session });
    
    // Update user's wallet balance
    user.wallet.balance -= totalPrice;
    user.wallet.transactions.push(transaction._id);
    await user.save({ session });
    
    // Commit the transaction
    await session.commitTransaction();
    
    // Log API order placement
    await ApiLog.create({
      userId: req.user.id,
      apiKeyId: req.apiKeyId,
      endpoint: '/api/v1/orders/place',
      method: 'POST',
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      requestBody: {
        recipientNumber,
        capacity,
        bundleType,
        quantity,
        reference: reference || 'auto-generated'
      },
      responseStatus: 201,
      responseData: {
        orderId: newOrder._id,
        orderReference: newOrder.orderReference,
        status: newOrder.status,
        referenceType: reference ? 'developer-provided' : 'system-generated'
      }
    });
    
    // Return the created order with stock info
    res.status(201).json({
      success: true,
      message: 'Order placed successfully and payment processed',
      data: {
        order: {
          id: newOrder._id,
          orderReference: newOrder.orderReference,
          recipientNumber: newOrder.recipientNumber,
          bundleType: newOrder.bundleType,
          capacity: newOrder.capacity,
          price: totalPrice,
          quantity: quantity,
          status: newOrder.status,
          createdAt: newOrder.createdAt,
          referenceType: reference ? 'developer-provided' : 'system-generated'
        },
        transaction: {
          id: transaction._id,
          reference: transaction.reference,
          amount: transaction.amount,
          status: transaction.status
        },
        walletBalance: user.wallet.balance,
        stockInfo: {
          reserved: quantity,
          remainingAvailable: bundle.stockUnits.available,
          isLowStock: bundle.stockStatus?.isLowStock || false
        }
      }
    });
    
  } catch (error) {
    // If an error occurs, abort the transaction
    await session.abortTransaction();
    console.error('Error placing order via API:', error);
    
    // Log API error
    try {
      await ApiLog.create({
        userId: req.user.id,
        apiKeyId: req.apiKeyId,
        endpoint: '/api/v1/orders/place',
        method: 'POST',
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        requestBody: req.body,
        responseStatus: 500,
        errorMessage: error.message
      });
    } catch (logError) {
      console.error('Failed to log API error:', logError);
    }
    
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  } finally {
    session.endSession();
  }
});

/**
 * @route   GET /api/v1/orders/reference/:orderRef
 * @desc    Get order details by order reference (including stock info)
 * @access  Private (API Key)
 */
router.get('/orders/reference/:orderRef', apiAuth, async (req, res) => {
  try {
    const orderReference = req.params.orderRef;
    
    // Validate order reference format (must be exactly 6 characters)
    if (!orderReference || orderReference.length !== 6) {
      return res.status(400).json({ 
        success: false, 
        message: 'Order reference must be exactly 6 characters long' 
      });
    }
    
    // Find the order by reference, ensuring it belongs to the authenticated user
    // Case-insensitive search since we store references in uppercase
    const order = await Order.findOne({
      orderReference: orderReference.toUpperCase(),
      user: req.user.id
    });

    if (!order) {
      // Log failed attempt
      await ApiLog.create({
        userId: req.user.id,
        apiKeyId: req.apiKeyId,
        endpoint: `/api/v1/orders/reference/${orderReference}`,
        method: 'GET',
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        responseStatus: 404,
        errorMessage: 'Order not found'
      });
      
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found or not authorized to access' 
      });
    }

    // Find related transaction for this order
    const transaction = await Transaction.findOne({
      orderId: order._id,
      user: req.user.id
    }).select('reference amount status metadata');

    // Log successful request
    await ApiLog.create({
      userId: req.user.id,
      apiKeyId: req.apiKeyId,
      endpoint: `/api/v1/orders/reference/${orderReference}`,
      method: 'GET',
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      responseStatus: 200,
      responseData: {
        orderId: order._id,
        status: order.status
      }
    });

    res.status(200).json({ 
      success: true, 
      data: {
        order: {
          id: order._id,
          orderReference: order.orderReference,
          recipientNumber: order.recipientNumber,
          bundleType: order.bundleType,
          capacity: order.capacity,
          price: order.price,
          quantity: order.metadata?.quantity || 1,
          status: order.status,
          createdAt: order.createdAt,
          completedAt: order.completedAt,
          failureReason: order.failureReason,
          stockInfo: order.metadata?.stockSnapshot || null,
          referenceType: order.metadata?.referenceProvidedByDeveloper ? 'developer-provided' : 'system-generated'
        },
        transaction: transaction ? {
          reference: transaction.reference,
          amount: transaction.amount,
          status: transaction.status,
          stockReserved: transaction.metadata?.stockReserved || null
        } : null
      }
    });
  } catch (error) {
    console.error('Error fetching order by reference:', error);
    
    // Log error
    try {
      await ApiLog.create({
        userId: req.user.id,
        apiKeyId: req.apiKeyId,
        endpoint: `/api/v1/orders/reference/${req.params.orderRef}`,
        method: 'GET',
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        responseStatus: 500,
        errorMessage: error.message
      });
    } catch (logError) {
      console.error('Failed to log API error:', logError);
    }
    
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
});

module.exports = router;