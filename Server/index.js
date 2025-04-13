const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const ConnectDB = require('./connection/connection.js');
const authRoutes = require('./AuthRoutes/Auth.js');
const dataOrderRoutes = require('./PlaceOrderRoutes/placeorder.js');
// const UserDashboard= require('./stat/page.js')
const AddBundle = require('./bundleRoutes/bundle.js');
const Deposite = require('./deposite/deposite.js')
const Orders = require('./orders/orders.js');
const apiKey = require('./api-key/api-key.js')
const userManagement = require('./Usermanagement/page.js');
const adminCheck = require('./AdminCheck/admincheck.js')
const DeveloperApi = require('./DeveloperApi/developer.js')
const Ishare =  require('./isharePlace/Ishare.js')
const UserDashboard = require('./usedashboard/page.js')
const Afa = require('./afa-registration/afa.js')
// const Depoite = require('./routes/deposite.js');
dotenv.config();

// Initialize Express app
const app = express();

// Middleware
app.use(express.json());
// Update your CORS configuration
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
app.use('/api/ishare',Ishare)
app.use('/api/dashboard',UserDashboard)
app.use('/api/afa', Afa);

// Default Route
app.get('/', (req, res) => {
  res.send('API is running...');
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
