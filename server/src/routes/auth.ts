import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { User } from '../models/User.js';
import { ShopMembership } from '../models/ShopMembership.js';
import { PasswordReset } from '../models/PasswordReset.js';
import {
  authenticate,
  requireRoles,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  readRefreshCookie
} from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  appearancePrefsSchema,
  changePasswordSchema,
  createStaffSchema,
  forgotPasswordSchema,
  languageSchema,
  loginSchema,
  notificationPrefsSchema,
  profileUpdateSchema,
  registerSchema
} from '../validators/schemas.js';
import { ok } from '../utils/response.js';
import { AppError } from '../utils/errors.js';
import { writeAudit } from '../services/audit.js';
import { DEMO_ACCOUNT_EMAILS, env } from '../config/env.js';
import {
  clearAuthCookies,
  cookieBaseOptions,
  CSRF_COOKIE,
  newCsrfToken,
  setAuthCookies
} from '../utils/cookies.js';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Too many attempts', code: 'RATE_LIMIT' } },
  skip: () =>
    process.env.NODE_ENV === 'test' || process.env.DISABLE_AUTH_RATE_LIMIT === '1'
});

function assertDemoLoginAllowed(email: string) {
  const normalized = email.toLowerCase();
  if (DEMO_ACCOUNT_EMAILS.includes(normalized as (typeof DEMO_ACCOUNT_EMAILS)[number])) {
    if (env.isProd || !env.allowDemoLogin) {
      throw new AppError(
        'Demo accounts are disabled in this environment',
        403,
        'DEMO_LOGIN_DISABLED'
      );
    }
  }
}

function issueSession(
  res: import('express').Response,
  user: { _id: { toString(): string }; role: string }
) {
  const accessToken = signAccessToken(user._id.toString(), user.role as never);
  const refreshToken = signRefreshToken(user._id.toString(), user.role as never);
  const csrfToken = newCsrfToken();
  setAuthCookies(res, { accessToken, refreshToken, csrfToken });
  // Vitest helpers may use Bearer; never expose JWTs outside test.
  return { csrfToken, ...(env.isTest ? { token: accessToken } : {}) };
}

router.post('/register', authLimiter, validate(registerSchema), async (req, res, next) => {
  try {
    const { email, password, name, phone, preferredLanguage } = req.body;

    if (req.body.role && req.body.role !== 'customer') {
      throw new AppError(
        'Self-registration is limited to customers. Staff must be created by a shop admin.',
        403,
        'PRIVILEGED_REGISTER_FORBIDDEN'
      );
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) throw new AppError('Email already registered', 409, 'DUPLICATE');

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      email,
      passwordHash,
      name,
      role: 'customer',
      phone,
      preferredLanguage: preferredLanguage || 'en'
    });

    const session = issueSession(res, user);
    await writeAudit({
      actor: user._id,
      action: 'auth.register',
      entityType: 'User',
      entityId: user._id
    });

    return ok(
      res,
      {
        ...session,
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          role: user.role,
          preferredLanguage: user.preferredLanguage
        }
      },
      201
    );
  } catch (err) {
    next(err);
  }
});

router.post('/forgot-password', authLimiter, validate(forgotPasswordSchema), async (req, res, next) => {
  try {
    const email = String(req.body.email || '').toLowerCase();
    const user = await User.findOne({ email, isActive: true });
    // Always return the same payload to avoid account enumeration.
    if (user) {
      const raw = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
      await PasswordReset.create({
        user: user._id,
        tokenHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        requestedIp: req.ip
      });
      await writeAudit({
        actor: user._id,
        action: 'auth.forgot_password',
        entityType: 'User',
        entityId: user._id,
        details: { emailDelivery: 'pending_configuration' }
      });
      // Token is not returned to clients in production UI; available only in non-prod for ops testing.
      if (!env.isProd) {
        return ok(res, { accepted: true, resetToken: raw, expiresInMinutes: 60 });
      }
    }
    return ok(res, { accepted: true });
  } catch (err) {
    next(err);
  }
});

router.post('/login', authLimiter, validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    assertDemoLoginAllowed(email);

    const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
    if (!user || !user.isActive) {
      throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
    }
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');

    const memberships = await ShopMembership.find({ user: user._id, isActive: true }).populate(
      'shop',
      'name code'
    );
    const accountStatus = (user.accountStatus || 'active') as 'active' | 'pending_shop_owner';
    const onboardingPending = accountStatus === 'pending_shop_owner';
    const session = issueSession(res, user);

    await writeAudit({
      actor: user._id,
      action: 'auth.login',
      entityType: 'User',
      entityId: user._id,
      details: { onboardingPending }
    });

    return ok(res, {
      ...session,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        preferredLanguage: user.preferredLanguage,
        accountStatus,
        onboardingPending,
        shops: memberships.map((m) => ({
          id: (m.shop as { _id?: unknown })._id || m.shop,
          membershipRole: m.role,
          shop: m.shop
        }))
      }
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    clearAuthCookies(res);
    return ok(res, { loggedOut: true });
  } catch (err) {
    next(err);
  }
});

router.post('/refresh', authLimiter, async (req, res, next) => {
  try {
    const refresh = readRefreshCookie(req);
    if (!refresh) throw new AppError('Refresh token required', 401, 'UNAUTHORIZED');
    const payload = verifyRefreshToken(refresh);
    const user = await User.findById(payload.sub);
    if (!user || !user.isActive) throw new AppError('Invalid session', 401, 'UNAUTHORIZED');
    const session = issueSession(res, user);
    return ok(res, {
      ...session,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        preferredLanguage: user.preferredLanguage
      }
    });
  } catch (err) {
    clearAuthCookies(res);
    next(err);
  }
});

router.get('/csrf', (_req, res) => {
  const csrfToken = newCsrfToken();
  res.cookie(CSRF_COOKIE, csrfToken, {
    ...cookieBaseOptions(),
    httpOnly: false,
    maxAge: env.accessTokenTtlSec * 1000
  });
  return ok(res, { csrfToken });
});

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await User.findById(req.user!.id);
    if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');
    const memberships = await ShopMembership.find({ user: user._id, isActive: true }).populate(
      'shop',
      'name code city'
    );
    const accountStatus = (user.accountStatus || 'active') as 'active' | 'pending_shop_owner';
    return ok(res, {
      id: user._id,
      email: user.email,
      name: user.name,
      role: user.role,
      preferredLanguage: user.preferredLanguage,
      phone: user.phone,
      avatarUrl: user.avatarUrl || null,
      accountStatus,
      onboardingPending: accountStatus === 'pending_shop_owner',
      notificationPreferences: user.notificationPreferences,
      preferences: user.preferences || {},
      shops: memberships
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/me/profile', authenticate, validate(profileUpdateSchema), async (req, res, next) => {
  try {
    // Explicitly ignore any attempt to escalate via unknown/forbidden fields (schema.strict).
    if (
      'role' in req.body ||
      'shopId' in req.body ||
      'shopIds' in req.body ||
      'passwordHash' in req.body ||
      'accountStatus' in req.body
    ) {
      throw new AppError('Cannot modify privileged fields', 403, 'FORBIDDEN');
    }
    const user = await User.findById(req.user!.id);
    if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');
    if (req.body.name != null) user.name = req.body.name;
    if (req.body.phone != null) user.phone = req.body.phone;
    if (req.body.preferredLanguage != null) user.preferredLanguage = req.body.preferredLanguage;
    if (req.body.avatarUrl !== undefined) user.avatarUrl = req.body.avatarUrl || undefined;
    await user.save();
    await writeAudit({
      actor: req.user!.id,
      action: 'auth.profile_update',
      entityType: 'User',
      entityId: user._id
    });
    return ok(res, {
      id: user._id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      preferredLanguage: user.preferredLanguage,
      avatarUrl: user.avatarUrl || null,
      role: user.role
    });
  } catch (err) {
    next(err);
  }
});

router.post('/me/password', authenticate, validate(changePasswordSchema), async (req, res, next) => {
  try {
    const user = await User.findById(req.user!.id).select('+passwordHash');
    if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');
    const match = await bcrypt.compare(req.body.currentPassword, user.passwordHash);
    if (!match) throw new AppError('Current password is incorrect', 401, 'INVALID_CREDENTIALS');
    user.passwordHash = await bcrypt.hash(req.body.newPassword, 12);
    await user.save();
    await writeAudit({
      actor: req.user!.id,
      action: 'auth.password_change',
      entityType: 'User',
      entityId: user._id
    });
    return ok(res, { changed: true });
  } catch (err) {
    next(err);
  }
});

router.patch('/me/preferences', authenticate, validate(appearancePrefsSchema), async (req, res, next) => {
  try {
    const user = await User.findById(req.user!.id);
    if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');
    const current = (user.preferences || {}) as Record<string, unknown>;
    user.preferences = { ...current, ...req.body } as typeof user.preferences;
    await user.save();
    return ok(res, user.preferences);
  } catch (err) {
    next(err);
  }
});

router.patch('/me/notifications', authenticate, validate(notificationPrefsSchema), async (req, res, next) => {
  try {
    const user = await User.findById(req.user!.id);
    if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');
    user.notificationPreferences = {
      repairUpdates: req.body.repairUpdates ?? user.notificationPreferences?.repairUpdates ?? true,
      estimateRequests:
        req.body.estimateRequests ?? user.notificationPreferences?.estimateRequests ?? true,
      partsAlerts: req.body.partsAlerts ?? user.notificationPreferences?.partsAlerts ?? true,
      appointmentReminders:
        req.body.appointmentReminders ?? user.notificationPreferences?.appointmentReminders ?? true
    };
    await user.save();
    return ok(res, user.notificationPreferences);
  } catch (err) {
    next(err);
  }
});

router.patch('/me/language', authenticate, validate(languageSchema), async (req, res, next) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.user!.id,
      { preferredLanguage: req.body.preferredLanguage },
      { new: true }
    );
    return ok(res, {
      id: user!._id,
      preferredLanguage: user!.preferredLanguage
    });
  } catch (err) {
    next(err);
  }
});

router.get('/staff', authenticate, requireRoles('shop_admin'), async (req, res, next) => {
  try {
    const shopId = (req.query.shopId as string) || req.user!.shopIds[0];
    if (!shopId || !req.user!.shopIds.includes(shopId)) {
      throw new AppError('Shop access denied', 403, 'SHOP_FORBIDDEN');
    }
    const memberships = await ShopMembership.find({ shop: shopId, isActive: true }).populate(
      'user',
      'name email role phone isActive'
    );
    return ok(res, memberships);
  } catch (err) {
    next(err);
  }
});

router.post(
  '/staff',
  authenticate,
  requireRoles('shop_admin'),
  validate(createStaffSchema),
  async (req, res, next) => {
    try {
      const { email, password, name, role, shopId, phone, preferredLanguage } = req.body;
      if (!req.user!.shopIds.includes(shopId)) {
        throw new AppError('Shop access denied', 403, 'SHOP_FORBIDDEN');
      }

      const existing = await User.findOne({ email: email.toLowerCase() });
      if (existing) throw new AppError('Email already registered', 409, 'DUPLICATE');

      const passwordHash = await bcrypt.hash(password, 12);
      const user = await User.create({
        email,
        passwordHash,
        name,
        role,
        phone,
        preferredLanguage: preferredLanguage || 'en'
      });

      const membership = await ShopMembership.create({
        user: user._id,
        shop: shopId,
        role,
        isActive: true
      });

      await writeAudit({
        actor: req.user!.id,
        action: 'auth.staff_create',
        entityType: 'User',
        entityId: user._id,
        shop: shopId,
        details: { role }
      });

      return ok(
        res,
        {
          user: {
            id: user._id,
            email: user.email,
            name: user.name,
            role: user.role
          },
          membership
        },
        201
      );
    } catch (err) {
      next(err);
    }
  }
);

export default router;
