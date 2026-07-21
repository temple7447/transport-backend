const mongoose = require('mongoose');

const STATUSES = ['pending', 'confirmed', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'failed', 'cancelled', 'returned'];
const SERVICES = ['standard', 'express', 'overnight', 'same_day'];
const EVENT_TYPES = ['pickup', 'transit', 'delivery', 'exception', 'info'];

const partySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    street: String,
    city: { type: String, trim: true },
    state: String,
    country: { type: String, trim: true },
    postalCode: String,
  },
  { _id: false }
);

const eventSchema = new mongoose.Schema(
  {
    time: { type: String },
    date: { type: String },
    location: { type: String },
    lat: { type: Number, min: -90, max: 90 },
    lng: { type: Number, min: -180, max: 180 },
    desc: { type: String, required: true },
    type: { type: String, enum: EVENT_TYPES, default: 'info' },
  },
  { timestamps: true, _id: true }
);

const shipmentSchema = new mongoose.Schema(
  {
    trackingNumber: { type: String, unique: true, index: true },
    status: { type: String, enum: STATUSES, default: 'pending', index: true },
    service: { type: String, enum: SERVICES, default: 'standard' },
    sender: { type: partySchema, required: true },
    recipient: { type: partySchema, required: true },
    weight: { type: Number, required: true, min: 0.01 },
    dimensions: {
      length: Number,
      width: Number,
      height: Number,
    },
    contents: { type: String, trim: true },
    declaredValue: { type: Number, default: 0 },
    price: { type: Number, default: 0 },
    eta: { type: Date },
    deliveredAt: { type: Date },
    events: [eventSchema],
    notes: { type: String },
    isDeleted: { type: Boolean, default: false, select: false },
  },
  { timestamps: true }
);

shipmentSchema.index({ status: 1, createdAt: -1 });
shipmentSchema.index({ 'sender.name': 'text', 'recipient.name': 'text', trackingNumber: 'text' });

module.exports = mongoose.model('Shipment', shipmentSchema);
