import { Router } from 'express';
import { authenticate, requireRoles } from '../middleware/auth.js';
import { ok } from '../utils/response.js';
import { getMySupplierApplication } from '../services/supplierApplications.js';

const router = Router();

router.get('/mine', authenticate, requireRoles('supplier'), async (req, res, next) => {
  try {
    const data = await getMySupplierApplication(req.user!.id);
    return ok(res, data);
  } catch (err) {
    next(err);
  }
});

export default router;
