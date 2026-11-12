import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRoles } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ok } from '../utils/response.js';
import {
  approveSupplierApplication,
  getSupplierApplicationForOperator,
  listSupplierApplicationAudit,
  listSupplierApplicationsForOperator,
  reactivateSupplierBusiness,
  rejectSupplierApplication,
  suspendSupplierBusiness
} from '../services/supplierApplications.js';

const router = Router();

const approveBodySchema = z.object({
  remarks: z.string().max(2000).optional()
});

const reasonBodySchema = z.object({
  reason: z.string().min(5).max(2000)
});

const ALLOWED_STATUS = new Set([
  'pending',
  'pending_review',
  'approved',
  'rejected',
  'suspended',
  'cancelled',
  'all'
]);

/** Platform operators only — never shop_admin / supplier / staff. */
router.use(authenticate, requireRoles('platform_operator'));

router.get('/', async (req, res, next) => {
  try {
    const statusRaw = String(req.query.status || 'pending');
    const status = ALLOWED_STATUS.has(statusRaw) ? statusRaw : 'pending';
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const skip = Math.max(Number(req.query.skip) || 0, 0);
    const data = await listSupplierApplicationsForOperator({ status, limit, skip });
    return ok(res, data);
  } catch (err) {
    next(err);
  }
});

function publicIdParam(req: { params: { publicId?: string | string[] } }) {
  return String(req.params.publicId || '');
}

router.get('/:publicId', async (req, res, next) => {
  try {
    return ok(res, await getSupplierApplicationForOperator(publicIdParam(req)));
  } catch (err) {
    next(err);
  }
});

router.get('/:publicId/audit', async (req, res, next) => {
  try {
    return ok(res, await listSupplierApplicationAudit(publicIdParam(req)));
  } catch (err) {
    next(err);
  }
});

router.post('/:publicId/approve', validate(approveBodySchema), async (req, res, next) => {
  try {
    const result = await approveSupplierApplication({
      publicId: publicIdParam(req),
      remarks: req.body.remarks,
      actorLabel: `platform_operator:${req.user!.email}`,
      reviewerId: req.user!.id
    });
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.post('/:publicId/reject', validate(reasonBodySchema), async (req, res, next) => {
  try {
    const result = await rejectSupplierApplication({
      publicId: publicIdParam(req),
      reason: req.body.reason,
      actorLabel: `platform_operator:${req.user!.email}`,
      reviewerId: req.user!.id
    });
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.post('/:publicId/suspend', validate(reasonBodySchema), async (req, res, next) => {
  try {
    const result = await suspendSupplierBusiness({
      publicId: publicIdParam(req),
      reason: req.body.reason,
      actorLabel: `platform_operator:${req.user!.email}`,
      reviewerId: req.user!.id
    });
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.post('/:publicId/reactivate', validate(approveBodySchema), async (req, res, next) => {
  try {
    const result = await reactivateSupplierBusiness({
      publicId: publicIdParam(req),
      remarks: req.body.remarks,
      actorLabel: `platform_operator:${req.user!.email}`,
      reviewerId: req.user!.id
    });
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

export default router;
