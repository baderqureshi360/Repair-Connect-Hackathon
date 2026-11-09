import { Router } from 'express';
import { InventoryMovement, Part, PartsRequest, PartsReservation } from '../models/index.js';
import { authenticate, requireRoles } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  adjustStockSchema,
  partCreateSchema,
  partUpdateSchema,
  reserveSchema,
  stockInSchema
} from '../validators/schemas.js';
import { ok, paginated } from '../utils/response.js';
import { AppError } from '../utils/errors.js';
import { assertShopAccess } from '../services/repairs.js';
import { adjustStock, releaseReservation, reserveStock, stockIn } from '../services/inventory.js';
import { writeAudit } from '../services/audit.js';

const router = Router();
router.use(authenticate);

router.get('/', requireRoles('parts_coordinator', 'shop_admin', 'mechanic'), async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const shopId = (req.query.shopId as string) || req.user!.shopIds[0];
    assertShopAccess(req.user!, shopId);

    const filter: Record<string, unknown> = { shop: shopId, isActive: true };
    if (req.query.lowStock === 'true') {
      filter.$expr = { $lte: ['$quantityAvailable', '$reorderLevel'] };
    }
    if (req.query.q) {
      filter.$or = [
        { name: new RegExp(String(req.query.q), 'i') },
        { sku: new RegExp(String(req.query.q), 'i') }
      ];
    }

    const [items, total] = await Promise.all([
      Part.find(filter).sort({ name: 1 }).skip((page - 1) * limit).limit(limit),
      Part.countDocuments(filter)
    ]);
    return paginated(res, items, { page, limit, total });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRoles('parts_coordinator', 'shop_admin'), validate(partCreateSchema), async (req, res, next) => {
  try {
    assertShopAccess(req.user!, req.body.shopId);
    const part = await Part.create({
      ...req.body,
      shop: req.body.shopId,
      sku: req.body.sku.toUpperCase()
    });
    await writeAudit({
      actor: req.user!.id,
      action: 'part.create',
      entityType: 'Part',
      entityId: part._id,
      shop: part.shop
    });
    return ok(res, part, 201);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requireRoles('parts_coordinator', 'shop_admin'), validate(partUpdateSchema), async (req, res, next) => {
  try {
    const existing = await Part.findById(req.params.id);
    if (!existing) throw new AppError('Part not found', 404, 'NOT_FOUND');
    assertShopAccess(req.user!, existing.shop.toString());
    Object.assign(existing, req.body);
    if (req.body.sku) existing.sku = req.body.sku.toUpperCase();
    await existing.save();
    return ok(res, existing);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireRoles('parts_coordinator', 'shop_admin'), async (req, res, next) => {
  try {
    const existing = await Part.findById(req.params.id);
    if (!existing) throw new AppError('Part not found', 404, 'NOT_FOUND');
    assertShopAccess(req.user!, existing.shop.toString());
    existing.isActive = false;
    await existing.save();
    return ok(res, existing);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/stock-in', requireRoles('parts_coordinator', 'shop_admin'), validate(stockInSchema), async (req, res, next) => {
  try {
    const existing = await Part.findById(req.params.id);
    if (!existing) throw new AppError('Part not found', 404, 'NOT_FOUND');
    assertShopAccess(req.user!, existing.shop.toString());
    const part = await stockIn({
      partId: String(req.params.id),
      quantity: req.body.quantity,
      userId: req.user!.id,
      notes: req.body.notes
    });
    return ok(res, part);
  } catch (err) {
    next(err);
  }
});

router.post(
  '/:id/adjust',
  requireRoles('parts_coordinator', 'shop_admin'),
  validate(adjustStockSchema),
  async (req, res, next) => {
    try {
      const existing = await Part.findById(req.params.id);
      if (!existing) throw new AppError('Part not found', 404, 'NOT_FOUND');
      assertShopAccess(req.user!, existing.shop.toString());
      const part = await adjustStock({
        partId: String(req.params.id),
        quantityDelta: req.body.quantityDelta,
        reason: req.body.reason,
        userId: req.user!.id
      });
      return ok(res, part);
    } catch (err) {
      next(err);
    }
  }
);

router.get('/requests/incoming', requireRoles('parts_coordinator', 'shop_admin'), async (req, res, next) => {
  try {
    const shopId = (req.query.shopId as string) || req.user!.shopIds[0];
    assertShopAccess(req.user!, shopId);
    const status = req.query.status ? String(req.query.status) : undefined;
    const filter: Record<string, unknown> = { shop: shopId };
    if (status) filter.status = status;
    else filter.status = { $in: ['pending', 'partially_fulfilled'] };

    const items = await PartsRequest.find(filter)
      .populate('part', 'sku name quantityAvailable quantityReserved')
      .populate('repairRequest', 'referenceNumber deviceType brand model status')
      .populate('requestedBy', 'name')
      .sort({ createdAt: -1 });
    return ok(res, items);
  } catch (err) {
    next(err);
  }
});

router.post(
  '/requests/:id/reserve',
  requireRoles('parts_coordinator', 'shop_admin'),
  validate(reserveSchema),
  async (req, res, next) => {
    try {
      const pr = await PartsRequest.findById(req.params.id);
      if (!pr) throw new AppError('Parts request not found', 404, 'NOT_FOUND');
      assertShopAccess(req.user!, pr.shop.toString());
      const result = await reserveStock({
        partsRequestId: String(req.params.id),
        quantity: req.body.quantity,
        userId: req.user!.id
      });
      return ok(res, result);
    } catch (err) {
      next(err);
    }
  }
);

router.post('/requests/:id/reject', requireRoles('parts_coordinator', 'shop_admin'), async (req, res, next) => {
  try {
    const pr = await PartsRequest.findById(req.params.id);
    if (!pr) throw new AppError('Parts request not found', 404, 'NOT_FOUND');
    assertShopAccess(req.user!, pr.shop.toString());
    pr.status = 'rejected';
    pr.rejectionReason = req.body.reason || 'Rejected by parts coordinator';
    await pr.save();
    return ok(res, pr);
  } catch (err) {
    next(err);
  }
});

router.post('/reservations/:id/release', requireRoles('parts_coordinator', 'shop_admin'), async (req, res, next) => {
  try {
    const reservation = await PartsReservation.findById(req.params.id);
    if (!reservation) throw new AppError('Reservation not found', 404, 'NOT_FOUND');
    assertShopAccess(req.user!, reservation.shop.toString());
    const result = await releaseReservation({
      reservationId: String(req.params.id),
      userId: req.user!.id
    });
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.get('/movements', requireRoles('parts_coordinator', 'shop_admin'), async (req, res, next) => {
  try {
    const shopId = (req.query.shopId as string) || req.user!.shopIds[0];
    assertShopAccess(req.user!, shopId);
    const items = await InventoryMovement.find({ shop: shopId })
      .populate('part', 'sku name')
      .populate('performedBy', 'name')
      .sort({ createdAt: -1 })
      .limit(100);
    return ok(res, items);
  } catch (err) {
    next(err);
  }
});

export default router;
