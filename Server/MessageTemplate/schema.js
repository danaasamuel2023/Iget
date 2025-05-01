// schema/messageTemplate.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const MessageTemplateSchema = new Schema({
  name: {
    type: String,
    required: [true, 'Template name is required'],
    trim: true,
    unique: true
  },
  content: {
    type: String,
    required: [true, 'Template content is required'],
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  variables: [{
    type: String,
    trim: true
  }],
  category: {
    type: String,
    enum: ['transactional', 'promotional', 'notification', 'other'],
    default: 'notification'
  },
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the updatedAt field before saving
MessageTemplateSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

const MessageTemplate = mongoose.model('MessageTemplate', MessageTemplateSchema);
module.exports = MessageTemplate;