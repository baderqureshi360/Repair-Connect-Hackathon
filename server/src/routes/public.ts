import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { ok } from '../utils/response.js';
import { getPublicTrackingByToken, lookupPublicTracking } from '../services/publicTracking.js';
import {
  createShopApplication,
  getShopApplicationStatus,
  registerShopOwnerApplication
} from '../services/shopApplications.js';
import { registerSupplierApplication } from '../services/supplierApplications.js';
import { strongPasswordSchema } from '../validators/password.js';
import { PART_CATEGORY_IDS } from '../constants/partCategories.js';

const router = Router();

const isTest = process.env.NODE_ENV === 'test';
/** Same escape hatch as auth routes — Playwright webServer sets DISABLE_AUTH_RATE_LIMIT=1. */
const skipE2ERateLimit = () => isTest || process.env.DISABLE_AUTH_RATE_LIMIT === '1';

const trackLookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 10_000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipE2ERateLimit,
  message: { success: false, error: { message: 'Too many tracking attempts', code: 'RATE_LIMITED' } }
});

const shopAppLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isTest ? 10_000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipE2ERateLimit,
  message: { success: false, error: { message: 'Too many applications', code: 'RATE_LIMITED' } }
});

const supplierAppLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isTest ? 10_000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipE2ERateLimit,
  message: { success: false, error: { message: 'Too many applications', code: 'RATE_LIMITED' } }
});

const partCategoryEnum = z.enum(PART_CATEGORY_IDS as [string, ...string[]]);

const lookupSchema = z.object({
  referenceNumber: z.string().min(3).max(40),
  accessCode: z.string().min(6).max(32)
});

const categoryEnum = z.enum([
  'mobile_phones_tablets',
  'computers_laptops',
  'tvs_home_appliances',
  'gaming_consoles',
  'printers_office',
  'other_electronics'
]);

/** Full shop-owner registration with password + pending account. */
export const shopOwnerRegisterSchema = z
  .object({
    ownerName: z.string().min(2).max(120),
    ownerEmail: z.string().email().max(160),
    ownerPhone: z.string().min(5).max(40),
    password: strongPasswordSchema,
    confirmPassword: z.string().min(8).max(128),
    shopName: z.string().min(2).max(160),
    businessPhone: z.string().min(5).max(40),
    businessEmail: z.string().email().max(160),
    address: z.string().min(5).max(300),
    city: z.string().min(2).max(80),
    region: z.string().min(2).max(80),
    servicesDescription: z.string().min(10).max(2000),
    serviceCategories: z.array(categoryEnum).min(1).max(6),
    supportedDevices: z.array(z.string().min(1).max(60)).max(40).optional(),
    supportedBrands: z.array(z.string().min(1).max(60)).max(40).optional(),
    mechanicCount: z.number().int().min(0).max(500).optional(),
    termsAccepted: z.literal(true),
    // Explicitly reject privilege escalation fields from the public form.
    role: z.undefined().optional(),
    shopId: z.undefined().optional()
  })
  .superRefine((val, ctx) => {
    if (val.password !== val.confirmPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Passwords do not match',
        path: ['confirmPassword']
      });
    }
  });

/** Legacy application without account (no password) — kept for compatibility. */
const legacyShopApplicationSchema = z.object({
  shopName: z.string().min(2).max(160),
  businessEmail: z.string().email().max(160),
  contactPerson: z.string().min(2).max(120),
  phone: z.string().min(5).max(40),
  address: z.string().min(5).max(300),
  city: z.string().min(2).max(80),
  region: z.string().min(2).max(80),
  mechanicCount: z.number().int().min(0).max(500).optional(),
  servicesDescription: z.string().min(10).max(2000)
});

/** Manual tracking: reference + private access code (hashed server-side). */
router.post('/track/lookup', trackLookupLimiter, validate(lookupSchema), async (req, res, next) => {
  try {
    const data = await lookupPublicTracking({
      referenceNumber: req.body.referenceNumber,
      accessCode: req.body.accessCode,
      ip: req.ip
    });
    return ok(res, data);
  } catch (err) {
    next(err);
  }
});

/** Public repair tracking by high-entropy token — sanitized payload, no customer PII */
router.get('/track/:token', trackLookupLimiter, async (req, res, next) => {
  try {
    const data = await getPublicTrackingByToken(String(req.params.token || ''));
    return ok(res, data);
  } catch (err) {
    next(err);
  }
});

router.post(
  '/shop-applications/register',
  shopAppLimiter,
  validate(shopOwnerRegisterSchema),
  async (req, res, next) => {
    try {
      const data = await registerShopOwnerApplication({ ...req.body, ip: req.ip });
      return ok(res, data, 201);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/shop-applications',
  shopAppLimiter,
  validate(legacyShopApplicationSchema),
  async (req, res, next) => {
    try {
      const data = await createShopApplication({ ...req.body, ip: req.ip });
      return ok(res, data, 201);
    } catch (err) {
      next(err);
    }
  }
);

router.get('/shop-applications/:id', shopAppLimiter, async (req, res, next) => {
  try {
    const email = String(req.query.email || '');
    const data = await getShopApplicationStatus(String(req.params.id), email);
    return ok(res, data);
  } catch (err) {
    next(err);
  }
});

/** Independent supplier business registration with password + pending account. */
export const supplierRegisterSchema = z
  .object({
    contactPerson: z.string().min(2).max(120),
    email: z.string().email().max(160),
    phone: z.string().min(5).max(40),
    password: strongPasswordSchema,
    confirmPassword: z.string().min(8).max(128),
    businessName: z.string().min(2).max(160),
    address: z.string().min(5).max(300),
    city: z.string().min(2).max(80),
    region: z.string().min(2).max(80),
    description: z.string().min(10).max(2000),
    partCategories: z.array(partCategoryEnum).min(1).max(12),
    supportedBrands: z.array(z.string().min(1).max(60)).max(40).optional(),
    deliveryCities: z.array(z.string().min(1).max(80)).min(1).max(40),
    logoUrl: z.string().max(400_000).optional(),
    verificationDocuments: z
      .array(
        z.object({
          name: z.string().min(1).max(160),
          dataUrl: z.string().min(1).max(400_000)
        })
      )
      .max(5)
      .optional(),
    termsAccepted: z.literal(true),
    role: z.undefined().optional(),
    shopId: z.undefined().optional()
  })
  .superRefine((val, ctx) => {
    if (val.password !== val.confirmPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Passwords do not match',
        path: ['confirmPassword']
      });
    }
  });

router.post(
  '/supplier-applications/register',
  supplierAppLimiter,
  validate(supplierRegisterSchema),
  async (req, res, next) => {
    try {
      const data = await registerSupplierApplication({ ...req.body, ip: req.ip });
      return ok(res, data, 201);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
