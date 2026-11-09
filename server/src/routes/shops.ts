import { Router } from 'express';
import { RepairShop } from '../models/RepairShop.js';
import { authenticate, requireRoles } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { shopCreateSchema } from '../validators/schemas.js';
import { ok, paginated } from '../utils/response.js';
import {
  archiveBlockers,
  archiveShop,
  createShopForAdmin,
  listManagedShops,
  shopHistorySummary
} from '../services/shops.js';
import {
  getPublicShop,
  listPublicShops,
  listServiceCategoriesWithCounts,
  listShopCities
} from '../services/shopDirectory.js';
import { assertShopAccess } from '../services/access.js';
import { writeAudit } from '../services/audit.js';
import { SERVICE_CATEGORY_IDS } from '../constants/serviceCategories.js';

const router = Router();

/** Category catalog with live shop counts (active shops only). */
router.get('/categories', async (_req, res, next) => {
  try {
    return ok(res, await listServiceCategoriesWithCounts());
  } catch (err) {
    next(err);
  }
});

router.get('/cities', async (_req, res, next) => {
  try {
    return ok(res, await listShopCities());
  } catch (err) {
    next(err);
  }
});

/** Public directory of active shops (customer browse / appointments). */
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const openNow =
      String(req.query.openNow || req.query.available || '') === '1' ||
      String(req.query.openNow || '').toLowerCase() === 'true';
    const ids = req.query.ids
      ? String(req.query.ids)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;

    const { items, total } = await listPublicShops({
      page,
      limit,
      q: req.query.q ? String(req.query.q) : undefined,
      city: req.query.city ? String(req.query.city) : undefined,
      category: req.query.category ? String(req.query.category) : undefined,
      brand: req.query.brand ? String(req.query.brand) : undefined,
      device: req.query.device ? String(req.query.device) : undefined,
      openNow: openNow || undefined,
      sort: (req.query.sort as 'name' | 'city' | 'rating') || 'name',
      ids
    });
    return paginated(res, items, { page, limit, total });
  } catch (err) {
    next(err);
  }
});

router.get('/mine', authenticate, requireRoles('shop_admin', 'parts_coordinator', 'mechanic'), async (req, res, next) => {
  try {
    const includeArchived = String(req.query.includeArchived || '') === '1';
    const shops = await listManagedShops(req.user!);
    const filtered = includeArchived ? shops : shops.filter((s) => s.isActive !== false);
    return ok(res, filtered);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/archive-check', authenticate, requireRoles('shop_admin'), async (req, res, next) => {
  try {
    assertShopAccess(req.user!, String(req.params.id));
    return ok(res, await archiveBlockers(String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

router.get('/:id/summary', authenticate, requireRoles('shop_admin'), async (req, res, next) => {
  try {
    return ok(res, await shopHistorySummary(req.user!, String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const publicCard = await getPublicShop(String(req.params.id));
    if (!publicCard) {
      return res.status(404).json({ success: false, error: { message: 'Not found' } });
    }
    return ok(res, publicCard);
  } catch (err) {
    next(err);
  }
});

router.post('/', authenticate, requireRoles('shop_admin'), validate(shopCreateSchema), async (req, res, next) => {
  try {
    const shop = await createShopForAdmin(req.user!, req.body);
    return ok(res, shop, 201);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', authenticate, requireRoles('shop_admin'), async (req, res, next) => {
  try {
    assertShopAccess(req.user!, String(req.params.id));
    const allowed = [
      'name',
      'address',
      'city',
      'region',
      'phone',
      'email',
      'contactPerson',
      'description',
      'dailyCapacity',
      'slotMinutes',
      'operatingHours',
      'cancelPolicyHours',
      'isActive',
      'serviceCategories',
      'supportedBrands',
      'supportedDevices',
      'showPhonePublic',
      'showEmailPublic'
    ];
    const patch: Record<string, unknown> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) patch[key] = req.body[key];
    }
    if (Array.isArray(patch.serviceCategories)) {
      patch.serviceCategories = (patch.serviceCategories as unknown[]).filter(
        (c) => typeof c === 'string' && (SERVICE_CATEGORY_IDS as string[]).includes(c)
      );
    }
    if (Array.isArray(patch.supportedBrands)) {
      patch.supportedBrands = (patch.supportedBrands as unknown[])
        .map((b) => String(b).trim())
        .filter(Boolean)
        .slice(0, 40);
    }
    if (Array.isArray(patch.supportedDevices)) {
      patch.supportedDevices = (patch.supportedDevices as unknown[])
        .map((d) => String(d).trim())
        .filter(Boolean)
        .slice(0, 40);
    }
    // Reactivating clears archive markers.
    if (patch.isActive === true) {
      patch.archivedAt = null;
      patch.archiveReason = '';
    }
    const shopId = String(req.params.id);
    const shop = await RepairShop.findByIdAndUpdate(shopId, patch, {
      new: true,
      runValidators: true
    });
    await writeAudit({
      actor: req.user!.id,
      action: 'shop.update',
      entityType: 'RepairShop',
      entityId: shopId,
      shop: shopId,
      details: { fields: Object.keys(patch) }
    });
    return ok(res, shop);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/archive', authenticate, requireRoles('shop_admin'), async (req, res, next) => {
  try {
    const shop = await archiveShop(req.user!, String(req.params.id), String(req.body?.reason || ''));
    return ok(res, shop);
  } catch (err) {
    next(err);
  }
});

export default router;
