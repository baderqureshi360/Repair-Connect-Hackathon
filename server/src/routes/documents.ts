import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRoles } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ok } from '../utils/response.js';
import {
  getDocumentForUser,
  getOrCreateShopSettings,
  issueDocument,
  listDocumentsForUser,
  recordPayment,
  reversePayment,
  updateShopSettings,
  type DocType
} from '../services/documents.js';
import { assertShopAccess } from '../services/access.js';

const router = Router();
router.use(authenticate);

const issueSchema = z.object({
  repairId: z.string().min(1),
  docType: z.enum([
    'intake_receipt',
    'job_card',
    'estimate',
    'invoice',
    'payment_receipt',
    'warranty',
    'handover'
  ]),
  paymentId: z.string().optional()
});

const paymentSchema = z.object({
  repairId: z.string().min(1),
  amount: z.number().positive(),
  method: z
    .enum(['cash', 'card', 'bank_transfer', 'jazzcash', 'easypaisa', 'mobile_other', 'other'])
    .optional(),
  reference: z.string().max(120).optional(),
  notes: z.string().max(500).optional(),
  idempotencyKey: z.string().min(8).max(120).optional(),
  /** Must be true (default) — payments are never auto-marked received. */
  confirmedReceived: z.boolean().optional().default(true)
});

const reverseSchema = z.object({
  reason: z.string().trim().min(5).max(500),
  /** Omit or null for full remaining reversible amount. */
  amount: z.number().positive().optional(),
  idempotencyKey: z.string().min(8).max(120).optional()
});

const settingsSchema = z.object({
  logoUrl: z.string().max(400_000).nullable().optional(),
  receiptHeader: z.string().max(500).optional(),
  receiptFooter: z.string().max(500).optional(),
  currency: z.string().max(8).optional(),
  taxLabel: z.string().max(40).optional(),
  taxRatePercent: z.number().min(0).max(100).optional(),
  warrantyTerms: z.string().max(2000).optional(),
  defaultPrintFormat: z.enum(['a4', 'thermal80', 'thermal58']).optional(),
  printLanguage: z.enum(['en', 'ur']).optional(),
  businessLegalName: z.string().max(160).optional(),
  contactExtra: z.string().max(200).optional()
});

router.get('/settings/:shopId', requireRoles('shop_admin'), async (req, res, next) => {
  try {
    assertShopAccess(req.user!, String(req.params.shopId));
    return ok(res, await getOrCreateShopSettings(String(req.params.shopId)));
  } catch (err) {
    next(err);
  }
});

router.patch(
  '/settings/:shopId',
  requireRoles('shop_admin'),
  validate(settingsSchema),
  async (req, res, next) => {
    try {
      return ok(res, await updateShopSettings(req.user!, String(req.params.shopId), req.body));
    } catch (err) {
      next(err);
    }
  }
);

router.get('/', async (req, res, next) => {
  try {
    const items = await listDocumentsForUser(req.user!, {
      repairId: req.query.repairId as string | undefined,
      docType: req.query.docType as string | undefined
    });
    return ok(res, items);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    return ok(res, await getDocumentForUser(req.user!, String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

router.post(
  '/issue',
  requireRoles('customer', 'mechanic', 'shop_admin', 'parts_coordinator'),
  validate(issueSchema),
  async (req, res, next) => {
    try {
      const doc = await issueDocument({
        user: req.user!,
        repairId: req.body.repairId,
        docType: req.body.docType as DocType,
        paymentId: req.body.paymentId
      });
      return ok(res, doc, 201);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/payments',
  requireRoles('shop_admin', 'parts_coordinator'),
  validate(paymentSchema),
  async (req, res, next) => {
    try {
      const payment = await recordPayment({
        user: req.user!,
        repairId: req.body.repairId,
        amount: req.body.amount,
        method: req.body.method,
        reference: req.body.reference,
        notes: req.body.notes,
        idempotencyKey: req.body.idempotencyKey,
        confirmedReceived: req.body.confirmedReceived
      });
      return ok(res, payment, 201);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/payments/:id/reverse',
  requireRoles('shop_admin'),
  validate(reverseSchema),
  async (req, res, next) => {
    try {
      const reversal = await reversePayment({
        user: req.user!,
        paymentId: String(req.params.id),
        reason: req.body.reason,
        amount: req.body.amount,
        idempotencyKey: req.body.idempotencyKey
      });
      return ok(res, reversal, 201);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
