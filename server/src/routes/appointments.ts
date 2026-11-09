import { Router } from 'express';
import { Appointment } from '../models/index.js';
import { authenticate, requireRoles } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { appointmentCreateSchema, appointmentRescheduleSchema } from '../validators/schemas.js';
import { ok } from '../utils/response.js';
import {
  bookAppointment,
  cancelAppointment,
  listAvailableSlots,
  rescheduleAppointment
} from '../services/appointments.js';
import { AppError } from '../utils/errors.js';

const router = Router();

router.get('/slots', async (req, res, next) => {
  try {
    const shopId = String(req.query.shopId || '');
    const date = String(req.query.date || '');
    if (!shopId || !date) throw new AppError('shopId and date are required', 400, 'VALIDATION');
    const slots = await listAvailableSlots(shopId, date);
    return ok(res, slots);
  } catch (err) {
    next(err);
  }
});

router.use(authenticate);

router.get('/', requireRoles('customer', 'shop_admin'), async (req, res, next) => {
  try {
    const filter: Record<string, unknown> = {};
    if (req.user!.role === 'customer') filter.customer = req.user!.id;
    else filter.shop = { $in: req.user!.shopIds };
    const items = await Appointment.find(filter)
      .populate('shop', 'name city code')
      .sort({ startsAt: 1 })
      .limit(100);
    return ok(res, items);
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRoles('customer'), validate(appointmentCreateSchema), async (req, res, next) => {
  try {
    const appointment = await bookAppointment({
      customerId: req.user!.id,
      shopId: req.body.shopId,
      startsAt: req.body.startsAt,
      notes: req.body.notes,
      repairRequestId: req.body.repairRequestId
    });
    return ok(res, appointment, 201);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/cancel', requireRoles('customer'), async (req, res, next) => {
  try {
    const appointment = await cancelAppointment({
      appointmentId: String(req.params.id),
      customerId: req.user!.id,
      reason: req.body?.reason
    });
    return ok(res, appointment);
  } catch (err) {
    next(err);
  }
});

router.post(
  '/:id/reschedule',
  requireRoles('customer'),
  validate(appointmentRescheduleSchema),
  async (req, res, next) => {
    try {
      const appointment = await rescheduleAppointment({
        appointmentId: String(req.params.id),
        customerId: req.user!.id,
        startsAt: req.body.startsAt,
        notes: req.body.notes
      });
      return ok(res, appointment);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
