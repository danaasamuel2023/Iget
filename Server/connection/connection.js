const mongoose = require('mongoose');

// MongoDB connection with retry logic and error handling
const ConnectDB = async () => {
  // Connection configuration
  const password = '0246783840Sa';
  const dbName = 'dajounimarket'; // Specify your database name
  const uri = `mongodb+srv://dajounimarket:${password}@cluster0.kp8c2.mongodb.net/${dbName}?retryWrites=true&w=majority&appName=Cluster0`;

  // Enhanced connection options
  const mongoOptions = {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 30000, // 30 seconds timeout
    socketTimeoutMS: 45000, // 45 seconds socket timeout
    maxPoolSize: 10, // Maximum number of connections in the pool
    minPoolSize: 2, // Minimum number of connections in the pool
    heartbeatFrequencyMS: 10000, // How often to check server status
    retryReads: true, // Enable automatic retry for read operations
    retryWrites: true, // Already in URI but good to be explicit
    writeConcern: {
      w: 'majority',
      j: true,
      wtimeout: 5000
    },
    readPreference: 'primaryPreferred', // Allows reading from secondaries if primary is unavailable
    family: 4 // Use IPv4, skip IPv6 for now
  };

  // Retry logic for initial connection
  const maxRetries = 5;
  let retries = 0;
  
  while (retries < maxRetries) {
    try {
      await mongoose.connect(uri, mongoOptions);
      console.log('✅ Connected to MongoDB successfully');
      break;
    } catch (error) {
      retries++;
      console.error(`❌ MongoDB connection attempt ${retries} failed:`, error.message);
      
      if (retries < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, retries - 1), 10000); // Exponential backoff
        console.log(`⏳ Retrying in ${delay / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.error('❌ Failed to connect to MongoDB after maximum retries');
        throw error;
      }
    }
  }

  // Connection event handlers
  mongoose.connection.on('connected', () => {
    console.log('📡 Mongoose connected to MongoDB');
  });

  mongoose.connection.on('error', (err) => {
    console.error('❌ Mongoose connection error:', err);
  });

  mongoose.connection.on('disconnected', () => {
    console.log('🔌 Mongoose disconnected from MongoDB');
  });

  mongoose.connection.on('reconnected', () => {
    console.log('🔄 Mongoose reconnected to MongoDB');
  });

  // Monitor replica set changes
  mongoose.connection.on('topologyDescriptionChanged', (event) => {
    console.log('🔄 MongoDB topology changed:', {
      previousType: event.previousDescription.type,
      newType: event.newDescription.type
    });
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    try {
      await mongoose.connection.close();
      console.log('📴 MongoDB connection closed through app termination');
      process.exit(0);
    } catch (err) {
      console.error('Error during MongoDB disconnection:', err);
      process.exit(1);
    }
  });

  process.on('SIGTERM', async () => {
    try {
      await mongoose.connection.close();
      console.log('📴 MongoDB connection closed through app termination');
      process.exit(0);
    } catch (err) {
      console.error('Error during MongoDB disconnection:', err);
      process.exit(1);
    }
  });
};

// Helper function to check connection status
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
    isConnected: state === 1
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
      
      // Check if error is retryable
      const retryableErrors = [
        'MongoServerSelectionError',
        'MongoNetworkError',
        'MongoNetworkTimeoutError',
        'MongoWriteConcernError'
      ];
      
      const isRetryable = retryableErrors.includes(error.name) || 
                         (error.message && error.message.includes('primary marked stale'));
      
      if (isRetryable && attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        console.warn(`⚠️  ${operationName} failed (attempt ${attempt}/${maxRetries}). Retrying in ${delay}ms...`);
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