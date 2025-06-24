const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const cron = require('node-cron'); // Add this line
const ConnectDB = require('./connection/connection.js');
const authRoutes = require('./AuthRoutes/Auth.js');
const dataOrderRoutes = require('./PlaceOrderRoutes/placeorder.js');
const AddBundle = require('./bundleRoutes/bundle.js');
const Deposite = require('./deposite/deposite.js')
const Orders = require('./orders/orders.js');
const apiKey = require('./api-key/api-key.js')
const userManagement = require('./Usermanagement/page.js');
const adminCheck = require('./AdminCheck/admincheck.js')
const DeveloperApi = require('./DeveloperApi/developer.js')
const Ishare = require('./isharePlace/Ishare.js')
const UserDashboard = require('./usedashboard/page.js')
const Afa = require('./afa-registration/afa.js')
const NetworkAvailability = require('./NetworkStock/rout.js');
const adminMessages = require('./MessageTemplate/adminMessage.js');
const AdminSettings = require('./admin-settingRoute/admin-settings.js');

dotenv.config();

// Initialize Express app
const app = express();

// Middleware
app.use(express.json());
app.use(cors());
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Internal Server Error' });
});

// Connect to Database
ConnectDB();

// Routes
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
app.use('/api/ishare', Ishare)
app.use('/api/dashboard', UserDashboard)
app.use('/api/afa', Afa);
app.use('/api/network', NetworkAvailability);
app.use('/api/messages', adminMessages);
app.use('/api/admin/settings', AdminSettings);

// Default Route
app.get('/', (req, res) => {
  res.send('API is running...');
});

// ==============================================
// MTN Up2U Status Automation
// ==============================================
// Set up automated MTN Up2U status checking every 10 minutes
cron.schedule('*/10 * * * *', async () => {
  try {
    console.log('🤖 [CRON] Running automated MTN Up2U status check...');
    
    const fetch = (await import('node-fetch')).default;
    
    // Auto-detect the correct URL for development vs production
    const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER;
    const baseUrl = isProduction 
      ? 'https://iget.onrender.com'  // Your production URL
      : `http://localhost:${process.env.PORT || 5000}`;
    
    console.log('🤖 [CRON] Environment:', isProduction ? 'PRODUCTION' : 'DEVELOPMENT');
    console.log('🤖 [CRON] Using URL:', baseUrl);
    
    const response = await fetch(`${baseUrl}/api/orders/cron/check-hubnet-statuses`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'User-Agent': 'iget-automation/1.0'
      },
      timeout: 30000 // 30 second timeout
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log('🤖 [CRON] Automation completed:', result.message);
      
      if (result.data?.updated > 0) {
        console.log(`✅ [CRON] SUCCESS: ${result.data.updated} MTN Up2U orders auto-completed!`);
      } else {
        console.log('🔍 [CRON] No orders needed updating');
      }
      
      // Log summary
      console.log(`📊 [CRON] Summary: Checked ${result.data?.checked || 0} orders, Updated ${result.data?.updated || 0} orders`);
      
    } else {
      console.error('🤖 [CRON] Automation failed:', response.status, response.statusText);
    }
    
  } catch (error) {
    console.error('🤖 [CRON] Automation error:', error.message);
    
    // Log more details for debugging
    if (error.code === 'ECONNREFUSED') {
      console.error('🤖 [CRON] Connection refused - server might be starting up');
    } else if (error.code === 'FETCH_ERROR') {
      console.error('🤖 [CRON] Network error - check internet connection');
    }
  }
});

// Additional cron job to check automation health every hour
cron.schedule('0 * * * *', async () => {
  try {
    console.log('🏥 [HEALTH] Running automation health check...');
    
    const fetch = (await import('node-fetch')).default;
    const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER;
    const baseUrl = isProduction 
      ? 'https://iget.onrender.com'
      : `http://localhost:${process.env.PORT || 5000}`;
    
    const response = await fetch(`${baseUrl}/api/orders/cron/status`, {
      method: 'GET',
      headers: { 
        'Content-Type': 'application/json',
        'User-Agent': 'iget-health-check/1.0'
      },
      timeout: 15000
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log('🏥 [HEALTH] Automation is healthy');
      console.log(`🏥 [HEALTH] Pending MTN Up2U orders: ${result.data?.pendingMtnUp2uOrders || 0}`);
      console.log(`🏥 [HEALTH] Auto-completed in last 24h: ${result.data?.automatedLast24h || 0}`);
    } else {
      console.error('🏥 [HEALTH] Health check failed:', response.status);
    }
    
  } catch (error) {
    console.error('🏥 [HEALTH] Health check error:', error.message);
  }
});

console.log('✅ MTN Up2U status automation initialized');
console.log('🕐 Automation schedule: Every 10 minutes');
console.log('🏥 Health check schedule: Every hour');
// ==============================================

// Start Server
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log('🤖 Automated MTN Up2U status checking is ACTIVE');
  console.log('📅 Next automation check in 10 minutes');
  
  // Log environment info
  const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER;
  console.log(`🌍 Environment: ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
  console.log(`🔗 Base URL: ${isProduction ? 'https://iget.onrender.com' : `http://localhost:${PORT}`}`);
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  console.log('🤖 Stopping MTN Up2U automation...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully');
  console.log('🤖 Stopping MTN Up2U automation...');
  process.exit(0);
});