import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, requireRoles } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ok } from '../utils/response.js';
import {
  adjustCatalogStock,
  archiveCatalogItem,
  createCatalogItem,
  deleteCatalogItem,
  getMyCatalogItem,
  getMySupplierBusiness,
  listMyCatalog,
  listStockMovements,
  setCatalogItemActive,
  updateCatalogItem,
  updateMySupplierBusiness
} from '../services/supplierPortal.js';
import { PART_CATEGORY_IDS } from '../constants/partCategories.js';
import { SUPPLIER_PRODUCT_CONDITIONS } from '../models/SupplierCatalogItem.js';
import { SUPPLIER_STOCK_ACTIONS } from '../models/SupplierStockMovement.js';
import { getMySupplierPerformance } from '../services/supplierPerformance.js';
import {
  listSupplierOwnReviews,
  respondToSupplierReview
} from '../services/supplierReviews.js';
import { supplierBusinessAnalytics } from '../services/supplierPurchasingAnalytics.js';

const router = Router();
const isTest = process.env.NODE_ENV === 'test';

const catalogWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 10_000 : 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Too many catalog writes', code: 'RATE_LIMITED' } }
});

const stockLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 10_000 : 180,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Too many stock updates', code: 'RATE_LIMITED' } }
});

router.use(authenticate, requireRoles('supplier'));

const partCategoryEnum = z.enum(PART_CATEGORY_IDS as [string, ...string[]]);
const conditionEnum = z.enum(SUPPLIER_PRODUCT_CONDITIONS as unknown as [string, ...string[]]);
const stockActionEnum = z.enum(SUPPLIER_STOCK_ACTIONS as unknown as [string, ...string[]]);

const imageSchema = z.object({
  name: z.string().max(160).optional(),
  dataUrl: z.string().min(1).max(400_000)
});

const updateBusinessSchema = z.object({
  description: z.string().max(2000).optional(),
  businessPhone: z.string().min(5).max(40).optional(),
  contactPerson: z.string().min(2).max(120).optional(),
  address: z.string().min(5).max(300).optional(),
  logoUrl: z.string().max(400_000).optional(),
  supportedBrands: z.array(z.string().min(1).max(60)).max(40).optional(),
  deliveryCities: z.array(z.string().min(1).max(80)).max(40).optional(),
  partCategories: z.array(partCategoryEnum).max(12).optional(),
  availability: z.enum(['available', 'limited', 'unavailable']).optional()
});

const catalogCreateSchema = z.object({
  name: z.string().min(2).max(160),
  sku: z.string().max(80).optional(),
  manufacturerPartNumber: z.string().max(80).optional(),
  category: partCategoryEnum,
  brand: z.string().max(80).optional(),
  compatibleModels: z.array(z.string().min(1).max(80)).max(60).optional(),
  description: z.string().max(4000).optional(),
  condition: conditionEnum.optional(),
  warranty: z.string().max(200).optional(),
  images: z.array(imageSchema).max(6).optional(),
  unitPrice: z.number().min(0).optional(),
  currency: z.string().max(8).optional(),
  quantityAvailable: z.number().int().min(0).optional(),
  minOrderQuantity: z.number().int().min(1).optional(),
  leadTimeDays: z.number().int().min(0).max(365).optional(),
  lowStockThreshold: z.number().int().min(0).optional(),
  discontinued: z.boolean().optional(),
  isActive: z.boolean().optional(),
  // Never accept ownership fields from client
  supplierBusiness: z.undefined().optional(),
  supplierBusinessId: z.undefined().optional(),
  ownerId: z.undefined().optional()
});

const catalogUpdateSchema = catalogCreateSchema.partial();

const stockAdjustSchema = z.object({
  action: stockActionEnum,
  quantity: z.number().int().min(0),
  expectedQuantity: z.number().int().min(0).optional(),
  expectedVersion: z.number().int().min(0).optional(),
  notes: z.string().max(500).optional(),
  discontinued: z.boolean().optional()
});

const activeBodySchema = z.object({
  isActive: z.boolean()
});

router.get('/me', async (req, res, next) => {
  try {
    return ok(res, await getMySupplierBusiness(req.user!.id));
  } catch (err) {
    next(err);
  }
});

router.patch('/me', validate(updateBusinessSchema), async (req, res, next) => {
  try {
    return ok(res, await updateMySupplierBusiness(req.user!.id, req.body));
  } catch (err) {
    next(err);
  }
});

router.get('/catalog', async (req, res, next) => {
  try {
    return ok(
      res,
      await listMyCatalog(req.user!.id, {
        q: req.query.q ? String(req.query.q) : undefined,
        category: req.query.category ? String(req.query.category) : undefined,
        stockStatus: req.query.stockStatus ? String(req.query.stockStatus) : undefined,
        includeArchived: String(req.query.includeArchived || '') === 'true',
        sort: req.query.sort ? String(req.query.sort) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        skip: req.query.skip ? Number(req.query.skip) : undefined
      })
    );
  } catch (err) {
    next(err);
  }
});

router.post('/catalog', catalogWriteLimiter, validate(catalogCreateSchema), async (req, res, next) => {
  try {
    return ok(res, await createCatalogItem(req.user!.id, req.body), 201);
  } catch (err) {
    next(err);
  }
});

router.get('/catalog/:id', async (req, res, next) => {
  try {
    return ok(res, await getMyCatalogItem(req.user!.id, String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

router.patch('/catalog/:id', catalogWriteLimiter, validate(catalogUpdateSchema), async (req, res, next) => {
  try {
    return ok(res, await updateCatalogItem(req.user!.id, String(req.params.id), req.body));
  } catch (err) {
    next(err);
  }
});

router.post('/catalog/:id/activate', catalogWriteLimiter, validate(activeBodySchema), async (req, res, next) => {
  try {
    return ok(res, await setCatalogItemActive(req.user!.id, String(req.params.id), Boolean(req.body.isActive)));
  } catch (err) {
    next(err);
  }
});

router.post('/catalog/:id/archive', catalogWriteLimiter, async (req, res, next) => {
  try {
    return ok(res, await archiveCatalogItem(req.user!.id, String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

router.delete('/catalog/:id', catalogWriteLimiter, async (req, res, next) => {
  try {
    return ok(res, await deleteCatalogItem(req.user!.id, String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

router.post(
  '/catalog/:id/stock',
  stockLimiter,
  validate(stockAdjustSchema),
  async (req, res, next) => {
    try {
      return ok(res, await adjustCatalogStock(req.user!.id, String(req.params.id), req.body));
    } catch (err) {
      next(err);
    }
  }
);

router.get('/catalog/:id/stock-movements', async (req, res, next) => {
  try {
    return ok(
      res,
      await listStockMovements(req.user!.id, String(req.params.id), {
        limit: req.query.limit ? Number(req.query.limit) : undefined
      })
    );
  } catch (err) {
    next(err);
  }
});

router.get('/performance', async (req, res, next) => {
  try {
    return ok(res, await getMySupplierPerformance(req.user!));
  } catch (err) {
    next(err);
  }
});

router.get('/analytics', async (req, res, next) => {
  try {
    return ok(
      res,
      await supplierBusinessAnalytics(req.user!, {
        from: req.query.from ? String(req.query.from) : undefined,
        to: req.query.to ? String(req.query.to) : undefined
      })
    );
  } catch (err) {
    next(err);
  }
});

router.get('/reviews', async (req, res, next) => {
  try {
    return ok(
      res,
      await listSupplierOwnReviews(
        req.user!,
        req.query.status ? String(req.query.status) : undefined
      )
    );
  } catch (err) {
    next(err);
  }
});

const respondSchema = z.object({
  body: z.string().min(2).max(2000)
});

router.post('/reviews/:reviewId/respond', validate(respondSchema), async (req, res, next) => {
  try {
    return ok(
      res,
      await respondToSupplierReview({
        user: req.user!,
        reviewId: String(req.params.reviewId),
        body: req.body.body
      })
    );
  } catch (err) {
    next(err);
  }
});

export default router;
