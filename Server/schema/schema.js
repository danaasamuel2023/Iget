// Complete MongoDB Schema for Bundle Selling System with Editor functionality
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Enhanced User Schema with unified admin roles
const userSchema = new Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  phone: { type: String, required: true },
  role: { 
    type: String, 
    enum: [
      'admin',        // Full admin - can do everything
      'user',         // Regular user
      'agent',        // Agent role
      'Editor',       // Editor role - can update order statuses
      'wallet_admin'  // Unified wallet admin - can both credit and debit user wallets
    ], 
    default: 'user' 
  },
  apiKey: { type: String, unique: true },
  wallet: {
    balance: { type: Number, default: 0 },
    currency: { type: String, default: 'GHS' },
    transactions: [{
      type: Schema.Types.ObjectId,
      ref: 'IgetTransaction'
    }]
  },
  isActive: { type: Boolean, default: true },
  
  // Admin-specific fields for tracking
  adminMetadata: {
    createdBy: { 
      type: Schema.Types.ObjectId, 
      ref: 'IgetUser' 
    },
    roleChangedBy: { 
      type: Schema.Types.ObjectId, 
      ref: 'IgetUser' 
    },
    roleChangedAt: { type: Date },
    lastLoginAt: { type: Date },
    permissions: {
      canViewUsers: { type: Boolean, default: false },
      canViewTransactions: { type: Boolean, default: false },
      canCredit: { type: Boolean, default: false },
      canDebit: { type: Boolean, default: false },
      canChangeRoles: { type: Boolean, default: false },
      canDeleteUsers: { type: Boolean, default: false },
      canUpdateOrderStatus: { type: Boolean, default: false }
    }
  },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Method to update permissions based on role
userSchema.methods.updatePermissions = function() {
  switch(this.role) {
    case 'admin':
      this.adminMetadata.permissions = {
        canViewUsers: true,
        canViewTransactions: true,
        canCredit: true,
        canDebit: true,
        canChangeRoles: true,
        canDeleteUsers: true,
        canUpdateOrderStatus: true
      };
      break;
    case 'wallet_admin':
      this.adminMetadata.permissions = {
        canViewUsers: true,
        canViewTransactions: false,
        canCredit: true,
        canDebit: true,
        canChangeRoles: false,
        canDeleteUsers: false,
        canUpdateOrderStatus: false
      };
      break;
    case 'Editor':
      this.adminMetadata.permissions = {
        canViewUsers: true,
        canViewTransactions: false,
        canCredit: false,
        canDebit: false,
        canChangeRoles: false,
        canDeleteUsers: false,
        canUpdateOrderStatus: true
      };
      break;
    default:
      this.adminMetadata.permissions = {
        canViewUsers: false,
        canViewTransactions: false,
        canCredit: false,
        canDebit: false,
        canChangeRoles: false,
        canDeleteUsers: false,
        canUpdateOrderStatus: false
      };
  }
};

// Pre-save middleware to update permissions
userSchema.pre('save', function(next) {
  if (this.isModified('role')) {
    this.updatePermissions();
    this.adminMetadata.roleChangedAt = new Date();
  }
  
  this.updatedAt = new Date();
  next();
});

// API Key generation method
userSchema.methods.generateApiKey = function() {
  const apiKey = require('crypto').randomBytes(32).toString('hex');
  this.apiKey = apiKey;
  return apiKey;
};

// Method to check if user has specific permission
userSchema.methods.hasPermission = function(permission) {
  if (!this.adminMetadata || !this.adminMetadata.permissions) {
    return false;
  }
  return this.adminMetadata.permissions[permission] || false;
};

// Method to get role description
userSchema.methods.getRoleDescription = function() {
  const descriptions = {
    'admin': 'Full administrative access to all features',
    'wallet_admin': 'Can view users and perform both credit and debit wallet operations',
    'Editor': 'Can view users and update order statuses',
    'user': 'Regular user with standard features',
    'agent': 'Agent with extended user features'
  };
  
  return descriptions[this.role] || 'Unknown role';
};

// Method to check if user can perform wallet operations
userSchema.methods.canPerformWalletOperations = function() {
  return ['admin', 'wallet_admin'].includes(this.role);
};

// Method to check if user can update order statuses
userSchema.methods.canUpdateOrderStatus = function() {
  return ['admin', 'Editor'].includes(this.role);
};

// Bundle Schema with role-based pricing and stock management
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
  
  // Stock management fields
  isInStock: { type: Boolean, default: true }, // Whether this bundle is in stock
  stockStatus: {
    isOutOfStock: { type: Boolean, default: false },
    reason: { type: String }, // Reason for being out of stock
    markedOutOfStockBy: { type: Schema.Types.ObjectId, ref: 'IgetUser' },
    markedOutOfStockAt: { type: Date },
    markedInStockBy: { type: Schema.Types.ObjectId, ref: 'IgetUser' },
    markedInStockAt: { type: Date }
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

// Add method to check if bundle is available for purchase
bundleSchema.methods.isAvailableForPurchase = function() {
  return this.isActive && this.isInStock && !this.stockStatus.isOutOfStock;
};

// Enhanced Order Schema with Editor support
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
  
  // API-specific fields for external integrations
  apiReference: { type: String }, // To store the API reference number
  apiOrderId: { type: String },   // To store the API order ID
  hubnetReference: { type: String }, // For Hubnet API references
  
  status: { 
    type: String, 
    enum: ['initiated', 'pending', 'processing', 'completed', 'failed', 'refunded', 'api_error'],
    default: 'pending'
  },
  
  // Editor tracking fields
  processedBy: {
    type: Schema.Types.ObjectId,
    ref: 'IgetUser'
  },
  
  // Enhanced editor tracking information
  editorInfo: {
    editorId: { type: Schema.Types.ObjectId, ref: 'IgetUser' },
    editorUsername: String,
    editorRole: String,
    previousStatus: String,
    newStatus: String,
    statusChangedAt: Date,
    ipAddress: String,
    userAgent: String,
    failureReason: String
  },
  
  // Metadata field to store bundle-specific data
  metadata: {
    type: Schema.Types.Mixed,
    default: {}
  },
  
  // Failure reason for failed orders
  failureReason: { type: String },
  
  // Timestamps
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  completedAt: { type: Date }
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
      this.orderReference = prefix + Math.floor(1000 + Math.random() * 900000);
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

// Enhanced Transaction Schema with unified admin tracking
const transactionSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'IgetUser',
    required: true
  },
  type: { 
    type: String, 
    enum: ['deposit', 'withdrawal', 'purchase', 'refund', 'adjustment', 'debit', 'credit', 'reward'],
    required: true
  },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'GHS' },
  description: { type: String, required: true },
  status: { 
    type: String, 
    enum: ['pending', 'completed', 'failed','api_error','reward'],
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
    adminId: { type: Schema.Types.ObjectId },
    username: String,
    email: String,
    role: { 
      type: String, 
      enum: ['admin', 'wallet_admin', 'Editor', 'user', 'agent'] 
    },
    actionType: { 
      type: String, 
      enum: ['credit', 'debit', 'adjustment', 'reward'] 
    },
    actionTimestamp: { type: Date },
    ipAddress: String,
    isUnifiedWalletAdmin: { type: Boolean, default: false }
  },
  paymentMethod: { type: String },
  paymentDetails: { type: Schema.Types.Mixed },
  
  // Enhanced metadata for better admin tracking
  metadata: {
    adminAction: String,
    performedBy: { type: Schema.Types.ObjectId },
    performedByRole: String,
    performedAt: { type: Date },
    clientIp: String,
    userAgent: String,
    unifiedWalletOperation: { type: Boolean, default: false },
    auditTrail: {
      originalRequest: { type: Schema.Types.Mixed },
      validationPassed: { type: Boolean, default: true },
      authorizationLevel: String,
      walletAdminConsistency: { type: Boolean, default: true }
    }
  },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// API Request Log Schema for comprehensive tracking
const apiLogSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'IgetUser'
  },
  apiKey: { type: String },
  endpoint: { type: String },
  method: { type: String },
  requestData: { type: Schema.Types.Mixed },
  responseData: { type: Schema.Types.Mixed },
  ipAddress: { type: String },
  userAgent: { type: String },
  status: { type: Number }, // HTTP status code
  executionTime: { type: Number }, // in milliseconds
  
  // Enhanced admin tracking
  adminMetadata: {
    adminRole: String,
    targetUserId: { type: Schema.Types.ObjectId },
    actionType: String,
    actionDescription: String,
    affectedRecords: Number,
    sensitiveAction: { type: Boolean, default: false },
    isUnifiedWalletAdmin: { type: Boolean, default: false },
    isEditor: { type: Boolean, default: false },
    operationConsistency: { type: Boolean, default: true }
  },
  
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

// Create models with consistent naming
const UserModel = mongoose.model('IgetUser', userSchema);
const BundleModel = mongoose.model('Bundle', bundleSchema);
const OrderModel = mongoose.model('IgetOrder', orderSchema);
const TransactionModel = mongoose.model('IgetTransaction', transactionSchema);
const ApiLogModel = mongoose.model('ApiLog', apiLogSchema);
const SettingsModel = mongoose.model('Settings', settingsSchema);

// Export all models with the names expected by your routes
module.exports = {
  User: UserModel,
  Bundle: BundleModel,
  Order: OrderModel,
  Transaction: TransactionModel,
  ApiLog: ApiLogModel,
  Settings: SettingsModel
};