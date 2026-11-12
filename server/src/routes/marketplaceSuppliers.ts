import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, requireRoles } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ok } from '../utils/response.js';
import {
  createSupplierReview,
  getMarketplaceSupplierProfile,
  listMarketplaceFilterOptions,
  searchMarketplaceProducts,
  searchMarketplaceSuppliers
} from '../services/supplierMarketplace.js';
import {
  listPublishedSupplierReviews,
  listReviewEligiblePurchaseOrders,
  reportSupplierReview,
  updateVerifiedSupplierReview
} from '../services/supplierReviews.js';
import { getSupplierPerformanceForBusiness } from '../services/supplierPerformance.js';
import { compareMarketplaceSuppliers } from '../services/supplierPurchasingAnalytics.js';

const router = Router();
const isTest = process.env.NODE_ENV === 'test';

const reviewWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 10_000 : 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Too many review writes', code: 'RATE_LIMIT' } }
});

const reportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 10_000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Too many reports', code: 'RATE_LIMIT' } }
});

router.use(authenticate, requireRoles('shop_admin'));

const star = z.number().int().min(1).max(5);
const categoryRatingsSchema = z.object({
  productQuality: star,
  deliveryPerformance: star,
  communication: star,
  orderFulfilment: star,
  overallExperience: star
});

const reviewSchema = z.object({
  shopId: z.string().min(1),
  purchaseOrderId: z.string().min(1),
  categoryRatings: categoryRatingsSchema,
  comment: z.string().max(1000).optional()
});

const editReviewSchema = z.object({
  categoryRatings: categoryRatingsSchema.optional(),
  comment: z.string().max(1000).optional()
});

const reportSchema = z.object({
  reason: z.string().min(5).max(1000),
  shopId: z.string().min(1).optional()
});

router.get('/meta', async (req, res, next) => {
  try {
    return ok(res, await listMarketplaceFilterOptions(req.user!));
  } catch (err) {
    next(err);
  }
});

router.get('/compare', async (req, res, next) => {
  try {
    const raw = String(req.query.ids || '');
    const ids = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return ok(
      res,
      await compareMarketplaceSuppliers(
        req.user!,
        ids,
        req.query.shopId ? String(req.query.shopId) : undefined
      )
    );
  } catch (err) {
    next(err);
  }
});

router.get('/products', async (req, res, next) => {
  try {
    const data = await searchMarketplaceProducts({
      user: req.user!,
      city: req.query.city ? String(req.query.city) : undefined,
      q: req.query.q ? String(req.query.q) : undefined,
      category: req.query.category ? String(req.query.category) : undefined,
      brand: req.query.brand ? String(req.query.brand) : undefined,
      availability: req.query.availability ? String(req.query.availability) : undefined,
      minPrice: req.query.minPrice !== undefined ? Number(req.query.minPrice) : undefined,
      maxPrice: req.query.maxPrice !== undefined ? Number(req.query.maxPrice) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      skip: req.query.skip ? Number(req.query.skip) : undefined
    });
    return ok(res, data);
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const data = await searchMarketplaceSuppliers({
      user: req.user!,
      city: req.query.city ? String(req.query.city) : undefined,
      q: req.query.q ? String(req.query.q) : undefined,
      category: req.query.category ? String(req.query.category) : undefined,
      brand: req.query.brand ? String(req.query.brand) : undefined,
      availability: req.query.availability ? String(req.query.availability) : undefined,
      minRating: req.query.minRating !== undefined ? Number(req.query.minRating) : undefined,
      minFulfilmentRate:
        req.query.minFulfilmentRate !== undefined ? Number(req.query.minFulfilmentRate) : undefined,
      minOnTimeRate:
        req.query.minOnTimeRate !== undefined ? Number(req.query.minOnTimeRate) : undefined,
      verifiedReviewsOnly:
        req.query.verifiedReviewsOnly === '1' || req.query.verifiedReviewsOnly === 'true',
      sortBy: req.query.sortBy
        ? (String(req.query.sortBy) as 'name' | 'rating' | 'fulfilment' | 'onTime')
        : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      skip: req.query.skip ? Number(req.query.skip) : undefined
    });
    return ok(res, data);
  } catch (err) {
    next(err);
  }
});

router.patch('/reviews/:reviewId', reviewWriteLimiter, validate(editReviewSchema), async (req, res, next) => {
  try {
    return ok(
      res,
      await updateVerifiedSupplierReview({
        user: req.user!,
        reviewId: String(req.params.reviewId),
        categoryRatings: req.body.categoryRatings,
        comment: req.body.comment
      })
    );
  } catch (err) {
    next(err);
  }
});

router.post(
  '/reviews/:reviewId/report',
  reportLimiter,
  validate(reportSchema),
  async (req, res, next) => {
    try {
      return ok(
        res,
        await reportSupplierReview({
          user: req.user!,
          reviewId: String(req.params.reviewId),
          reason: req.body.reason,
          shopId: req.body.shopId
        })
      );
    } catch (err) {
      next(err);
    }
  }
);

router.get('/:id/performance', async (req, res, next) => {
  try {
    return ok(res, await getSupplierPerformanceForBusiness(String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

router.get('/:id/reviews', async (req, res, next) => {
  try {
    return ok(
      res,
      await listPublishedSupplierReviews({
        publicIdOrId: String(req.params.id),
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        skip: req.query.skip ? Number(req.query.skip) : undefined
      })
    );
  } catch (err) {
    next(err);
  }
});

router.get('/:id/review-eligibility', async (req, res, next) => {
  try {
    const shopId = String(req.query.shopId || '');
    return ok(
      res,
      await listReviewEligiblePurchaseOrders({
        user: req.user!,
        shopId,
        supplierBusinessId: String(req.params.id)
      })
    );
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    return ok(
      res,
      await getMarketplaceSupplierProfile({
        user: req.user!,
        publicIdOrId: String(req.params.id),
        city: req.query.city ? String(req.query.city) : undefined
      })
    );
  } catch (err) {
    next(err);
  }
});

router.post('/:id/reviews', reviewWriteLimiter, validate(reviewSchema), async (req, res, next) => {
  try {
    return ok(
      res,
      await createSupplierReview({
        user: req.user!,
        publicIdOrId: String(req.params.id),
        shopId: req.body.shopId,
        purchaseOrderId: req.body.purchaseOrderId,
        categoryRatings: req.body.categoryRatings,
        comment: req.body.comment
      }),
      201
    );
  } catch (err) {
    next(err);
  }
});

export default router;
