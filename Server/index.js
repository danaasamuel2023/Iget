const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const ConnectDB = require('./connection/connection.js');
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

dotenv.config();

const app = express();

// ==========================================
// Security Middleware
// ==========================================

// Helmet — sets secure HTTP headers (XSS protection, no-sniff, etc.)
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false // disabled for API-only server
}));

// CORS — restrict to known origins in production
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['https://igetwebsite.vercel.app', 'https://iget.onrender.com', 'http://localhost:3000'];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(null, true); // permissive for now — tighten in production
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
}));

// Body parser with size limit to prevent large payload attacks
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Global rate limiter — 200 requests per 15 minutes per IP
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please try again later.' }
});
app.use('/api', globalLimiter);

// Strict rate limiter for auth routes — 15 attempts per 15 minutes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts. Please wait and try again.' }
});

// Strict rate limiter for payment/deposit routes
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many payment requests. Please wait.' }
});

// Remove X-Powered-By header
app.disable('x-powered-by');

// ==========================================
// Database
// ==========================================
ConnectDB();

// ==========================================
// Routes
// ==========================================

// Auth routes with stricter rate limiting
app.use('/api', authLimiter, authRoutes);
app.use('/api/order', dataOrderRoutes);
app.use('/api', UserDashboard);
app.use('/api/iget', AddBundle);
app.use('/api/depsoite', paymentLimiter, Deposite);
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

// Default Route
app.get('/', (req, res) => {
  res.send('API is running...');
});

// 404 handler for unknown routes
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// Error handling middleware (must be after routes)
app.use((err, req, res, next) => {
  console.error(err.stack);
  // Don't leak error details in production
  const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER;
  res.status(500).json({
    success: false,
    message: 'Internal Server Error',
    ...(isProduction ? {} : { error: err.message })
  });
});

// ==========================================
// Start Server
// ==========================================
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER;
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
  console.log(`Base URL: ${isProduction ? 'https://iget.onrender.com' : `http://localhost:${PORT}`}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...');
  process.exit(0);
});
