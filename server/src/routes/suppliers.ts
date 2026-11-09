import { Router } from 'express';
import { RestockRequest, Supplier } from '../models/index.js';
import { authenticate, requireRoles } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { restockSchema, supplierSchema } from '../validators/schemas.js';
import { ok } from '../utils/response.js';
import { AppError } from '../utils/errors.js';
import { assertShopAccess } from '../services/repairs.js';
import { stockIn } from '../services/inventory.js';
import { writeAudit } from '../services/audit.js';

const router = Router();
router.use(authenticate);
router.use(requireRoles('parts_coordinator', 'shop_admin'));

router.get('/', async (req, res, next) => {
  try {
    const shopId = String(req.query.shopId || req.user!.shopIds[0]);
    assertShopAccess(req.user!, shopId);
    const items = await Supplier.find({ shop: shopId, isActive: true }).sort({ name: 1 });
    return ok(res, items);
  } catch (err) {
    next(err);
  }
});

router.post('/', validate(supplierSchema), async (req, res, next) => {
  try {
    assertShopAccess(req.user!, req.body.shopId);
    const supplier = await Supplier.create({
      shop: req.body.shopId,
      name: req.body.name,
      contactName: req.body.contactName || '',
      email: req.body.email || '',
      phone: req.body.phone || '',
      address: req.body.address || '',
      notes: req.body.notes || ''
    });
    return ok(res, supplier, 201);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) throw new AppError('Supplier not found', 404, 'NOT_FOUND');
    assertShopAccess(req.user!, supplier.shop.toString());
    Object.assign(supplier, {
      name: req.body.name ?? supplier.name,
      contactName: req.body.contactName ?? supplier.contactName,
      email: req.body.email ?? supplier.email,
      phone: req.body.phone ?? supplier.phone,
      address: req.body.address ?? supplier.address,
      notes: req.body.notes ?? supplier.notes,
      isActive: req.body.isActive ?? supplier.isActive
    });
    await supplier.save();
    return ok(res, supplier);
  } catch (err) {
    next(err);
  }
});

router.get('/restock-requests', async (req, res, next) => {
  try {
    const shopId = String(req.query.shopId || req.user!.shopIds[0]);
    assertShopAccess(req.user!, shopId);
    const items = await RestockRequest.find({ shop: shopId })
      .populate('part', 'sku name quantityAvailable reorderLevel')
      .populate('supplier', 'name phone')
      .sort({ createdAt: -1 })
      .limit(100);
    return ok(res, items);
  } catch (err) {
    next(err);
  }
});

router.post('/restock-requests', validate(restockSchema), async (req, res, next) => {
  try {
    const { Part } = await import('../models/index.js');
    const part = await Part.findById(req.body.partId);
    if (!part) throw new AppError('Part not found', 404, 'NOT_FOUND');
    assertShopAccess(req.user!, part.shop.toString());
    const item = await RestockRequest.create({
      shop: part.shop,
      part: part._id,
      supplier: req.body.supplierId,
      quantity: req.body.quantity,
      requestedBy: req.user!.id,
      notes: req.body.notes || '',
      status: 'requested'
    });
    await writeAudit({
      actor: req.user!.id,
      action: 'restock.request',
      entityType: 'RestockRequest',
      entityId: item._id,
      shop: part.shop
    });
    return ok(res, item, 201);
  } catch (err) {
    next(err);
  }
});

router.post('/restock-requests/:id/receive', async (req, res, next) => {
  try {
    const item = await RestockRequest.findById(req.params.id);
    if (!item) throw new AppError('Restock request not found', 404, 'NOT_FOUND');
    assertShopAccess(req.user!, item.shop.toString());
    if (!['requested', 'ordered'].includes(item.status)) {
      throw new AppError('Restock already closed', 409, 'INVALID_STATE');
    }
    const qty = Number(req.body.quantity || item.quantity);
    await stockIn({
      partId: item.part.toString(),
      quantity: qty,
      userId: req.user!.id,
      notes: `Restock receive ${item._id}`
    });
    item.status = 'received';
    item.receivedQuantity = qty;
    await item.save();
    return ok(res, item);
  } catch (err) {
    next(err);
  }
});

export default router;
