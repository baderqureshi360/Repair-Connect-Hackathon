import { Router } from 'express';
import { authenticate, requireRoles } from '../middleware/auth.js';
import { ok } from '../utils/response.js';
import { AppError } from '../utils/errors.js';
import {
  adminAnalytics,
  customerAnalytics,
  mechanicAnalytics,
  partsAnalytics,
  resolveDateRange,
  type AnalyticsRange
} from '../services/analytics.js';

const router = Router();
router.use(authenticate);

function parseRange(query: Record<string, unknown>) {
  return resolveDateRange({
    range: (query.range as AnalyticsRange) || '30d',
    from: query.from as string | undefined,
    to: query.to as string | undefined
  });
}

router.get('/me', async (req, res, next) => {
  try {
    const range = parseRange(req.query as Record<string, unknown>);
    const role = req.user!.role;
    if (role === 'customer') return ok(res, await customerAnalytics(req.user!, range));
    if (role === 'mechanic') return ok(res, await mechanicAnalytics(req.user!, range));
    if (role === 'parts_coordinator') {
      return ok(res, await partsAnalytics(req.user!, range, req.query.shopId as string | undefined));
    }
    if (role === 'shop_admin') {
      return ok(res, await adminAnalytics(req.user!, range, req.query.shopId as string | undefined));
    }
    throw new AppError('Unsupported role for analytics', 403, 'FORBIDDEN');
  } catch (err) {
    next(err);
  }
});

router.get('/customer', requireRoles('customer'), async (req, res, next) => {
  try {
    return ok(res, await customerAnalytics(req.user!, parseRange(req.query as Record<string, unknown>)));
  } catch (err) {
    next(err);
  }
});

router.get('/mechanic', requireRoles('mechanic'), async (req, res, next) => {
  try {
    return ok(res, await mechanicAnalytics(req.user!, parseRange(req.query as Record<string, unknown>)));
  } catch (err) {
    next(err);
  }
});

router.get('/parts', requireRoles('parts_coordinator', 'shop_admin'), async (req, res, next) => {
  try {
    return ok(
      res,
      await partsAnalytics(req.user!, parseRange(req.query as Record<string, unknown>), req.query.shopId as string | undefined)
    );
  } catch (err) {
    next(err);
  }
});

router.get('/admin', requireRoles('shop_admin'), async (req, res, next) => {
  try {
    return ok(
      res,
      await adminAnalytics(req.user!, parseRange(req.query as Record<string, unknown>), req.query.shopId as string | undefined)
    );
  } catch (err) {
    next(err);
  }
});

export default router;
