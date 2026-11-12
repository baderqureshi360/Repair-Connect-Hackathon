import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, requireRoles } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ok } from '../utils/response.js';
import {
  listConversationsForShop,
  listConversationsForSupplier,
  listMessages,
  postMessage,
  startOrGetConversation
} from '../services/supplierConversations.js';
import {
  cancelRfq,
  createRfq,
  getRfqForActor,
  listShopRfqs,
  listSupplierRfqs,
  sendRfq,
  updateDraftRfq
} from '../services/supplierRfqs.js';
import {
  acceptQuotation,
  compareQuotations,
  submitQuotation,
  withdrawQuotation
} from '../services/supplierQuotations.js';
import {
  acknowledgePurchaseOrder,
  amendPurchaseOrder,
  cancelPurchaseOrder,
  createPurchaseOrderFromQuotation,
  getPurchaseOrder,
  getPurchaseOrderPrintData,
  issuePurchaseOrder,
  listReceivablePurchaseOrders,
  listShopPurchaseOrders,
  listSupplierPurchaseOrders,
  rejectPurchaseOrder
} from '../services/supplierPurchaseOrders.js';
import {
  createShipment,
  dispatchShipment,
  listShipmentsForPo,
  markShipmentDelayed,
  updateShipmentArrival
} from '../services/supplierShipments.js';
import {
  getGoodsReceipt,
  getGoodsReceiptPrintData,
  listGoodsReceipts,
  postGoodsReceipt
} from '../services/supplierGoodsReceiving.js';
import {
  getSupplierBalance,
  listLedgerEntries,
  recordSupplierCreditNote,
  recordSupplierInvoice,
  recordSupplierPayment,
  reverseLedgerEntry
} from '../services/supplierLedger.js';
import { purchasingReportsBundle } from '../services/supplierPurchasingReports.js';
import {
  exportShopPurchasingAnalyticsCsv,
  shopPurchasingAnalytics,
  type AnalyticsExportKind
} from '../services/supplierPurchasingAnalytics.js';
import { AppError } from '../utils/errors.js';

const router = Router();
const isTest = process.env.NODE_ENV === 'test';

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 10_000 : 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Too many requests', code: 'RATE_LIMITED' } }
});

router.use(authenticate, requireRoles('shop_admin', 'supplier', 'parts_coordinator'));

const attachmentSchema = z.object({
  name: z.string().max(160).optional(),
  dataUrl: z.string().min(1).max(400_000),
  contentType: z.string().max(120).optional()
});

const startConversationSchema = z.object({
  shopId: z.string().min(1),
  supplierBusinessId: z.string().min(1),
  subject: z.string().max(200).optional()
});

const postMessageSchema = z.object({
  body: z.string().min(1).max(4000),
  visibility: z.enum(['participant_visible', 'shop_internal']).optional(),
  attachments: z.array(attachmentSchema).max(5).optional()
});

const rfqItemSchema = z.object({
  lineId: z.string().optional(),
  name: z.string().min(2).max(160),
  sku: z.string().max(80).optional(),
  manufacturerPartNumber: z.string().max(80).optional(),
  catalogItem: z.string().optional(),
  quantity: z.number().int().min(1),
  specifications: z.string().max(2000).optional(),
  notes: z.string().max(1000).optional()
});

const createRfqSchema = z.object({
  shopId: z.string().min(1),
  title: z.string().min(2).max(200),
  additionalRequirements: z.string().max(4000).optional(),
  requiredDeliveryDate: z.string().optional(),
  expiresAt: z.string().optional(),
  supplierBusinessIds: z.array(z.string().min(1)).min(1).max(20),
  items: z.array(rfqItemSchema).min(1).max(50),
  attachments: z.array(attachmentSchema).max(5).optional(),
  send: z.boolean().optional()
});

const quoteLineSchema = z.object({
  rfqLineId: z.string().min(1),
  unitPrice: z.number().min(0),
  availableQuantity: z.number().int().min(0),
  quotedQuantity: z.number().int().min(0),
  moq: z.number().int().min(1).optional(),
  unavailable: z.boolean().optional(),
  isAlternative: z.boolean().optional(),
  alternativeName: z.string().max(160).optional(),
  alternativeSku: z.string().max(80).optional(),
  warranty: z.string().max(200).optional(),
  notes: z.string().max(1000).optional()
});

const submitQuoteSchema = z.object({
  lines: z.array(quoteLineSchema).min(1).max(50),
  deliveryCharges: z.number().min(0).optional(),
  taxAmount: z.number().min(0).optional(),
  taxPercent: z.number().min(0).max(100).optional(),
  estimatedDeliveryDate: z.string().optional(),
  warranty: z.string().max(200).optional(),
  validityUntil: z.string().optional(),
  notes: z.string().max(2000).optional(),
  currency: z.string().max(8).optional()
});

const reasonSchema = z.object({ reason: z.string().min(5).max(1000) });

const acceptSchema = z.object({
  quotationId: z.string().min(1),
  acceptedLineIds: z.array(z.string()).max(50).optional()
});

/** Conversations */
router.get('/conversations', async (req, res, next) => {
  try {
    if (req.user!.role === 'supplier') {
      return ok(res, await listConversationsForSupplier(req.user!));
    }
    const shopId = String(req.query.shopId || req.user!.shopIds[0] || '');
    return ok(res, await listConversationsForShop(req.user!, shopId));
  } catch (err) {
    next(err);
  }
});

router.post('/conversations', writeLimiter, validate(startConversationSchema), async (req, res, next) => {
  try {
    if (req.user!.role !== 'shop_admin') {
      return res.status(403).json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } });
    }
    return ok(res, await startOrGetConversation({ user: req.user!, ...req.body }), 201);
  } catch (err) {
    next(err);
  }
});

router.get('/conversations/:id/messages', async (req, res, next) => {
  try {
    return ok(res, await listMessages(req.user!, String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

router.post(
  '/conversations/:id/messages',
  writeLimiter,
  validate(postMessageSchema),
  async (req, res, next) => {
    try {
      return ok(
        res,
        await postMessage({
          user: req.user!,
          conversationId: String(req.params.id),
          ...req.body
        }),
        201
      );
    } catch (err) {
      next(err);
    }
  }
);

/** RFQs */
router.get('/rfqs', async (req, res, next) => {
  try {
    const status = req.query.status ? String(req.query.status) : undefined;
    if (req.user!.role === 'supplier') {
      return ok(res, await listSupplierRfqs(req.user!, status));
    }
    const shopId = String(req.query.shopId || req.user!.shopIds[0] || '');
    return ok(res, await listShopRfqs(req.user!, shopId, status));
  } catch (err) {
    next(err);
  }
});

router.post('/rfqs', writeLimiter, validate(createRfqSchema), async (req, res, next) => {
  try {
    if (req.user!.role !== 'shop_admin') {
      return res.status(403).json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } });
    }
    return ok(res, await createRfq({ user: req.user!, ...req.body }), 201);
  } catch (err) {
    next(err);
  }
});

router.get('/rfqs/:id', async (req, res, next) => {
  try {
    return ok(res, await getRfqForActor(req.user!, String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

router.patch('/rfqs/:id', writeLimiter, async (req, res, next) => {
  try {
    if (req.user!.role !== 'shop_admin') {
      return res.status(403).json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } });
    }
    return ok(res, await updateDraftRfq(req.user!, String(req.params.id), req.body));
  } catch (err) {
    next(err);
  }
});

router.post('/rfqs/:id/send', writeLimiter, async (req, res, next) => {
  try {
    if (req.user!.role !== 'shop_admin') {
      return res.status(403).json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } });
    }
    return ok(res, await sendRfq(req.user!, String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

router.post('/rfqs/:id/cancel', writeLimiter, validate(reasonSchema), async (req, res, next) => {
  try {
    if (req.user!.role !== 'shop_admin') {
      return res.status(403).json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } });
    }
    return ok(res, await cancelRfq(req.user!, String(req.params.id), req.body.reason));
  } catch (err) {
    next(err);
  }
});

router.get('/rfqs/:id/compare', async (req, res, next) => {
  try {
    if (req.user!.role !== 'shop_admin') {
      return res.status(403).json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } });
    }
    return ok(res, await compareQuotations(req.user!, String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

router.post('/rfqs/:id/accept', writeLimiter, validate(acceptSchema), async (req, res, next) => {
  try {
    if (req.user!.role !== 'shop_admin') {
      return res.status(403).json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } });
    }
    return ok(
      res,
      await acceptQuotation({
        user: req.user!,
        rfqId: String(req.params.id),
        quotationId: req.body.quotationId,
        acceptedLineIds: req.body.acceptedLineIds
      })
    );
  } catch (err) {
    next(err);
  }
});

router.post(
  '/rfqs/:id/quotations',
  writeLimiter,
  validate(submitQuoteSchema),
  async (req, res, next) => {
    try {
      if (req.user!.role !== 'supplier') {
        return res.status(403).json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } });
      }
      return ok(
        res,
        await submitQuotation({
          user: req.user!,
          rfqId: String(req.params.id),
          ...req.body
        }),
        201
      );
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/quotations/:id/withdraw',
  writeLimiter,
  validate(reasonSchema),
  async (req, res, next) => {
    try {
      if (req.user!.role !== 'supplier') {
        return res.status(403).json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } });
      }
      return ok(
        res,
        await withdrawQuotation({
          user: req.user!,
          quotationId: String(req.params.id),
          reason: req.body.reason
        })
      );
    } catch (err) {
      next(err);
    }
  }
);

/** —— Phase 4: Purchase orders —— */
const createPoSchema = z.object({
  rfqId: z.string().min(1),
  quotationId: z.string().optional(),
  acceptedLineIds: z.array(z.string()).max(50).optional(),
  deliveryAddress: z.string().max(500).optional(),
  expectedDeliveryDate: z.string().optional(),
  terms: z.string().max(4000).optional(),
  notes: z.string().max(4000).optional(),
  attachments: z.array(attachmentSchema).max(5).optional(),
  issue: z.boolean().optional()
});

const amendPoSchema = z.object({
  reason: z.string().min(5).max(1000),
  deliveryAddress: z.string().max(500).optional(),
  expectedDeliveryDate: z.string().nullable().optional(),
  terms: z.string().max(4000).optional(),
  notes: z.string().max(4000).optional(),
  deliveryCharges: z.number().min(0).optional(),
  discountAmount: z.number().min(0).optional(),
  lines: z
    .array(
      z.object({
        lineId: z.string().min(1),
        quantityOrdered: z.number().int().min(1).optional(),
        unitPrice: z.number().min(0).optional(),
        notes: z.string().max(1000).optional()
      })
    )
    .max(50)
    .optional()
});

const ackSchema = z.object({
  expectedDispatchDate: z.string().optional(),
  expectedDeliveryDate: z.string().optional(),
  notes: z.string().max(2000).optional()
});

const shipmentSchema = z.object({
  purchaseOrderId: z.string().min(1),
  carrier: z.string().max(120).optional(),
  trackingNumber: z.string().max(120).optional(),
  expectedArrivalDate: z.string().optional(),
  notes: z.string().max(2000).optional(),
  lines: z
    .array(z.object({ poLineId: z.string().min(1), quantity: z.number().int().min(1) }))
    .min(1)
    .max(50),
  attachments: z.array(attachmentSchema).max(5).optional(),
  dispatch: z.boolean().optional()
});

const grnSchema = z.object({
  purchaseOrderId: z.string().min(1),
  shipmentId: z.string().optional(),
  notes: z.string().max(2000).optional(),
  idempotencyKey: z.string().min(8).max(120).optional(),
  lines: z
    .array(
      z.object({
        poLineId: z.string().min(1),
        quantityAccepted: z.number().int().min(0),
        quantityRejected: z.number().int().min(0).optional(),
        quantityDamaged: z.number().int().min(0).optional(),
        quantityShort: z.number().int().min(0).optional(),
        rejectReason: z.string().max(500).optional(),
        damageReason: z.string().max(500).optional(),
        shopPartId: z.string().optional()
      })
    )
    .min(1)
    .max(50)
});

const invoiceSchema = z.object({
  shopId: z.string().min(1),
  supplierBusinessId: z.string().min(1),
  purchaseOrderId: z.string().optional(),
  amount: z.number().positive(),
  externalReference: z.string().min(1).max(120),
  notes: z.string().max(1000).optional(),
  idempotencyKey: z.string().min(8).max(120).optional()
});

const paymentSchema = z.object({
  shopId: z.string().min(1),
  supplierBusinessId: z.string().min(1),
  purchaseOrderId: z.string().optional(),
  amount: z.number().positive(),
  paymentMethod: z.enum(['cash', 'bank_transfer', 'cheque', 'jazzcash', 'easypaisa', 'other']),
  externalReference: z.string().max(120).optional(),
  paidAt: z.string().optional(),
  notes: z.string().max(1000).optional(),
  idempotencyKey: z.string().min(8).max(120).optional()
});

const creditNoteSchema = z.object({
  shopId: z.string().min(1),
  supplierBusinessId: z.string().min(1),
  purchaseOrderId: z.string().optional(),
  amount: z.number().positive(),
  externalReference: z.string().max(120).optional(),
  notes: z.string().max(1000).optional(),
  idempotencyKey: z.string().min(8).max(120).optional()
});

router.get('/purchase-orders', async (req, res, next) => {
  try {
    const status = req.query.status ? String(req.query.status) : undefined;
    if (req.user!.role === 'supplier') {
      return ok(res, await listSupplierPurchaseOrders(req.user!, status));
    }
    const shopId = String(req.query.shopId || req.user!.shopIds[0] || '');
    if (req.user!.role === 'parts_coordinator') {
      return ok(res, await listReceivablePurchaseOrders(req.user!, shopId, status));
    }
    return ok(res, await listShopPurchaseOrders(req.user!, shopId, status));
  } catch (err) {
    next(err);
  }
});

router.post('/purchase-orders', writeLimiter, validate(createPoSchema), async (req, res, next) => {
  try {
    if (req.user!.role !== 'shop_admin') {
      return res.status(403).json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } });
    }
    return ok(res, await createPurchaseOrderFromQuotation({ user: req.user!, ...req.body }), 201);
  } catch (err) {
    next(err);
  }
});

router.get('/purchase-orders/:id', async (req, res, next) => {
  try {
    return ok(res, await getPurchaseOrder(req.user!, String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

router.get('/purchase-orders/:id/print', async (req, res, next) => {
  try {
    return ok(res, await getPurchaseOrderPrintData(req.user!, String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

router.post('/purchase-orders/:id/issue', writeLimiter, async (req, res, next) => {
  try {
    if (req.user!.role !== 'shop_admin') {
      return res.status(403).json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } });
    }
    return ok(res, await issuePurchaseOrder(req.user!, String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

router.post('/purchase-orders/:id/acknowledge', writeLimiter, validate(ackSchema), async (req, res, next) => {
  try {
    if (req.user!.role !== 'supplier') {
      return res.status(403).json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } });
    }
    return ok(res, await acknowledgePurchaseOrder(req.user!, String(req.params.id), req.body));
  } catch (err) {
    next(err);
  }
});

router.post('/purchase-orders/:id/reject', writeLimiter, validate(reasonSchema), async (req, res, next) => {
  try {
    if (req.user!.role !== 'supplier') {
      return res.status(403).json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } });
    }
    return ok(res, await rejectPurchaseOrder(req.user!, String(req.params.id), req.body.reason));
  } catch (err) {
    next(err);
  }
});

router.post('/purchase-orders/:id/cancel', writeLimiter, validate(reasonSchema), async (req, res, next) => {
  try {
    if (req.user!.role !== 'shop_admin') {
      return res.status(403).json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } });
    }
    return ok(res, await cancelPurchaseOrder(req.user!, String(req.params.id), req.body.reason));
  } catch (err) {
    next(err);
  }
});

router.post('/purchase-orders/:id/amend', writeLimiter, validate(amendPoSchema), async (req, res, next) => {
  try {
    if (req.user!.role !== 'shop_admin') {
      return res.status(403).json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } });
    }
    return ok(res, await amendPurchaseOrder(req.user!, String(req.params.id), req.body));
  } catch (err) {
    next(err);
  }
});

router.get('/purchase-orders/:id/shipments', async (req, res, next) => {
  try {
    return ok(res, await listShipmentsForPo(req.user!, String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

router.post('/shipments', writeLimiter, validate(shipmentSchema), async (req, res, next) => {
  try {
    if (req.user!.role !== 'supplier') {
      return res.status(403).json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } });
    }
    return ok(res, await createShipment({ user: req.user!, ...req.body }), 201);
  } catch (err) {
    next(err);
  }
});

router.post('/shipments/:id/dispatch', writeLimiter, async (req, res, next) => {
  try {
    if (req.user!.role !== 'supplier') {
      return res.status(403).json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } });
    }
    return ok(res, await dispatchShipment(req.user!, String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

router.post('/shipments/:id/delay', writeLimiter, validate(reasonSchema), async (req, res, next) => {
  try {
    if (req.user!.role !== 'supplier') {
      return res.status(403).json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } });
    }
    return ok(res, await markShipmentDelayed(req.user!, String(req.params.id), req.body.reason));
  } catch (err) {
    next(err);
  }
});

router.patch('/shipments/:id', writeLimiter, async (req, res, next) => {
  try {
    return ok(res, await updateShipmentArrival(req.user!, String(req.params.id), req.body || {}));
  } catch (err) {
    next(err);
  }
});

router.post('/goods-receipts', writeLimiter, validate(grnSchema), async (req, res, next) => {
  try {
    if (!['shop_admin', 'parts_coordinator'].includes(req.user!.role)) {
      return res.status(403).json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } });
    }
    return ok(res, await postGoodsReceipt({ user: req.user!, ...req.body }), 201);
  } catch (err) {
    next(err);
  }
});

router.get('/purchase-orders/:id/goods-receipts', async (req, res, next) => {
  try {
    if (!['shop_admin', 'parts_coordinator'].includes(req.user!.role)) {
      return res.status(403).json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } });
    }
    return ok(res, await listGoodsReceipts(req.user!, String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

router.get('/goods-receipts/:id', async (req, res, next) => {
  try {
    return ok(res, await getGoodsReceipt(req.user!, String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

router.get('/goods-receipts/:id/print', async (req, res, next) => {
  try {
    return ok(res, await getGoodsReceiptPrintData(req.user!, String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

router.get('/ledger', async (req, res, next) => {
  try {
    return ok(
      res,
      await listLedgerEntries(req.user!, {
        shopId: req.query.shopId ? String(req.query.shopId) : undefined,
        supplierBusinessId: req.query.supplierBusinessId
          ? String(req.query.supplierBusinessId)
          : undefined,
        purchaseOrderId: req.query.purchaseOrderId ? String(req.query.purchaseOrderId) : undefined
      })
    );
  } catch (err) {
    next(err);
  }
});

router.get('/ledger/balance', async (req, res, next) => {
  try {
    if (req.user!.role !== 'shop_admin') {
      return res.status(403).json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } });
    }
    const shopId = String(req.query.shopId || req.user!.shopIds[0] || '');
    const supplierBusinessId = String(req.query.supplierBusinessId || '');
    return ok(res, await getSupplierBalance(req.user!, shopId, supplierBusinessId));
  } catch (err) {
    next(err);
  }
});

router.post('/ledger/invoices', writeLimiter, validate(invoiceSchema), async (req, res, next) => {
  try {
    if (req.user!.role !== 'shop_admin') {
      return res.status(403).json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } });
    }
    return ok(res, await recordSupplierInvoice({ user: req.user!, ...req.body }), 201);
  } catch (err) {
    next(err);
  }
});

router.post('/ledger/payments', writeLimiter, validate(paymentSchema), async (req, res, next) => {
  try {
    if (req.user!.role !== 'shop_admin') {
      return res.status(403).json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } });
    }
    return ok(res, await recordSupplierPayment({ user: req.user!, ...req.body }), 201);
  } catch (err) {
    next(err);
  }
});

router.post('/ledger/credit-notes', writeLimiter, validate(creditNoteSchema), async (req, res, next) => {
  try {
    if (req.user!.role !== 'shop_admin') {
      return res.status(403).json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } });
    }
    return ok(res, await recordSupplierCreditNote({ user: req.user!, ...req.body }), 201);
  } catch (err) {
    next(err);
  }
});

router.post('/ledger/:id/reverse', writeLimiter, validate(reasonSchema), async (req, res, next) => {
  try {
    if (req.user!.role !== 'shop_admin') {
      return res.status(403).json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } });
    }
    return ok(
      res,
      await reverseLedgerEntry({ user: req.user!, entryId: String(req.params.id), reason: req.body.reason })
    );
  } catch (err) {
    next(err);
  }
});

router.get('/purchasing-reports', async (req, res, next) => {
  try {
    if (req.user!.role !== 'shop_admin') {
      return res.status(403).json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } });
    }
    const shopId = String(req.query.shopId || req.user!.shopIds[0] || '');
    return ok(
      res,
      await purchasingReportsBundle(req.user!, shopId, {
        from: req.query.from ? String(req.query.from) : undefined,
        to: req.query.to ? String(req.query.to) : undefined
      })
    );
  } catch (err) {
    next(err);
  }
});

router.get('/purchasing-analytics', async (req, res, next) => {
  try {
    if (req.user!.role !== 'shop_admin') {
      return res.status(403).json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } });
    }
    const shopId = String(req.query.shopId || req.user!.shopIds[0] || '');
    return ok(
      res,
      await shopPurchasingAnalytics(req.user!, {
        shopId,
        from: req.query.from ? String(req.query.from) : undefined,
        to: req.query.to ? String(req.query.to) : undefined,
        supplierBusinessId: req.query.supplierBusinessId
          ? String(req.query.supplierBusinessId)
          : undefined,
        status: req.query.status ? String(req.query.status) : undefined,
        productQ: req.query.productQ ? String(req.query.productQ) : undefined,
        category: req.query.category ? String(req.query.category) : undefined
      })
    );
  } catch (err) {
    next(err);
  }
});

const EXPORT_KINDS = new Set([
  'supplier_purchasing',
  'purchase_order_summary',
  'goods_receiving',
  'supplier_payables',
  'supplier_performance',
  'product_purchasing_history'
]);

router.get('/purchasing-analytics/export.csv', async (req, res, next) => {
  try {
    if (req.user!.role !== 'shop_admin') {
      return res.status(403).json({ success: false, error: { message: 'Forbidden', code: 'FORBIDDEN' } });
    }
    const kind = String(req.query.report || '');
    if (!EXPORT_KINDS.has(kind)) {
      throw new AppError('Invalid report kind', 400, 'INVALID_EXPORT');
    }
    const shopId = String(req.query.shopId || req.user!.shopIds[0] || '');
    const exported = await exportShopPurchasingAnalyticsCsv(req.user!, kind as AnalyticsExportKind, {
      shopId,
      from: req.query.from ? String(req.query.from) : undefined,
      to: req.query.to ? String(req.query.to) : undefined,
      supplierBusinessId: req.query.supplierBusinessId
        ? String(req.query.supplierBusinessId)
        : undefined,
      status: req.query.status ? String(req.query.status) : undefined,
      productQ: req.query.productQ ? String(req.query.productQ) : undefined,
      category: req.query.category ? String(req.query.category) : undefined
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
    res.status(200).send(exported.csv);
  } catch (err) {
    next(err);
  }
});

export default router;
