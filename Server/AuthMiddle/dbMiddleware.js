// middleware/dbMiddleware.js
const { executeWithRetry, checkConnection } = require('../connection/connection');

/**
 * Middleware to ensure database connection is healthy
 */
const ensureDbConnection = (req, res, next) => {
  const { isConnected, status } = checkConnection();
  
  if (!isConnected) {
    console.error(`❌ Database not connected. Status: ${status}`);
    return res.status(503).json({
      success: false,
      message: 'Service temporarily unavailable',
      error: 'Database connection is not established',
      retryAfter: 5 // seconds
    });
  }
  
  next();
};

/**
 * Wrapper for async route handlers
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Create a database operation wrapper for models
 */
const createDbOperation = (Model) => {
  return {
    // Find operations
    find: async (query = {}, options = {}) => {
      return executeWithRetry(
        async () => await Model.find(query, null, options).lean(),
        `${Model.modelName}.find`
      );
    },
    
    findOne: async (query, options = {}) => {
      return executeWithRetry(
        async () => await Model.findOne(query, null, options).lean(),
        `${Model.modelName}.findOne`
      );
    },
    
    findById: async (id, options = {}) => {
      return executeWithRetry(
        async () => await Model.findById(id, null, options).lean(),
        `${Model.modelName}.findById`
      );
    },
    
    // Create operations
    create: async (data) => {
      return executeWithRetry(
        async () => {
          const doc = new Model(data);
          return await doc.save();
        },
        `${Model.modelName}.create`
      );
    },
    
    insertMany: async (data, options = {}) => {
      return executeWithRetry(
        async () => await Model.insertMany(data, options),
        `${Model.modelName}.insertMany`
      );
    },
    
    // Update operations
    findByIdAndUpdate: async (id, update, options = { new: true }) => {
      return executeWithRetry(
        async () => await Model.findByIdAndUpdate(id, update, options),
        `${Model.modelName}.findByIdAndUpdate`
      );
    },
    
    updateOne: async (filter, update, options = {}) => {
      return executeWithRetry(
        async () => await Model.updateOne(filter, update, options),
        `${Model.modelName}.updateOne`
      );
    },
    
    updateMany: async (filter, update, options = {}) => {
      return executeWithRetry(
        async () => await Model.updateMany(filter, update, options),
        `${Model.modelName}.updateMany`
      );
    },
    
    // Delete operations
    findByIdAndDelete: async (id, options = {}) => {
      return executeWithRetry(
        async () => await Model.findByIdAndDelete(id, options),
        `${Model.modelName}.findByIdAndDelete`
      );
    },
    
    deleteOne: async (filter, options = {}) => {
      return executeWithRetry(
        async () => await Model.deleteOne(filter, options),
        `${Model.modelName}.deleteOne`
      );
    },
    
    deleteMany: async (filter, options = {}) => {
      return executeWithRetry(
        async () => await Model.deleteMany(filter, options),
        `${Model.modelName}.deleteMany`
      );
    },
    
    // Count operations
    countDocuments: async (filter = {}) => {
      return executeWithRetry(
        async () => await Model.countDocuments(filter),
        `${Model.modelName}.countDocuments`
      );
    },
    
    // Aggregate operations
    aggregate: async (pipeline, options = {}) => {
      return executeWithRetry(
        async () => await Model.aggregate(pipeline, options),
        `${Model.modelName}.aggregate`
      );
    }
  };
};

/**
 * Error handler middleware for MongoDB errors
 */
const mongoErrorHandler = (err, req, res, next) => {
  console.error('MongoDB Error:', err);
  
  // Handle specific MongoDB errors
  if (err.name === 'MongoServerSelectionError' || 
      err.message?.includes('primary marked stale')) {
    return res.status(503).json({
      success: false,
      message: 'Database service temporarily unavailable',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
      retryAfter: 5
    });
  }
  
  if (err.code === 11000) {
    // Duplicate key error
    const field = Object.keys(err.keyPattern || {})[0];
    return res.status(409).json({
      success: false,
      message: `${field || 'Field'} already exists`
    });
  }
  
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors
    });
  }
  
  if (err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: `Invalid ${err.path}: ${err.value}`
    });
  }
  
  // Pass to next error handler
  next(err);
};

module.exports = {
  ensureDbConnection,
  asyncHandler,
  createDbOperation,
  mongoErrorHandler
};