import crypto from 'crypto';
import { env } from '../config/env.js';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Human-enterable ~10 char access code from high-entropy bytes. */
export function generateTrackingAccessCode(length = 10): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CROCKFORD[bytes[i]! % CROCKFORD.length];
  }
  return out;
}

export function generateTrackingToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

export function normalizeAccessCode(code: string): string {
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
}

export function hashTrackingAccessCode(code: string): string {
  const normalized = normalizeAccessCode(code);
  return crypto.createHmac('sha256', env.jwtSecret).update(`track-code:${normalized}`).digest('hex');
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    if (ba.length !== bb.length || ba.length === 0) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export function defaultTrackingExpiry(from = new Date()): Date {
  return new Date(from.getTime() + 365 * 24 * 60 * 60 * 1000);
}

export function issueTrackingCredentials() {
  const accessCode = generateTrackingAccessCode(10);
  return {
    trackingToken: generateTrackingToken(),
    accessCode,
    trackingAccessCodeHash: hashTrackingAccessCode(accessCode),
    trackingCodeUpdatedAt: new Date(),
    trackingExpiresAt: defaultTrackingExpiry(),
    trackingRevokedAt: undefined as Date | undefined
  };
}
