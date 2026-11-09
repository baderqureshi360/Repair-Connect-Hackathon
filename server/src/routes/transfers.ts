import { Router } from 'express';
import { StockTransfer } from '../models/index.js';
import { authenticate, requireRoles } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { transferCreateSchema } from '../validators/schemas.js';
import { ok } from '../utils/response.js';
import {
  approveTransfer,
  cancelTransfer,
  dispatchTransfer,
  receiveTransfer,
  rejectTransfer,
  requestTransfer,
  serializeTransfer
} from '../services/transfers.js';

const router = Router();
router.use(authenticate);
router.use(requireRoles('parts_coordinator', 'shop_admin'));

router.get('/', async (req, res, next) => {
  try {
    const shopIds = req.user!.shopIds;
    const items = await StockTransfer.find({
      $or: [{ fromShop: { $in: shopIds } }, { toShop: { $in: shopIds } }]
    })
      .sort({ createdAt: -1 })
      .limit(100);
    return ok(
      res,
      items.map((t) => serializeTransfer(t))
    );
  } catch (err) {
    next(err);
  }
});

router.post('/', validate(transferCreateSchema), async (req, res, next) => {
  try {
    const transfer = await requestTransfer({
      user: req.user!,
      fromPartId: req.body.fromPartId,
      toShopId: req.body.toShopId,
      quantity: req.body.quantity,
      reason: req.body.reason,
      repairRequestId: req.body.repairRequestId,
      partsRequestId: req.body.partsRequestId,
      expectedArrivalDate: req.body.expectedArrivalDate,
      expectedArrivalConfirmed: req.body.expectedArrivalConfirmed,
      reserveOnReceive: req.body.reserveOnReceive
    });
    return ok(res, transfer, 201);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/approve', async (req, res, next) => {
  try {
    return ok(res, await approveTransfer(String(req.params.id), req.user!));
  } catch (err) {
    next(err);
  }
});

router.post('/:id/reject', async (req, res, next) => {
  try {
    return ok(res, await rejectTransfer(String(req.params.id), req.user!, req.body?.notes));
  } catch (err) {
    next(err);
  }
});

router.post('/:id/cancel', async (req, res, next) => {
  try {
    return ok(res, await cancelTransfer(String(req.params.id), req.user!, req.body?.notes));
  } catch (err) {
    next(err);
  }
});

router.post('/:id/dispatch', async (req, res, next) => {
  try {
    return ok(res, await dispatchTransfer(String(req.params.id), req.user!));
  } catch (err) {
    next(err);
  }
});

router.post('/:id/receive', async (req, res, next) => {
  try {
    return ok(res, await receiveTransfer(String(req.params.id), req.user!));
  } catch (err) {
    next(err);
  }
});

export default router;
