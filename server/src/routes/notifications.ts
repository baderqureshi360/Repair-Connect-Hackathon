import { Router } from 'express';
import { Notification } from '../models/Notification.js';
import { authenticate } from '../middleware/auth.js';
import { ok } from '../utils/response.js';
import { AppError } from '../utils/errors.js';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const items = await Notification.find({ user: req.user!.id })
      .sort({ createdAt: -1 })
      .limit(50);
    const unread = await Notification.countDocuments({ user: req.user!.id, isRead: false });
    return ok(res, { items, unread });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/read', async (req, res, next) => {
  try {
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
    await Notification.updateMany({ user: req.user!.id, isRead: false }, { isRead: true });
    return ok(res, { updated: true });
  } catch (err) {
    next(err);
  }
});

export default router;
