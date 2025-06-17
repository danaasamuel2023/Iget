const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const { ConnectDB, checkConnection } = require('./connection/connection.js');
const { ensureDbConnection, mongoErrorHandler } = require('./AuthMiddle/dbMiddleware.js');

// Load environment variables first
dotenv.config();

// Import routes
const authRoutes = require('./AuthRoutes/Auth.js');
const dataOrderRoutes = require('./PlaceOrderRoutes/placeorder.js');
const AddBundle = require('./bundleRoutes/bundle.js');
const Deposite = require('./deposite/deposite.js');
const Orders = require('./orders/orders.js');
const apiKey = require('./api-key/api-key.js');
const userManagement = require('./Usermanagement/page.js');
const adminCheck = require('./AdminCheck/admincheck.js');
const DeveloperApi = require('./DeveloperApi/developer.js');
const Ishare = require('./isharePlace/Ishare.js');
const UserDashboard = require('./usedashboard/page.js');
const Afa = require('./afa-registration/afa.js');
const NetworkAvailability = require('./NetworkStock/rout.js');
const adminMessages = require('./MessageTemplate/adminMessage.js');
const AdminSettings = require('./admin-settingRoute/admin-settings.js');

// Initialize Express app
const app = express();

// Trust proxy for Render
app.set('trust proxy', 1);

// Basic middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS configuration
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
};
app.use(cors(corsOptions));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
  });
  next();
});

// Health check endpoint (no DB required)
app.get('/health', async (req, res) => {
  const { isConnected, status, details } = checkConnection();
  
  res.status(isConnected ? 200 : 503).json({
    status: isConnected ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    database: {
      connected: isConnected,
      status: status,
      ...details
    },
    server: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      nodeVersion: process.version
    }
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'API is running...',
    version: process.env.API_VERSION || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  });
});

// Apply database connection check middleware to all API routes
app.use('/api', ensureDbConnection);

// API Routes
app.use('/api', authRoutes);
app.use('/api/order', dataOrderRoutes);
app.use('/api', UserDashboard);
app.use('/api/iget', AddBundle);
app.use('/api/depsoite', Deposite);
app.use('/api/orders', Orders);
app.use('/api/v1', apiKey);
app.use('/api/admin', userManagement);
app.use('/api/auth', adminCheck);
app.use('/api/developer', DeveloperApi);
app.use('/api/ishare', Ishare);
app.use('/api/dashboard', UserDashboard);
app.use('/api/afa', Afa);
app.use('/api/network', NetworkAvailability);
app.use('/api/messages', adminMessages);
app.use('/api/admin/settings', AdminSettings);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.originalUrl
  });
});

// MongoDB error handler (must be before general error handler)
app.use(mongoErrorHandler);

// General error handling middleware
app.use((err, req, res, next) => {
  // Log error details
  console.error('Error:', {
    name: err.name,
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
  
  // Send error response
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Start server function
const startServer = async () => {
  try {
    // Connect to MongoDB with retry logic
    console.log('🚀 Initializing server...');
    await ConnectDB();
    
    // Start Express server
    const PORT = process.env.PORT || 5000;
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`
╔════════════════════════════════════════╗
║     🚀 Server Started Successfully!    ║
╠════════════════════════════════════════╣
║ Port: ${PORT.toString().padEnd(33)}║
║ Environment: ${(process.env.NODE_ENV || 'development').padEnd(26)}║
║ Time: ${new Date().toISOString().padEnd(33)}║
╚════════════════════════════════════════╝
      `);
    });
    
    // Handle server errors
    server.on('error', (error) => {
      console.error('Server error:', error);
      process.exit(1);
    });
    
    // Graceful shutdown
    const shutdown = async (signal) => {
      console.log(`\n${signal} received. Starting graceful shutdown...`);
      
      server.close(() => {
        console.log('HTTP server closed');
      });
      
      // Wait for existing connections to close
      setTimeout(() => {
        console.log('Forcing shutdown...');
        process.exit(0);
      }, 30000);
    };
    
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Start the server
startServer();