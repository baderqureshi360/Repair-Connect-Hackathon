import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { ok } from '../utils/response.js';
import { globalSearch } from '../services/search.js';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const q = String(req.query.q || '');
    const limit = Math.min(Number(req.query.limit) || 8, 20);
    const data = await globalSearch(req.user!, q, limit);
    return ok(res, data);
  } catch (err) {
    next(err);
  }
});

export default router;
