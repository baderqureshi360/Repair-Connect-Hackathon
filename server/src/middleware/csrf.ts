import type { NextFunction, Request, Response } from 'express';
import { CSRF_COOKIE } from '../utils/cookies.js';
import { fail } from '../utils/response.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit CSRF for cookie-authenticated browser clients.
 * Bearer Authorization (tests / non-browser API clients) skips CSRF.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  if (SAFE.has(req.method.toUpperCase())) return next();

  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return next();

  // Only enforce when an access cookie is present (browser session).
  if (!req.cookies?.[CSRF_COOKIE] && !req.cookies?.rc_access) return next();

  const header = String(req.headers['x-csrf-token'] || '');
  const cookie = String(req.cookies?.[CSRF_COOKIE] || '');
  if (!header || !cookie || header !== cookie) {
    return fail(res, 'Invalid or missing CSRF token', 403, 'CSRF_REJECTED');
  }
  return next();
}
