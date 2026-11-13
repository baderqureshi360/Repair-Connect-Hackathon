import { Router } from 'express';
import mongoose from 'mongoose';
import { Notification } from '../models/Notification.js';
import { authenticate } from '../middleware/auth.js';
import { ok } from '../utils/response.js';
import { AppError } from '../utils/errors.js';

const router = Router();
router.use(authenticate);

/**
 * Personal inbox — recipient-scoped only.
 * Never returns another user's notifications (customer/shop isolation via user ownership).
 */
router.get('/', async (req, res, next) => {
  try {
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.trunc(rawLimit), 1), 50)
      : 50;
    const unreadOnly = String(req.query.unreadOnly || '') === 'true';
    const filter: Record<string, unknown> = { user: req.user!.id };
    if (unreadOnly) filter.isRead = false;

    const [items, unread] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).limit(limit).lean(),
      Notification.countDocuments({ user: req.user!.id, isRead: false })
    ]);
    return ok(res, { items, unread });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/read', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      throw new AppError('Notification not found', 404, 'NOT_FOUND');
    }
    const item = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user!.id },
      { isRead: true },
      { new: true }
    );
    if (!item) throw new AppError('Notification not found', 404, 'NOT_FOUND');
    return ok(res, item);
  } catch (err) {
    next(err);
  }
});

router.post('/read-all', async (req, res, next) => {
  try {
    const result = await Notification.updateMany(
      { user: req.user!.id, isRead: false },
      { isRead: true }
    );
    return ok(res, { updated: true, modifiedCount: result.modifiedCount });
  } catch (err) {
    next(err);
  }
});

export default router;
