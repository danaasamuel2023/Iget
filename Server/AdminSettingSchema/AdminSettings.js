// models/AdminSettings.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Admin settings schema for controlling system behaviors
const adminSettingsSchema = new Schema({
  // API Integration settings
  apiIntegrations: {
    // Controls whether MTN bundles go through Hubnet API or are processed manually
    mtnHubnetEnabled: { 
      type: Boolean, 
      default: true,
      description: "When enabled, MTN bundle orders will be sent to Hubnet API. When disabled, they will be placed in pending status for manual processing."
    },
    // Controls whether AT bundles go through Hubnet API or are processed manually
    atHubnetEnabled: { 
      type: Boolean, 
      default: true,
      description: "When enabled, AT bundle orders will be sent to Hubnet API. When disabled, they will be placed in pending status for manual processing."
    }
  },
  
  // Notification settings
  notifications: {
    // Controls whether SMS notifications are sent to users
    smsEnabled: {
      type: Boolean,
      default: true,
      description: "When enabled, users will receive SMS notifications for order status updates."
    },
    // Controls whether email notifications are sent to users
    emailEnabled: {
      type: Boolean,
      default: true,
      description: "When enabled, users will receive email notifications for order status updates."
    }
  },
  
  // Last updated information
  lastUpdatedBy: {
    type: Schema.Types.ObjectId,
    ref: 'IgetUser'
  },
  lastUpdatedAt: {
    type: Date,
    default: Date.now
  }
});

// Create a singleton pattern to ensure only one settings document exists
adminSettingsSchema.statics.getSettings = async function() {
  const settings = await this.findOne();
  if (settings) {
    return settings;
  }
  
  // If no settings exist, create default settings
  return await this.create({});
};

// Update method that also sets the lastUpdated fields
adminSettingsSchema.statics.updateSettings = async function(updates, userId) {
  const settings = await this.getSettings();
  
  // Apply updates using a deep merge approach
  const deepMerge = (target, source) => {
    for (const key in source) {
      if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        if (!target[key]) Object.assign(target, { [key]: {} });
        deepMerge(target[key], source[key]);
      } else {
        Object.assign(target, { [key]: source[key] });
      }
    }
    return target;
  };
  
  // Merge the updates with existing settings
  deepMerge(settings, updates);
  
  // Update last updated info
  settings.lastUpdatedBy = userId;
  settings.lastUpdatedAt = new Date();
  
  await settings.save();
  return settings;
};

const AdminSettings = mongoose.model('AdminSettings', adminSettingsSchema);

module.exports = AdminSettings;