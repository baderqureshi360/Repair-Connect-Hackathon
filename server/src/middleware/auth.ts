import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { ShopMembership } from '../models/ShopMembership.js';
import type { Role } from '../types/roles.js';
import { AppError } from '../utils/errors.js';
import { fail } from '../utils/response.js';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../utils/cookies.js';

export type AccountStatus = 'active' | 'pending_shop_owner';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  name: string;
  preferredLanguage: 'en' | 'ur';
  shopIds: string[];
  /** Defaults to active when omitted (e.g. internal test helpers). */
  accountStatus?: AccountStatus;
}

const PENDING_OWNER_ALLOWLIST = [
  /^\/api\/v1\/auth\/me$/,
  /^\/api\/v1\/auth\/logout$/,
  /^\/api\/v1\/auth\/refresh$/,
  /^\/api\/v1\/auth\/csrf$/,
  /^\/api\/v1\/auth\/me\/password$/,
  /^\/api\/v1\/shop-applications\/mine$/
];

function isPendingOwnerAllowed(originalUrl: string): boolean {
  const path = originalUrl.split('?')[0];
  return PENDING_OWNER_ALLOWLIST.some((re) => re.test(path));
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

interface JwtPayload {
  sub: string;
  role: Role;
  typ?: 'access' | 'refresh';
}

function readAccessToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  const cookieToken = req.cookies?.[ACCESS_COOKIE];
  return typeof cookieToken === 'string' && cookieToken ? cookieToken : null;
}

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    const token = readAccessToken(req);
    if (!token) throw new AppError('Authentication required', 401, 'UNAUTHORIZED');

    const payload = jwt.verify(token, env.jwtSecret) as JwtPayload;
    if (payload.typ && payload.typ !== 'access') {
      throw new AppError('Invalid token type', 401, 'UNAUTHORIZED');
    }

    const user = await User.findById(payload.sub);
    if (!user || !user.isActive) {
      throw new AppError('Invalid or inactive user', 401, 'UNAUTHORIZED');
    }

    const memberships = await ShopMembership.find({ user: user._id, isActive: true }).select('shop');
    const accountStatus = (user.accountStatus || 'active') as AccountStatus;
    req.user = {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      name: user.name,
      preferredLanguage: user.preferredLanguage as 'en' | 'ur',
      shopIds: memberships.map((m) => m.shop.toString()),
      accountStatus
    };

    // Pending shop owners may authenticate but cannot use operational APIs.
    if (
      (req.user.accountStatus || 'active') === 'pending_shop_owner' &&
      !isPendingOwnerAllowed(req.originalUrl)
    ) {
      return fail(
        res,
        'Your shop application is pending approval. You can only view application status until approved.',
        403,
        'ONBOARDING_PENDING'
      );
    }

    next();
  } catch (err) {
    if (err instanceof AppError) {
      return fail(res, err.message, err.statusCode, err.code);
    }
    return fail(res, 'Invalid or expired token', 401, 'UNAUTHORIZED');
  }
}

export function requireRoles(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return fail(res, 'Authentication required', 401, 'UNAUTHORIZED');
    }
    if (!roles.includes(req.user.role)) {
      return fail(res, 'Insufficient permissions', 403, 'FORBIDDEN');
    }
    next();
  };
}

export function requireShopAccess(shopIdParam = 'shopId') {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return fail(res, 'Authentication required', 401, 'UNAUTHORIZED');
    }
    if (req.user.role === 'customer') {
      return next();
    }
    const shopId =
      req.params[shopIdParam] ||
      (req.body?.shop as string) ||
      (req.query.shop as string);
    if (!shopId) {
      return next();
    }
    if (!req.user.shopIds.includes(String(shopId))) {
      return fail(res, 'Access denied for this shop', 403, 'SHOP_FORBIDDEN');
    }
    next();
  };
}

export function signAccessToken(userId: string, role: Role): string {
  return jwt.sign({ sub: userId, role, typ: 'access' }, env.jwtSecret, {
    expiresIn: env.accessTokenTtlSec
  });
}

export function signRefreshToken(userId: string, role: Role): string {
  return jwt.sign({ sub: userId, role, typ: 'refresh' }, env.jwtSecret, {
    expiresIn: env.refreshTokenTtlSec
  });
}

/** @deprecated use signAccessToken — kept for transitional imports */
export function signToken(userId: string, role: Role): string {
  return signAccessToken(userId, role);
}

export function verifyRefreshToken(token: string): JwtPayload {
  const payload = jwt.verify(token, env.jwtSecret) as JwtPayload;
  if (payload.typ !== 'refresh') {
    throw new AppError('Invalid refresh token', 401, 'UNAUTHORIZED');
  }
  return payload;
}

export function readRefreshCookie(req: Request): string | null {
  const cookieToken = req.cookies?.[REFRESH_COOKIE];
  return typeof cookieToken === 'string' && cookieToken ? cookieToken : null;
}
