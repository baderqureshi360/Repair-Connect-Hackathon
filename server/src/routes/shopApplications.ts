import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ok } from '../utils/response.js';
import { AppError } from '../utils/errors.js';
import { env } from '../config/env.js';
import {
  approveShopApplication,
  claimShopApplication,
  getMyShopApplication,
  rejectShopApplication
} from '../services/shopApplications.js';

const router = Router();

function requireProvisioningKey(req: { headers: Record<string, unknown> }) {
  const key = env.provisioningApiKey;
  if (!key || key.length < 16) {
    throw new AppError(
      'Provisioning API is not configured (set PROVISIONING_API_KEY)',
      503,
      'PROVISIONING_DISABLED'
    );
  }
  const provided = String(req.headers['x-provisioning-key'] || '');
  if (provided !== key) {
    throw new AppError('Invalid provisioning key', 401, 'PROVISIONING_UNAUTHORIZED');
  }
}

/** Authenticated pending/approved owner — own application only. */
router.get('/mine', authenticate, async (req, res, next) => {
  try {
    return ok(res, await getMyShopApplication(req.user!.id));
  } catch (err) {
    next(err);
  }
});

const approveSchema = z.object({
  publicId: z.string().min(3).max(40),
  remarks: z.string().max(2000).optional()
});

const rejectSchema = z.object({
  publicId: z.string().min(3).max(40),
  reason: z.string().min(5).max(2000)
});

const claimSchema = z.object({
  publicId: z.string().min(3).max(40),
  ownerEmail: z.string().email()
});

/** Protected provisioning endpoints — require X-Provisioning-Key, not shop_admin role. */
router.post('/provision/approve', validate(approveSchema), async (req, res, next) => {
  try {
    requireProvisioningKey(req);
    const result = await approveShopApplication({
      publicId: req.body.publicId,
      remarks: req.body.remarks,
      actorLabel: 'provisioning-api'
    });
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.post('/provision/reject', validate(rejectSchema), async (req, res, next) => {
  try {
    requireProvisioningKey(req);
    const result = await rejectShopApplication({
      publicId: req.body.publicId,
      reason: req.body.reason,
      actorLabel: 'provisioning-api'
    });
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.post('/provision/claim', validate(claimSchema), async (req, res, next) => {
  try {
    requireProvisioningKey(req);
    const result = await claimShopApplication({
      publicId: req.body.publicId,
      ownerEmail: req.body.ownerEmail,
      actorLabel: 'provisioning-api'
    });
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

export default router;
