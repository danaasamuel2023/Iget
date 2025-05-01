// Network Availability Schema
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Network Availability Schema
const networkAvailabilitySchema = new Schema({
  networkType: { 
    type: String, 
    enum: ['mtnup2u', 'mtn-fibre', 'mtn-justforu', 'AT-ishare', 'Telecel-5959', 'AfA-registration', 'other'],
    required: true,
    unique: true
  },
  isAvailable: { 
    type: Boolean, 
    default: true 
  },
  unavailableMessage: { 
    type: String, 
    default: 'This network is currently unavailable. Please try again later.'
  },
  updatedBy: {
    type: Schema.Types.ObjectId,
    ref: 'IgetUser'
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Create model
const NetworkAvailabilityModel = mongoose.model('NetworkAvailability', networkAvailabilitySchema);

// Export model
module.exports = NetworkAvailabilityModel;