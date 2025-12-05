// Complete MongoDB Schema for Bundle Selling System with Editor functionality
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Enhanced User Schema with Admin Approval System
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
      'wallet_admin', // Unified wallet admin - can both credit and debit user wallets
      'Business',
      'Dealers',
      'Enterprise'
    ], 
    default: 'user' 
  },
  
  // Approval system fields
  approvalStatus: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  
  approvalInfo: {
    approvedBy: { 
      type: Schema.Types.ObjectId, 
      ref: 'IgetUser' 
    },
    approvedAt: { type: Date },
    rejectedBy: { 
      type: Schema.Types.ObjectId, 
      ref: 'IgetUser' 
    },
    rejectedAt: { type: Date },
    rejectionReason: { type: String },
    approvalNotes: { type: String },
    approvalRequestedAt: { type: Date, default: Date.now }
  },
  
  // FIX: Added sparse: true to allow multiple null values while maintaining uniqueness for actual keys
  apiKey: { type: String, unique: true, sparse: true },
  
  wallet: {
    balance: { type: Number, default: 0 },
    currency: { type: String, default: 'GHS' },
    transactions: [{
      type: Schema.Types.ObjectId,
      ref: 'IgetTransaction'
    }]
  },
  
  // Modified: isActive now depends on approval status
  isActive: { type: Boolean, default: false }, // Default to false until approved
  
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
      canUpdateOrderStatus: { type: Boolean, default: false },
      canApproveUsers: { type: Boolean, default: false }
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
        canUpdateOrderStatus: true,
        canApproveUsers: true
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
        canUpdateOrderStatus: false,
        canApproveUsers: false
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
        canUpdateOrderStatus: true,
        canApproveUsers: false
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
        canUpdateOrderStatus: false,
        canApproveUsers: false
      };
  }
};

// Method to check if user is approved and can use the app
userSchema.methods.canUseApp = function() {
  return this.approvalStatus === 'approved' && this.isActive;
};

// Method to approve user
userSchema.methods.approveUser = function(adminId, notes = '') {
  this.approvalStatus = 'approved';
  this.isActive = true;
  this.approvalInfo.approvedBy = adminId;
  this.approvalInfo.approvedAt = new Date();
  this.approvalInfo.approvalNotes = notes;
  this.updatedAt = new Date();
};

// Method to reject user
userSchema.methods.rejectUser = function(adminId, reason = '') {
  this.approvalStatus = 'rejected';
  this.isActive = false;
  this.approvalInfo.rejectedBy = adminId;
  this.approvalInfo.rejectedAt = new Date();
  this.approvalInfo.rejectionReason = reason;
  this.updatedAt = new Date();
};

// Method to get approval status description
userSchema.methods.getApprovalStatusDescription = function() {
  const descriptions = {
    'pending': 'Account pending admin approval',
    'approved': 'Account approved and active',
    'rejected': 'Account rejected by admin'
  };
  
  return descriptions[this.approvalStatus] || 'Unknown approval status';
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
    'admin': 'Full administrative access to all features including user approval',
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

// Method to check if user can approve other users
userSchema.methods.canApproveUsers = function() {
  return this.role === 'admin';
};

// Static method to get pending approval users
userSchema.statics.getPendingApprovalUsers = function() {
  return this.find({
    approvalStatus: 'pending'
  }).sort({ 'approvalInfo.approvalRequestedAt': 1 });
};

// Static method to get approved users
userSchema.statics.getApprovedUsers = function() {
  return this.find({
    approvalStatus: 'approved'
  }).sort({ 'approvalInfo.approvedAt': -1 });
};

// Static method to get rejected users
userSchema.statics.getRejectedUsers = function() {
  return this.find({
    approvalStatus: 'rejected'
  }).sort({ 'approvalInfo.rejectedAt': -1 });
};


// Bundle Schema with role-based pricing and stock management
const bundleSchema = new Schema({
  capacity: { type: Number, required: true },
  price: { type: Number, required: true },
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
  
  // Unit-based stock management fields
  stockUnits: {
    available: { type: Number, default: 0, min: 0 },
    initial: { type: Number, default: 0, min: 0 },
    reserved: { type: Number, default: 0, min: 0 },
    sold: { type: Number, default: 0, min: 0 },
    lowStockThreshold: { type: Number, default: 10, min: 0 },
    restockHistory: [{
      previousUnits: { type: Number },
      addedUnits: { type: Number },
      newTotal: { type: Number },
      restockedBy: { type: Schema.Types.ObjectId, ref: 'IgetUser' },
      restockedAt: { type: Date, default: Date.now },
      reason: { type: String }
    }],
    lastUpdatedBy: { type: Schema.Types.ObjectId, ref: 'IgetUser' },
    lastUpdatedAt: { type: Date }
  },
  
  isInStock: { type: Boolean, default: true },
  stockStatus: {
    isOutOfStock: { type: Boolean, default: false },
    isLowStock: { type: Boolean, default: false },
    reason: { type: String },
    markedOutOfStockBy: { type: Schema.Types.ObjectId, ref: 'IgetUser' },
    markedOutOfStockAt: { type: Date },
    markedInStockBy: { type: Schema.Types.ObjectId, ref: 'IgetUser' },
    markedInStockAt: { type: Date },
    autoOutOfStock: { type: Boolean, default: false }
  },
  
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Add indexes for better query performance
bundleSchema.index({ type: 1, capacity: 1 });
bundleSchema.index({ 'stockUnits.available': 1 });
bundleSchema.index({ 'stockStatus.isOutOfStock': 1 });
bundleSchema.index({ 'stockStatus.isLowStock': 1 });

// Virtual property to calculate stock percentage
bundleSchema.virtual('stockPercentage').get(function() {
  if (!this.stockUnits.initial || this.stockUnits.initial === 0) {
    return 0;
  }
  return Math.round((this.stockUnits.available / this.stockUnits.initial) * 100);
});

// Virtual property to check if stock is critically low
bundleSchema.virtual('isCriticallyLow').get(function() {
  return this.stockPercentage > 0 && this.stockPercentage < 20;
});

// Method to get price based on user role
bundleSchema.methods.getPriceForRole = function(role) {
  return (this.rolePricing && this.rolePricing[role]) || this.price;
};

// Method to check if bundle is available for purchase
bundleSchema.methods.isAvailableForPurchase = function(quantity = 1) {
  return this.isActive && 
         this.isInStock && 
         !this.stockStatus.isOutOfStock && 
         this.stockUnits.available >= quantity;
};

// Method to check if bundle has sufficient stock
bundleSchema.methods.hasSufficientStock = function(quantity = 1) {
  return this.stockUnits.available >= quantity;
};

// Method to reserve stock for pending orders
bundleSchema.methods.reserveStock = async function(quantity = 1, session) {
  if (this.stockUnits.available < quantity) {
    throw new Error(`Insufficient stock. Available: ${this.stockUnits.available}, Requested: ${quantity}`);
  }
  
  this.stockUnits.available -= quantity;
  this.stockUnits.reserved += quantity;
  
  await this.updateStockStatus();
  
  if (session) {
    return this.save({ session });
  }
  return this.save();
};

// Method to confirm stock reservation (when order is completed)
bundleSchema.methods.confirmReservation = async function(quantity = 1, session) {
  if (this.stockUnits.reserved < quantity) {
    throw new Error(`Invalid reservation. Reserved: ${this.stockUnits.reserved}, Confirming: ${quantity}`);
  }
  
  this.stockUnits.reserved -= quantity;
  this.stockUnits.sold += quantity;
  
  if (session) { 
    return this.save({ session });
  }
  return this.save();
};

// Method to release reserved stock (when order fails/cancelled)
bundleSchema.methods.releaseReservation = async function(quantity = 1, session) {
  this.stockUnits.available += quantity;
  this.stockUnits.reserved = Math.max(0, this.stockUnits.reserved - quantity);
  
  await this.updateStockStatus();
  
  if (session) {
    return this.save({ session });
  }
  return this.save();
};

// Method to update stock status based on available units
bundleSchema.methods.updateStockStatus = async function() {
  const previousOutOfStock = this.stockStatus.isOutOfStock;
  
  if (this.stockUnits.available === 0) {
    this.isInStock = false;
    this.stockStatus.isOutOfStock = true;
    this.stockStatus.autoOutOfStock = true;
    if (!previousOutOfStock) {
      this.stockStatus.markedOutOfStockAt = new Date();
      this.stockStatus.reason = 'Automatically marked out of stock - no units available';
    }
  } else {
    this.isInStock = true;
    this.stockStatus.isOutOfStock = false;
    this.stockStatus.autoOutOfStock = false;
    if (previousOutOfStock) {
      this.stockStatus.markedInStockAt = new Date();
    }
  }
  
  this.stockStatus.isLowStock = this.stockUnits.available > 0 && 
                                this.stockUnits.available <= this.stockUnits.lowStockThreshold;
};

// Method to restock bundle
bundleSchema.methods.restock = async function(units, userId, reason, session) {
  if (units <= 0) {
    throw new Error('Restock units must be greater than 0');
  }
  
  const previousUnits = this.stockUnits.available;
  
  this.stockUnits.restockHistory.push({
    previousUnits: previousUnits,
    addedUnits: units,
    newTotal: previousUnits + units,
    restockedBy: userId,
    restockedAt: new Date(),
    reason: reason || 'Manual restock'
  });
  
  this.stockUnits.available += units;
  this.stockUnits.initial = Math.max(this.stockUnits.initial, this.stockUnits.available);
  this.stockUnits.lastUpdatedBy = userId;
  this.stockUnits.lastUpdatedAt = new Date();
  
  await this.updateStockStatus();
  
  if (previousUnits === 0 && this.stockUnits.available > 0) {
    this.stockStatus.markedInStockBy = userId;
    this.stockStatus.markedInStockAt = new Date();
  }
  
  this.updatedAt = new Date();
  
  if (session) {
    return this.save({ session });
  }
  return this.save();
};

// Method to adjust stock (can be positive or negative)
bundleSchema.methods.adjustStock = async function(adjustment, userId, reason, session) {
  const newAvailable = this.stockUnits.available + adjustment;
  
  if (newAvailable < 0) {
    throw new Error(`Cannot reduce stock below 0. Current: ${this.stockUnits.available}, Adjustment: ${adjustment}`);
  }
  
  if (adjustment > 0) {
    return this.restock(adjustment, userId, reason, session);
  }
  
  this.stockUnits.available = newAvailable;
  this.stockUnits.lastUpdatedBy = userId;
  this.stockUnits.lastUpdatedAt = new Date();
  
  if (adjustment < 0) {
    this.stockUnits.restockHistory.push({
      previousUnits: this.stockUnits.available - adjustment,
      addedUnits: adjustment,
      newTotal: this.stockUnits.available,
      restockedBy: userId,
      restockedAt: new Date(),
      reason: reason || 'Stock adjustment'
    });
  }
  
  await this.updateStockStatus();
  
  this.updatedAt = new Date();
  
  if (session) {
    return this.save({ session });
  }
  return this.save();
};

// Pre-save middleware
bundleSchema.pre('save', async function(next) {
  if (this.isModified('stockUnits.available')) {
    await this.updateStockStatus();
  }
  
  this.updatedAt = new Date();
  next();
});

// Static method to get low stock bundles
bundleSchema.statics.getLowStockBundles = function() {
  return this.find({
    isActive: true,
    'stockStatus.isLowStock': true
  }).sort({ 'stockUnits.available': 1 });
};

// Static method to get out of stock bundles
bundleSchema.statics.getOutOfStockBundles = function() {
  return this.find({
    isActive: true,
    'stockStatus.isOutOfStock': true
  }).sort({ 'stockStatus.markedOutOfStockAt': -1 });
};

// Add toJSON to include virtuals
bundleSchema.set('toJSON', { virtuals: true });
bundleSchema.set('toObject', { virtuals: true });


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
  capacity: { type: Number, required: true },
  price: { type: Number, required: true },
  recipientNumber: { type: String, required: true },
  orderReference: { type: String, unique: true, sparse: true },
  
  // API-specific fields for external integrations
  apiReference: { type: String, sparse: true },
  apiOrderId: { type: String, sparse: true },
  hubnetReference: { type: String, sparse: true },
  
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
    if (this.apiReference) {
      this.orderReference = this.apiReference;
    } else {
      const prefix = this.bundleType === 'AfA-registration' ? 'AFA-' : 'ORD-';
      this.orderReference = prefix + Math.floor(1000 + Math.random() * 900000);
    }
  }
  
  if (this.isModified('status')) {
    this.updatedAt = new Date();
    
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
    enum: ['pending', 'completed', 'failed', 'api_error', 'reward'],
    default: 'pending'
  },
  reference: { type: String, unique: true, sparse: true },
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
  status: { type: Number },
  executionTime: { type: Number },
  
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

// Auto-sync indexes on startup to fix duplicate key errors
const syncIndexes = async () => {
  try {
    // Drop old non-sparse apiKey index if it exists
    try {
      await mongoose.connection.collection('igetusers').dropIndex('apiKey_1');
      console.log('Dropped old apiKey index');
    } catch (err) {
      // Index doesn't exist or already dropped - ignore
    }
    
    // Sync all model indexes
    await UserModel.syncIndexes();
    await OrderModel.syncIndexes();
    await TransactionModel.syncIndexes();
    
    console.log('All indexes synced successfully');
  } catch (err) {
    console.log('Index sync error:', err.message);
  }
};

// Run sync when MongoDB connection is open
mongoose.connection.once('open', syncIndexes);

// Export all models
module.exports = {
  User: UserModel,
  Bundle: BundleModel,
  Order: OrderModel,
  Transaction: TransactionModel,
  ApiLog: ApiLogModel,
  Settings: SettingsModel
};