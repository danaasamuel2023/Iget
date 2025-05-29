// Updated User Schema with new admin roles
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// User Schema with enhanced role system
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
      'Editor',       // Editor role
      'credit_admin', // Can only credit user wallets
      'debit_admin'   // Can only debit user wallets
    ], 
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
      canDeleteUsers: { type: Boolean, default: false }
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
        canDeleteUsers: true
      };
      break;
    case 'credit_admin':
      this.adminMetadata.permissions = {
        canViewUsers: false,
        canViewTransactions: false,
        canCredit: true,
        canDebit: false,
        canChangeRoles: false,
        canDeleteUsers: false
      };
      break;
    case 'debit_admin':
      this.adminMetadata.permissions = {
        canViewUsers: false,
        canViewTransactions: false,
        canCredit: false,
        canDebit: true,
        canChangeRoles: false,
        canDeleteUsers: false
      };
      break;
    default:
      this.adminMetadata.permissions = {
        canViewUsers: false,
        canViewTransactions: false,
        canCredit: false,
        canDebit: false,
        canChangeRoles: false,
        canDeleteUsers: false
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
    'credit_admin': 'Can only credit user wallets and view own actions',
    'debit_admin': 'Can only debit user wallets and view own actions',
    'user': 'Regular user with standard features',
    'agent': 'Agent with extended user features',
    'Editor': 'Editor with content management features'
  };
  
  return descriptions[this.role] || 'Unknown role';
};

// Enhanced Transaction Schema to track admin actions better
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
      enum: ['admin', 'credit_admin', 'debit_admin', 'user', 'agent', 'Editor'] 
    },
    actionType: { 
      type: String, 
      enum: ['credit', 'debit', 'adjustment', 'reward'] 
    },
    actionTimestamp: { type: Date },
    ipAddress: String
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
    // Additional tracking for audit purposes
    auditTrail: {
      originalRequest: { type: Schema.Types.Mixed },
      validationPassed: { type: Boolean, default: true },
      authorizationLevel: String
    }
  },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Enhanced API Log Schema for admin action tracking
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
    sensitiveAction: { type: Boolean, default: false }
  },
  
  createdAt: { type: Date, default: Date.now }
});

// Create models
const UserModel = mongoose.model('IgetUser', userSchema);
const TransactionModel = mongoose.model('IgetTransaction', transactionSchema);
const ApiLogModel = mongoose.model('ApiLog', apiLogSchema);

// Export models
module.exports = {
  User: UserModel,
  Transaction: TransactionModel,
  ApiLog: ApiLogModel
};