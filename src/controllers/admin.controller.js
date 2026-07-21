const Shipment = require('../models/Shipment');
const { asyncHandler, AppError } = require('../middleware/errorHandler.middleware');
const { generateTrackingNumber, parsePagination, paginationMeta } = require('../utils/helpers');
const emailService = require('../services/email.service');
const logger = require('../utils/logger');

const STATUS_EMAIL_MAP = {
  picked_up: (s) => emailService.sendPickedUpAlert(s),
  in_transit: (s) => emailService.sendInTransitAlert(s),
  out_for_delivery: (s) => emailService.sendOutForDeliveryAlert(s),
  delivered: (s) => emailService.sendDeliveredAlert(s),
};

// ─── Stats ──────────────────────────────────────────────────────────────────

exports.getStats = asyncHandler(async (req, res) => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [totalShipments, deliveredToday, inTransit, onTimeTotal, onTimeMet, recentActivity] =
    await Promise.all([
      Shipment.countDocuments({ isDeleted: false }),
      Shipment.countDocuments({ status: 'delivered', deliveredAt: { $gte: todayStart }, isDeleted: false }),
      Shipment.countDocuments({ status: { $in: ['picked_up', 'in_transit', 'out_for_delivery'] }, isDeleted: false }),
      Shipment.countDocuments({ status: 'delivered', eta: { $exists: true }, isDeleted: false }),
      Shipment.countDocuments({ status: 'delivered', $expr: { $lte: ['$deliveredAt', '$eta'] }, isDeleted: false }),
      Shipment.find({ isDeleted: false })
        .sort({ updatedAt: -1 })
        .limit(10)
        .select('trackingNumber status sender.name recipient.name updatedAt service')
        .lean(),
    ]);

  const onTimeRate = onTimeTotal > 0 ? Math.round((onTimeMet / onTimeTotal) * 100) : 100;

  res.json({
    status: 'success',
    data: { totalShipments, deliveredToday, inTransit, onTimeRate, recentActivity },
  });
});

// ─── Shipments List ─────────────────────────────────────────────────────────

exports.getShipments = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { status, search } = req.query;

  const filter = { isDeleted: false };
  if (status) filter.status = status;
  if (search) {
    const re = { $regex: search, $options: 'i' };
    filter.$or = [
      { trackingNumber: re },
      { 'sender.name': re },
      { 'recipient.name': re },
      { 'sender.city': re },
      { 'recipient.city': re },
    ];
  }

  const [shipments, total] = await Promise.all([
    Shipment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Shipment.countDocuments(filter),
  ]);

  res.json({
    status: 'success',
    data: { shipments },
    pagination: paginationMeta(total, page, limit),
  });
});

// ─── Single Shipment ─────────────────────────────────────────────────────────

exports.getShipment = asyncHandler(async (req, res, next) => {
  const shipment = await Shipment.findOne({ _id: req.params.id, isDeleted: false }).lean();
  if (!shipment) return next(new AppError('Shipment not found', 404));
  res.json({ status: 'success', data: { shipment } });
});

// ─── Create Shipment ─────────────────────────────────────────────────────────

exports.createShipment = asyncHandler(async (req, res) => {
  const shipment = await Shipment.create({
    trackingNumber: generateTrackingNumber(),
    ...req.body,
  });

  // Send all shipping documents to recipient (non-blocking)
  if (shipment.recipient?.email) {
    emailService.sendShipmentDocuments(shipment.toObject()).catch((err) =>
      logger.warn(`Shipment documents email failed: ${err.message}`)
    );
  }

  res.status(201).json({ status: 'success', data: { shipment } });
});

// ─── Update Shipment ─────────────────────────────────────────────────────────

exports.updateShipment = asyncHandler(async (req, res, next) => {
  const forbidden = ['trackingNumber', 'isDeleted', 'events'];
  forbidden.forEach((f) => delete req.body[f]);

  if (req.body.status === 'delivered' && !req.body.deliveredAt) {
    req.body.deliveredAt = new Date();
  }

  const shipment = await Shipment.findOneAndUpdate(
    { _id: req.params.id, isDeleted: false },
    req.body,
    { returnDocument: 'after', runValidators: true }
  );

  if (!shipment) return next(new AppError('Shipment not found', 404));

  // Send the status alert email inline so the admin gets real confirmation
  // (previously fire-and-forget — failures only ever reached a server log)
  let notified = false;
  let notifyError;
  const newStatus = req.body.status;
  if (newStatus && STATUS_EMAIL_MAP[newStatus] && shipment.recipient?.email) {
    try {
      await STATUS_EMAIL_MAP[newStatus](shipment);
      notified = true;
    } catch (err) {
      logger.warn(`Status alert email failed [${newStatus}]: ${err.message}`);
      notifyError = err.message;
    }
  }

  res.json({ status: 'success', data: { shipment, notified, notifyError } });
});

// ─── Delete Shipment ─────────────────────────────────────────────────────────

exports.deleteShipment = asyncHandler(async (req, res, next) => {
  const shipment = await Shipment.findOneAndUpdate(
    { _id: req.params.id, isDeleted: false },
    { isDeleted: true },
    { returnDocument: 'after' }
  );

  if (!shipment) return next(new AppError('Shipment not found', 404));
  res.json({ status: 'success', message: 'Shipment deleted' });
});

// ─── Add Tracking Event ───────────────────────────────────────────────────────

exports.addEvent = asyncHandler(async (req, res, next) => {
  const { time, date, location, lat, lng, desc, type } = req.body;
  if (!desc) return next(new AppError('Event description is required', 400));

  const shipment = await Shipment.findOneAndUpdate(
    { _id: req.params.id, isDeleted: false },
    { $push: { events: { time, date, location, lat, lng, desc, type } } },
    { returnDocument: 'after' }
  );

  if (!shipment) return next(new AppError('Shipment not found', 404));
  const newEvent = shipment.events[shipment.events.length - 1];

  let notified = false;
  let notifyError;
  try {
    // Delay alert — send when an exception event is added
    if (type === 'exception' && shipment.recipient?.email) {
      await emailService.sendDelayAlert(shipment, newEvent);
      notified = true;
    }
    // In-transit update — send when a transit event is added
    if (type === 'transit' && shipment.recipient?.email) {
      await emailService.sendInTransitAlert(shipment, location);
      notified = true;
    }
  } catch (err) {
    logger.warn(`Event alert email failed [${type}]: ${err.message}`);
    notifyError = err.message;
  }

  res.status(201).json({ status: 'success', data: { event: newEvent, shipment, notified, notifyError } });
});

// ─── Edit Tracking Event ──────────────────────────────────────────────────────

exports.updateEvent = asyncHandler(async (req, res, next) => {
  const { time, date, location, lat, lng, desc, type } = req.body;
  const { id, eventId } = req.params;

  const update = {};
  if (desc !== undefined)     update['events.$.desc']     = desc;
  if (location !== undefined) update['events.$.location'] = location;
  if (lat !== undefined)      update['events.$.lat']      = lat;
  if (lng !== undefined)      update['events.$.lng']      = lng;
  if (date !== undefined)     update['events.$.date']     = date;
  if (time !== undefined)     update['events.$.time']     = time;
  if (type !== undefined)     update['events.$.type']     = type;

  const shipment = await Shipment.findOneAndUpdate(
    { _id: id, isDeleted: false, 'events._id': eventId },
    { $set: update },
    { returnDocument: 'after' }
  );

  if (!shipment) return next(new AppError('Shipment or event not found', 404));
  const updated = shipment.events.find((e) => String(e._id) === eventId);
  res.json({ status: 'success', data: { event: updated, shipment } });
});

// ─── Delete Tracking Event ────────────────────────────────────────────────────

exports.deleteEvent = asyncHandler(async (req, res, next) => {
  const { id, eventId } = req.params;

  const shipment = await Shipment.findOneAndUpdate(
    { _id: id, isDeleted: false },
    { $pull: { events: { _id: eventId } } },
    { returnDocument: 'after' }
  );

  if (!shipment) return next(new AppError('Shipment not found', 404));
  res.json({ status: 'success', data: { shipment } });
});
