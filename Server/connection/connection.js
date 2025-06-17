// connection/connection.js
const mongoose = require('mongoose');

// Simple, reliable connection function
const ConnectDB = async () => {
  const password = process.env.MONGODB_PASSWORD || '0246783840Sa';
  const username = process.env.MONGODB_USER || 'dajounimarket';
  const dbName = process.env.MONGODB_DB || 'dajounimarket';
  
  // Use the SRV connection string (simpler and more reliable)
  const uri = `mongodb+srv://${username}:${password}@cluster0.kp8c2.mongodb.net/${dbName}?retryWrites=true&w=majority`;
  
  // Simplified options that work reliably
  const options = {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 30000, // 30 seconds
    heartbeatFrequencyMS: 10000, // 10 seconds
    maxPoolSize: 10,
    family: 4, // IPv4
    retryReads: true,
    retryWrites: true,
  };
  
  // Retry logic
  const maxRetries = 5;
  let retries = 0;
  
  while (retries < maxRetries) {
    try {
      console.log(`📡 MongoDB connection attempt ${retries + 1}/${maxRetries}`);
      
      await mongoose.connect(uri, options);
      
      console.log('✅ MongoDB connected successfully');
      console.log(`📊 Database: ${mongoose.connection.name}`);
      
      // Set up event handlers
      setupEventHandlers();
      
      return mongoose.connection;
    } catch (error) {
      retries++;
      console.error(`❌ Connection attempt ${retries} failed:`, error.message);
      
      if (retries < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, retries), 10000);
        console.log(`⏳ Retrying in ${delay / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.error('❌ Failed to connect to MongoDB after all retries');
        throw error;
      }
    }
  }
};

// Event handlers
const setupEventHandlers = () => {
  mongoose.connection.on('connected', () => {
    console.log('📗 Mongoose connected to MongoDB');
  });
  
  mongoose.connection.on('disconnected', () => {
    console.log('📕 Mongoose disconnected from MongoDB');
  });
  
  mongoose.connection.on('reconnected', () => {
    console.log('📗 Mongoose reconnected to MongoDB');
  });
  
  mongoose.connection.on('error', (err) => {
    console.error('📛 MongoDB connection error:', err.message);
    
    // Specific handling for replica set errors
    if (err.message.includes('primary marked stale') || 
        err.message.includes('ReplicaSetNoPrimary')) {
      console.log('🔄 Handling replica set election, will auto-recover...');
    }
  });
  
  // Graceful shutdown
  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);
};

// Graceful shutdown
const gracefulShutdown = async () => {
  try {
    console.log('📴 Closing MongoDB connection...');
    await mongoose.connection.close();
    console.log('✅ MongoDB connection closed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
};

// Connection status checker
const checkConnection = () => {
  const states = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  };
  
  const state = mongoose.connection.readyState;
  return {
    status: states[state],
    isConnected: state === 1,
    details: {
      state,
      name: mongoose.connection.name
    }
  };
};

// Retry wrapper for database operations
const executeWithRetry = async (operation, operationName = 'Database operation', maxRetries = 3) => {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      // List of retryable error conditions
      const isRetryable = 
        error.name === 'MongoServerSelectionError' ||
        error.name === 'MongoNetworkError' ||
        error.message?.includes('primary marked stale') ||
        error.message?.includes('ReplicaSetNoPrimary') ||
        error.message?.includes('topology was destroyed');
      
      if (isRetryable && attempt < maxRetries) {
        const delay = Math.min(1000 * attempt, 5000);
        console.warn(`⚠️  ${operationName} failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
  
  throw lastError;
};

module.exports = {
  ConnectDB,
  checkConnection,
  executeWithRetry
};