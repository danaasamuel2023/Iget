// MongoDB Schema for Bundle Selling Syste
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// User Schema
const userSchema = new Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  phone: { type: String, required: true }, // Added phone field
  role: { 
    type: String, 
    enum: ['admin', 'user', 'agent','Editor'], 
    default: 'user' 
  },
  apiKey: { type: String, unique: true },
  wallet: {
    balance: { type: Number, default: 0 },
    currency: { type: String, default: 'GHS' },
    transactions: [{
      type: Schema.Types.ObjectId,
      ref: 'Transaction'
    }]
  },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// API Key generation method
userSchema.methods.generateApiKey = function() {
  const apiKey = require('crypto').randomBytes(32).toString('hex');
  this.apiKey = apiKey;
  return apiKey;
};

// Bundle Schema - Simplified as requested
const bundleSchema = new Schema({
//   name: { type: String, required: true },
  capacity: { type: Number, required: true }, // Data capacity in MB
  price: { type: Number, required: true },
  type: { 
    type: String, 
    enum: ['mtnup2u', 'mtn-fibre', 'mtn-justforu', 'AT-ishare', 'Telecel-5959', 'AfA-registration', 'other'],
    required: true
  },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Order Schema
const orderSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'IgetUser',
    required: true
  },
  // Remove bundle reference and add direct bundle properties
  bundleType: { 
    type: String, 
    enum: ['mtnup2u', 'mtn-fibre', 'mtn-justforu', 'AT-ishare', 'Telecel-5959', 'AfA-registration', 'other'],
    required: true
  },
  capacity: { type: Number, required: true }, // Data capacity in MB
  price: { type: Number, required: true },
  recipientNumber: { type: String, required: true },
  orderReference: { type: String, unique: true },
  status: { 
    type: String, 
    enum: ['pending', 'processing', 'completed', 'failed', 'refunded'],
    default: 'pending'
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});
// Generate order reference before saving
orderSchema.pre('save', function(next) {
  if (!this.orderReference) {
    this.orderReference = 'ORD-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
  }
  next();
});



// Transaction Schema
const transactionSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'IgetUser',
    required: true
  },
  type: { 
    type: String, 
    enum: ['deposit', 'withdrawal', 'purchase', 'refund', 'adjustment'],
    required: true
  },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'ZAR' },
  description: { type: String },
  status: { 
    type: String, 
    enum: ['pending', 'completed', 'failed'],
    default: 'pending'
  },
  reference: { type: String, unique: true },
  orderId: {
    type: Schema.Types.ObjectId,
    ref: 'Order'
  },
  balanceBefore: { type: Number },
  balanceAfter: { type: Number },
  processedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  paymentMethod: { type: String },
  paymentDetails: { type: Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// API Request Log Schema
const apiLogSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  apiKey: { type: String },
  endpoint: { type: String },
  method: { type: String },
  requestData: { type: Schema.Types.Mixed },
  responseData: { type: Schema.Types.Mixed },
  ipAddress: { type: String },
  status: { type: Number }, // HTTP status code
  executionTime: { type: Number }, // in milliseconds
  createdAt: { type: Date, default: Date.now }
});

// System Settings Schema
const settingsSchema = new Schema({
  name: { type: String, required: true, unique: true },
  value: { type: Schema.Types.Mixed, required: true },
  description: { type: String },
  updatedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Create models
const User = mongoose.model('IgetUser', userSchema);
const Bundle = mongoose.model('Bundle', bundleSchema);
const Order = mongoose.model('IgetOrder', orderSchema);
const Transaction = mongoose.model('IgetTransaction', transactionSchema);
const ApiLog = mongoose.model('ApiLog', apiLogSchema);
const Settings = mongoose.model('Settings', settingsSchema);

module.exports = {
  User,
  Bundle,
  Order,
  Transaction,
  ApiLog,
  Settings
};