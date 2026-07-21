const router = require('express').Router();
const { body, param } = require('express-validator');
const adminController = require('../controllers/admin.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');

// All admin routes require a valid JWT
router.use(authenticate);

// Stats
router.get('/stats', adminController.getStats);

// Geocode (used by the timeline event forms to resolve a location to lat/lng)
router.get('/geocode', adminController.geocode);

// Shipments
router.get('/shipments', adminController.getShipments);

router.post(
  '/shipments',
  [
    body('sender.name').trim().notEmpty().withMessage('Sender name is required'),
    body('recipient.name').trim().notEmpty().withMessage('Recipient name is required'),
    body('weight').isFloat({ min: 0.01 }).withMessage('Weight must be greater than 0'),
    body('service').optional().isIn(['standard', 'express', 'overnight', 'same_day']),
    body('status').optional().isIn(['pending','confirmed','picked_up','in_transit','out_for_delivery','delivered','failed','cancelled','returned']),
  ],
  validate,
  adminController.createShipment
);

router.get('/shipments/:id', param('id').isMongoId(), validate, adminController.getShipment);

router.patch(
  '/shipments/:id',
  [
    param('id').isMongoId(),
    // status-only update (used by Update Status button)
    body('status').optional().isIn(['pending','confirmed','picked_up','in_transit','out_for_delivery','delivered','failed','cancelled','returned']),
    // full edit fields (used by Edit Shipment form)
    body('sender.name').optional().trim().notEmpty().withMessage('Sender name cannot be empty'),
    body('recipient.name').optional().trim().notEmpty().withMessage('Recipient name cannot be empty'),
    body('service').optional().isIn(['standard', 'express', 'overnight', 'same_day']).withMessage('Invalid service type'),
    body('weight').optional().isFloat({ min: 0.01 }).withMessage('Weight must be greater than 0'),
    body('declaredValue').optional().isFloat({ min: 0 }),
    body('dimensions.length').optional().isFloat({ min: 0 }),
    body('dimensions.width').optional().isFloat({ min: 0 }),
    body('dimensions.height').optional().isFloat({ min: 0 }),
  ],
  validate,
  adminController.updateShipment
);

router.delete('/shipments/:id', param('id').isMongoId(), validate, adminController.deleteShipment);

router.post(
  '/shipments/:id/events',
  param('id').isMongoId(),
  body('desc').trim().notEmpty().withMessage('Event description is required'),
  body('type').optional().isIn(['pickup', 'transit', 'delivery', 'exception', 'info']),
  body('lat').optional({ nullable: true }).isFloat({ min: -90, max: 90 }),
  body('lng').optional({ nullable: true }).isFloat({ min: -180, max: 180 }),
  validate,
  adminController.addEvent
);

router.patch(
  '/shipments/:id/events/:eventId',
  [
    param('id').isMongoId(),
    param('eventId').isMongoId(),
    body('lat').optional({ nullable: true }).isFloat({ min: -90, max: 90 }),
    body('lng').optional({ nullable: true }).isFloat({ min: -180, max: 180 }),
  ],
  validate,
  adminController.updateEvent
);

router.delete(
  '/shipments/:id/events/:eventId',
  [param('id').isMongoId(), param('eventId').isMongoId()],
  validate,
  adminController.deleteEvent
);

module.exports = router;
