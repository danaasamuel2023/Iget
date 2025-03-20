const express = require('express');
const router = express.Router();
const { Order, Bundle, User, Transaction } = require('../schema/schema');
const authMiddleware = require('../AuthMiddle/middlewareauth');
// Place a new order (authenticated users)
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { bundleId, quantity, recipientNumber } = req.body;
    
    if (!bundleId || !recipientNumber) {
      return res.status(400).json({ success: false, message: 'Bundle ID and recipient number are required' });
    }
    
    const bundle = await Bundle.findById(bundleId);
    
    if (!bundle || !bundle.isActive) {
      return res.status(404).json({ success: false, message: 'Bundle not found or inactive' });
    }
    
    const user = await User.findById(req.user.id);
    const totalAmount = bundle.price * (quantity || 1);
    
    // Check if user has enough balance
    if (user.wallet.balance < totalAmount) {
      return res.status(400).json({ 
        success: false, 
        message: 'Insufficient wallet balance',
        required: totalAmount,
        available: user.wallet.balance
      });
    }
    
    // Create the order
    const order = new Order({
      user: req.user.id,
      bundle: bundleId,
      quantity: quantity || 1,
      totalAmount,
      recipientNumber,
      status: 'pending'
    });
    
    await order.save();
    
    // Create transaction and update wallet balance
    const transaction = new Transaction({
      user: req.user.id,
      type: 'purchase',
      amount: -totalAmount,
      description: `Purchase of ${bundle.name} for ${recipientNumber}`,
      status: 'completed',
      reference: `TXN-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      orderId: order._id,
      balanceBefore: user.wallet.balance,
      balanceAfter: user.wallet.balance - totalAmount
    });
    
    await transaction.save();
    
    // Update user wallet
    user.wallet.balance -= totalAmount;
    user.wallet.transactions.push(transaction._id);
    await user.save();
    
    // Update order with transaction ID
    order.transactionId = transaction.reference;
    order.status = 'processing';
    await order.save();
    
    res.status(201).json({ 
      success: true, 
      data: order,
      transaction: {
        reference: transaction.reference,
        balanceAfter: transaction.balanceAfter
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// API endpoint for placing an order (requires API key)
router.post('/developer/place-order', async (req, res) => {
  try {
    const { bundleId, quantity, recipientNumber } = req.body;
    
    if (!bundleId || !recipientNumber) {
      return res.status(400).json({ success: false, message: 'Network and recipient number are required' });
    }
    
    const bundle = await Bundle.findById(bundleId);
    
    if (!bundle || !bundle.isActive) {
      return res.status(404).json({ success: false, message: 'Bundle not found or inactive' });
    }
    
    const user = req.user; // From apiAuthMiddleware
    const totalAmount = bundle.price * (quantity || 1);
    
    // Check if user has enough balance
    if (user.wallet.balance < totalAmount) {
      return res.status(400).json({ 
        success: false, 
        message: 'Insufficient wallet balance',
        required: totalAmount,
        available: user.wallet.balance
      });
    }
    
    // Create the order
    const order = new Order({
      user: user._id,
      bundle: bundleId,
      quantity: quantity || 1,
      totalAmount,
      recipientNumber,
      status: 'pending'
    });
    
    await order.save();
    
    // Create transaction and update wallet balance
    const transaction = new Transaction({
      user: user._id,
      type: 'purchase',
      amount: -totalAmount,
      description: `API Purchase of ${bundle.name} for ${recipientNumber}`,
      status: 'completed',
      reference: `TXN-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      orderId: order._id,
      balanceBefore: user.wallet.balance,
      balanceAfter: user.wallet.balance - totalAmount
    });
    
    await transaction.save();
    
    // Update user wallet
    user.wallet.balance -= totalAmount;
    user.wallet.transactions.push(transaction._id);
    await user.save();
    
    // Update order with transaction ID
    order.transactionId = transaction.reference;
    order.status = 'processing';
    await order.save();
    
    res.status(201).json({ 
      success: true, 
      data: {
        orderReference: order.orderReference,
        status: order.status,
        transactionReference: transaction.reference,
        balanceAfter: transaction.balanceAfter
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get all orders for the authenticated user
router.get('/', authMiddleware, async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user.id })
      .populate('bundle')
      .sort({ createdAt: -1 });
    
    res.status(200).json({ success: true, count: orders.length, data: orders });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get a single order
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('bundle')
      .populate('user', 'username email');
    
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    
    // Ensure users can only see their own orders unless they're admins
    if (order.user._id.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized to access this order' });
    }
    
    res.status(200).json({ success: true, data: order });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;