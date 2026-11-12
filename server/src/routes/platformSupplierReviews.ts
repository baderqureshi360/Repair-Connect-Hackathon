import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, requireRoles } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ok } from '../utils/response.js';
import {
  listReportedReviewsForPlatform,
  moderateSupplierReview
} from '../services/supplierReviews.js';

const router = Router();
const isTest = process.env.NODE_ENV === 'test';

const moderateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 10_000 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Too many moderation actions', code: 'RATE_LIMIT' } }
});

/** Platform operators only — never shop_admin / supplier / staff. */
router.use(authenticate, requireRoles('platform_operator'));

const moderateSchema = z.object({
  action: z.enum(['hide', 'restore', 'clear_report']),
  reason: z.string().min(5).max(2000)
});

router.get('/', async (req, res, next) => {
  try {
    return ok(
      res,
      await listReportedReviewsForPlatform({
        status: req.query.status ? String(req.query.status) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        skip: req.query.skip ? Number(req.query.skip) : undefined
      })
    );
  } catch (err) {
    next(err);
  }
});

router.post('/:reviewId/moderate', moderateLimiter, validate(moderateSchema), async (req, res, next) => {
  try {
    return ok(
      res,
      await moderateSupplierReview({
        user: req.user!,
        reviewId: String(req.params.reviewId),
        action: req.body.action,
        reason: req.body.reason
      })
    );
  } catch (err) {
    next(err);
  }
});

export default router;
