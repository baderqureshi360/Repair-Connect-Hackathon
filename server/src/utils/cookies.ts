import type { CookieOptions, Response } from 'express';
import crypto from 'crypto';
import { env } from '../config/env.js';

export const ACCESS_COOKIE = 'rc_access';
export const REFRESH_COOKIE = 'rc_refresh';
export const CSRF_COOKIE = 'rc_csrf';

export function cookieBaseOptions(): CookieOptions {
  const sameSite = env.cookieSameSite;
  return {
    httpOnly: true,
    secure: env.isProd || sameSite === 'none',
    sameSite,
    path: '/',
    // When API and client are on different sites, browsers require Secure + SameSite=None.
    ...(env.cookieDomain ? { domain: env.cookieDomain } : {})
  };
}

export function setAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string; csrfToken: string }
) {
  const base = cookieBaseOptions();
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...base,
    httpOnly: true,
    maxAge: env.accessTokenTtlSec * 1000
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...base,
    httpOnly: true,
    maxAge: env.refreshTokenTtlSec * 1000
  });
  // Double-submit CSRF token must be readable by JS.
  res.cookie(CSRF_COOKIE, tokens.csrfToken, {
    ...base,
    httpOnly: false,
    maxAge: env.accessTokenTtlSec * 1000
  });
}

export function clearAuthCookies(res: Response) {
  const base = cookieBaseOptions();
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, CSRF_COOKIE]) {
    res.cookie(name, '', {
      ...base,
      httpOnly: name !== CSRF_COOKIE,
      maxAge: 0,
      expires: new Date(0)
    });
  }
}

export function newCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex');
}
