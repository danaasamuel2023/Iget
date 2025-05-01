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
  capacity: { type: Number, required: true }, // Data capacity in MB
  // Base price
  price: { type: Number, required: true },
  // Role-specific pricing
  rolePricing: {
    admin: { type: Number },
    user: { type: Number },
    agent: { type: Number },
    Editor: { type: Number }
  },
  type: { 
    type: String, 
    enum: ['mtnup2u', 'mtn-fibre', 'mtn-justforu', 'AT-ishare', 'Telecel-5959', 'AfA-registration', 'other'],
    required: true
  },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Add a method to get price based on user role
bundleSchema.methods.getPriceForRole = function(role) {
  // If role-specific price exists, return it, otherwise return the base price
  return (this.rolePricing && this.rolePricing[role]) || this.price;
};
// Order Schema
const orderSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'IgetUser',
    required: true
  },
  bundleType: { 
    type: String, 
    enum: ['mtnup2u', 'mtn-fibre', 'mtn-justforu', 'AT-ishare', 'Telecel-5959', 'AfA-registration', 'other'],
    required: true
  },
  capacity: { type: Number, required: true }, // Data capacity in MB
  price: { type: Number, required: true },
  recipientNumber: { type: String, required: true },
  orderReference: { type: String, unique: true },
  
  // Added API-specific fields
  apiReference: { type: String }, // To store the API reference number
  apiOrderId: { type: String },   // To store the API order ID
  
  status: { 
    type: String, 
    enum: ['initiated', 'pending', 'processing', 'completed', 'failed', 'refunded', 'api_error'],
    default: 'pending'
  },
  // Metadata field to store AFA-specific registration data
  metadata: {
    type: Schema.Types.Mixed,
    default: {}
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  completedAt: { type: Date },
  failureReason: { type: String }
});

// Generate order reference before saving
orderSchema.pre('save', function(next) {
  if (!this.orderReference) {
    // For API orders, check if we have an apiReference to use
    if (this.apiReference) {
      this.orderReference = this.apiReference;
    } else {
      // Create different prefixes for different bundle types
      const prefix = this.bundleType === 'AfA-registration' ? 'AFA-' : 'ORD-';
      this.orderReference = Math.floor(1000 + Math.random() * 900000);
    }
  }
  
  // Update timestamps
  if (this.isModified('status')) {
    this.updatedAt = new Date();
    
    // Only set completedAt if status is specifically changed to 'completed'
    if (this.status === 'completed' && !this.completedAt) {
      this.completedAt = new Date();
    }
  }
  
  next();
});


// Transaction Schema enhanced with metadata field
const transactionSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'IgetUser',
    required: true
  },
  type: { 
    type: String, 
    enum: ['deposit', 'withdrawal', 'purchase', 'refund', 'adjustment', 'debit', 'credit'],
    required: true
  },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'GHS' },
  description: { type: String, required: true },
  status: { 
    type: String, 
    enum: ['pending', 'completed', 'failed','api_error'],
    default: 'pending'
  },
  reference: { type: String, unique: true },
  orderId: {
    type: Schema.Types.ObjectId,
    ref: 'IgetOrder'
  },
  balanceBefore: { type: Number },
  balanceAfter: { type: Number },
  processedBy: {
    type: Schema.Types.ObjectId,
    ref: 'IgetUser'
  },
  processedByInfo: {
    username: String,
    email: String
  },
  paymentMethod: { type: String },
  paymentDetails: { type: Schema.Types.Mixed },
  // Added metadata field for AFA-specific transaction data
  metadata: {
    type: Schema.Types.Mixed,
    default: {}
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});



// Transaction Schema


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
    ref: 'IgetUser'
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Create models
const UserModel = mongoose.model('IgetUser', userSchema);
const BundleModel = mongoose.model('Bundle', bundleSchema);
const OrderModel = mongoose.model('IgetOrder', orderSchema);
const TransactionModel = mongoose.model('IgetTransaction', transactionSchema);

// Then export with the names your routes expect
module.exports = {
  User: UserModel,
  Bundle: BundleModel,
  Order: OrderModel,
  Transaction: TransactionModel,
 
};
