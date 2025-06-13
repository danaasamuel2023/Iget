// routes/api.js - Updated with stock validation
const express = require('express');
const router = express.Router();
const { Order, User, Transaction, Bundle } = require('../schema/schema');
const apiAuth = require('../middlewareApi/ApiAuth');
const { ApiLog } = require('../schema/schema');
const mongoose = require('mongoose');
const AdminSettings = require('../AdminSettingSchema/AdminSettings.js');

/**
 * @route   POST /api/v1/orders/place
 * @desc    Place an order using API key auth
 * @access  Private (API Key)
 */
router.post('/orders/place', apiAuth, async (req, res) => {
  try {
    const { recipientNumber, capacity, bundleType } = req.body;
    
    // Validate required fields
    if (!recipientNumber || !capacity || !bundleType) {
      return res.status(400).json({
        success: false,
        message: 'Recipient number, capacity, and bundle type are all required'
      });
    }
    
    // Find the matching bundle to get the correct price
    const bundle = await Bundle.findOne({ 
      type: bundleType,
      capacity: capacity,
      isActive: true
    });
    
    if (!bundle) {
      return res.status(404).json({
        success: false,
        message: `No active bundle found matching type ${bundleType} with capacity ${capacity}MB`
      });
    }
    
    // CHECK STOCK STATUS - NEW VALIDATION
    if (bundle.stockStatus?.isOutOfStock || bundle.isInStock === false) {
      return res.status(400).json({
        success: false,
        message: `This bundle (${capacity}GB ${bundleType}) is currently out of stock`,
        stockInfo: {
          reason: bundle.stockStatus?.reason || 'No reason provided',
          markedOutAt: bundle.stockStatus?.markedOutOfStockAt
        }
      });
    }
    
    // Use the price from the bundle record
    const price = bundle.price;
    
    // Get user for wallet balance check
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Check if user has enough balance
    if (user.wallet.balance < price) {
      return res.status(400).json({
        success: false,
        message: `Insufficient balance in wallet. Required: ${price} ${user.wallet.currency}`
      });
    }
    
    // Get admin settings to check if API integrations are enabled
    const adminSettings = await AdminSettings.getSettings();
    
    // Start a session for the transaction
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      // Create new order with bundle details directly embedded
      const newOrder = new Order({
        user: req.user.id,
        bundleType: bundleType,
        capacity: capacity,
        price: price,
        recipientNumber: recipientNumber,
        status: 'pending',
        updatedAt: Date.now()
      });
      
      // Generate unique order reference for all order types
      const orderReference = Math.floor(1000 + Math.random() * 900000);
      newOrder.orderReference = orderReference.toString();
      
      // For mtnup2u bundle types, check if API is enabled before calling
      if (bundleType.toLowerCase() === 'mtnup2u') {
        // Check if MTN Hubnet API integration is enabled
        const mtnApiEnabled = adminSettings.apiIntegrations?.mtnHubnetEnabled !== false; // Default to true if setting doesn't exist
        
        if (mtnApiEnabled) {
          try {
            // Calculate volume in MB (in case the capacity is in GB)
            let volumeInMB = capacity;
            if (capacity < 100) { // Assuming small numbers represent GB
              volumeInMB = parseFloat(capacity) * 1000;
            }
            
            // Log the Hubnet API request for debugging
            console.log('Making Hubnet API request for mtnup2u bundle');
            console.log('Request payload:', {
              phone: recipientNumber,
              volume: volumeInMB,
              reference: orderReference,
              referrer: recipientNumber
            });
            
            // Make request to Hubnet API
            const hubnetResponse = await fetch(`https://console.hubnet.app/live/api/context/business/transaction/mtn-new-transaction`, {
              method: 'POST',
              headers: {
                'token': 'Bearer biWUr20SFfp8W33BRThwqTkg2PhoaZTkeWx',
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                phone: recipientNumber,
                volume: volumeInMB,
                reference: orderReference,
                referrer: '0598617011',
                webhook: ''
              })
            });
            
            const hubnetData = await hubnetResponse.json();
            
            console.log('Hubnet API Response:', hubnetData);
            
            if (!hubnetResponse.ok) {
              console.error('Hubnet order failed:', hubnetData);
              await session.abortTransaction();
              session.endSession();
              return res.status(400).json({
                success: false,
                message: 'Purchase failed. No payment has been processed.',
                error: hubnetData.message || 'Unknown error'
              });
            }
            
            // Update order with Hubnet reference
            newOrder.apiReference = orderReference.toString();
            newOrder.hubnetReference = orderReference.toString();
            
            // Set status to pending initially
            newOrder.status = 'pending';
            
            console.log(`Hubnet mtn order placed successfully: ${orderReference}`);
          } catch (apiError) {
            console.error('Error calling Hubnet API:', apiError.message);
            if (apiError.response) {
              console.error('Response status:', apiError.response.status);
              console.error('Response data:', apiError.response.data);
            }
            
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
              success: false,
              message: 'Connection error. No payment has been processed.',
              error: apiError.message,
              details: apiError.response?.data || 'Connection error'
            });
          }
        } else {
          // API is disabled, set order to pending for manual processing
          console.log('MTN Hubnet API integration is disabled. Order set to pending for manual processing.');
          newOrder.status = 'pending';
          newOrder.apiReference = null;
          newOrder.hubnetReference = null;
        }
      }
      // For AT-ishare bundle type, check if API is enabled before calling
      else if (bundleType.toLowerCase() === 'at-ishare') {
        // Check if AT Hubnet API integration is enabled
        const atApiEnabled = adminSettings.apiIntegrations?.atHubnetEnabled !== false; // Default to true if setting doesn't exist
        
        if (atApiEnabled) {
          try {
            // Calculate volume in MB (in case the capacity is in GB)
            let volumeInMB = capacity;
            if (capacity < 100) { // Assuming small numbers represent GB
              volumeInMB = parseFloat(capacity) * 1000;
            }
            
            // Log the Hubnet API request for debugging
            console.log('Making Hubnet API request for AT-ishare bundle');
            console.log('Request payload:', {
              phone: recipientNumber,
              volume: volumeInMB,
              reference: orderReference,
              referrer: recipientNumber
            });
            
            // Make request to Hubnet API
            const hubnetResponse = await fetch(`https://console.hubnet.app/live/api/context/business/transaction/at-new-transaction`, {
              method: 'POST',
              headers: {
                'token': 'Bearer biWUr20SFfp8W33BRThwqTkg2PhoaZTkeWx',
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                phone: recipientNumber,
                volume: volumeInMB,
                reference: orderReference,
                referrer: recipientNumber,
                webhook: ''
              })
            });
            
            const hubnetData = await hubnetResponse.json();
            
            console.log('Hubnet API Response:', hubnetData);
            
            if (!hubnetResponse.ok) {
              console.error('Hubnet order failed:', hubnetData);
              await session.abortTransaction();
              session.endSession();
              return res.status(400).json({
                success: false,
                message: 'Purchase failed. No payment has been processed.',
                error: hubnetData.message || 'Unknown error'
              });
            }
            
            // Update order with Hubnet reference
            newOrder.apiReference = orderReference.toString();
            newOrder.hubnetReference = orderReference.toString();
            
            // Set status to completed if API call was successful
            newOrder.status = 'completed';
            
            console.log(`Hubnet AT order placed successfully: ${orderReference}`);
          } catch (apiError) {
            console.error('Error calling Hubnet API:', apiError.message);
            if (apiError.response) {
              console.error('Response status:', apiError.response.status);
              console.error('Response data:', apiError.response.data);
            }
            
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
              success: false,
              message: 'Connection error. No payment has been processed.',
              error: apiError.message,
              details: apiError.response?.data || 'Connection error'
            });
          }
        } else {
          // API is disabled, set order to pending for manual processing
          console.log('AT Hubnet API integration is disabled. Order set to pending for manual processing.');
          newOrder.status = 'pending';
          newOrder.apiReference = null;
          newOrder.hubnetReference = null;
        }
      }
      // For other bundle types, continue with normal processing
      else {
        // Other bundle types don't use API, so they'll remain in pending status
        console.log(`Order for bundle type ${bundleType} set to pending for manual processing.`);
      }
      
      await newOrder.save({ session });
      
      // Create transaction record
      const transaction = new Transaction({
        user: req.user.id,
        type: 'purchase',
        amount: price,
        currency: user.wallet.currency,
        description: `API: Bundle purchase: ${capacity}GB for ${recipientNumber}`,
        status: 'completed',
        reference: 'API-TXN-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
        orderId: newOrder._id,
        balanceBefore: user.wallet.balance,
        balanceAfter: user.wallet.balance - price,
        paymentMethod: 'wallet'
      });
      
      await transaction.save({ session });
      
      // Update user's wallet balance
      user.wallet.balance -= price;
      user.wallet.transactions.push(transaction._id);
      await user.save({ session });
      
      // Commit the transaction
      await session.commitTransaction();
      session.endSession();
      
      // Return the created order
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
            price: price,
            status: newOrder.status,
            createdAt: newOrder.createdAt,
            // hubnetReference: newOrder.hubnetReference
          },
          transaction: {
            id: transaction._id,
            reference: transaction.reference,
            amount: transaction.amount,
            status: transaction.status
          },
          walletBalance: user.wallet.balance
        }
      });
      
    } catch (error) {
      // If an error occurs, abort the transaction
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
    
  } catch (error) {
    console.error('Error placing order via API:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/v1/orders/reference/:orderRef
 * @desc    Get order details by order reference
 * @access  Private (API Key)
 */
router.get('/orders/reference/:orderRef', apiAuth, async (req, res) => {
  try {
    const orderReference = req.params.orderRef;
    
    // Validate order reference format
    if (!orderReference) {
      return res.status(400).json({ 
        success: false, 
        message: 'Order reference is required' 
      });
    }
    
    // Find the order by reference, ensuring it belongs to the authenticated user
    const order = await Order.findOne({
      orderReference: orderReference,
      user: req.user.id
    });

    if (!order) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found or not authorized to access' 
      });
    }

    // Find related transaction for this order
    const transaction = await Transaction.findOne({
      orderId: order._id,
      user: req.user.id
    }).select('reference amount status');

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
          status: order.status,
          createdAt: order.createdAt,
          completedAt: order.completedAt,
          failureReason: order.failureReason
        },
        transaction: transaction ? {
          reference: transaction.reference,
          amount: transaction.amount,
          status: transaction.status
        } : null
      }
    });
  } catch (error) {
    console.error('Error fetching order by reference:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
});

module.exports = router;