// middleware/auth.js
const jwt = require('jsonwebtoken');


module.exports = function(req, res, next) {
  // Get token from header
  const token = req.header('Authorization')?.replace('Bearer ', '');

  // Check if no token
  if (!token) {
    return res.status(401).json({ message: 'No token, authorization denied' });
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, 'Igetbysamtech');
    
    // Add user from payload
    req.user = decoded.user;
    
    // Optional: Check if user still exists in database
    // const user = await User.findById(decoded.user.id);
    // if (!user) {
    //   return res.status(401).json({ message: 'User no longer exists' });
    // }
    
    next();
  } catch (err) {
    res.status(401).json({ message: 'Token is not valid' });
  }
};