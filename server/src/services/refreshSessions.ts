import crypto from 'crypto';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { RefreshSession } from '../models/RefreshSession.js';
import { AppError } from '../utils/errors.js';
import type { Role } from '../types/roles.js';

export type RevokeReason =
  | 'logout'
  | 'rotated'
  | 'reuse_detected'
  | 'password_change'
  | 'password_reset'
  | 'account_deactivated'
  | 'supplier_suspended'
  | 'admin_revoke'
  | 'expired';

export function hashRefreshToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function newId(): string {
  return crypto.randomBytes(16).toString('hex');
}

export type RefreshJwtPayload = {
  sub: string;
  role: Role;
  typ: 'refresh';
  sid: string;
  fid: string;
};

export function signRefreshJwt(input: {
  userId: string;
  role: Role;
  sid: string;
  familyId: string;
}): string {
  const payload: RefreshJwtPayload = {
    sub: input.userId,
    role: input.role,
    typ: 'refresh',
    sid: input.sid,
    fid: input.familyId
  };
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.refreshTokenTtlSec });
}

export function verifyRefreshJwt(token: string): RefreshJwtPayload {
  const payload = jwt.verify(token, env.jwtSecret) as RefreshJwtPayload;
  if (payload.typ !== 'refresh' || !payload.sid || !payload.fid || !payload.sub) {
    throw new AppError('Invalid refresh token', 401, 'UNAUTHORIZED');
  }
  return payload;
}

export async function createRefreshSession(input: {
  userId: string;
  role: Role;
  familyId?: string;
  userAgent?: string;
  ip?: string;
}): Promise<{ refreshToken: string; sid: string; familyId: string }> {
  const sid = newId();
  const familyId = input.familyId || newId();
  const refreshToken = signRefreshJwt({
    userId: input.userId,
    role: input.role,
    sid,
    familyId
  });
  const expiresAt = new Date(Date.now() + env.refreshTokenTtlSec * 1000);
  await RefreshSession.create({
    user: input.userId,
    sid,
    familyId,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt,
    userAgent: String(input.userAgent || '').slice(0, 300),
    ip: String(input.ip || '').slice(0, 80)
  });
  return { refreshToken, sid, familyId };
}

/**
 * Rotate a valid refresh token. Concurrent callers: only one wins the atomic claim;
 * losers with the same still-active hash retry-read the replacement path via reuse rules.
 */
export async function rotateRefreshSession(input: {
  rawToken: string;
  userAgent?: string;
  ip?: string;
}): Promise<{ refreshToken: string; userId: string; role: Role; sid: string; familyId: string }> {
  const payload = verifyRefreshJwt(input.rawToken);
  const tokenHash = hashRefreshToken(input.rawToken);
  const now = new Date();

  const existing = await RefreshSession.findOne({ sid: payload.sid });
  if (!existing) {
    throw new AppError('Refresh session not found', 401, 'UNAUTHORIZED');
  }
  if (existing.tokenHash !== tokenHash) {
    // Token does not match stored hash for this sid — treat as invalid
    throw new AppError('Invalid refresh token', 401, 'UNAUTHORIZED');
  }
  if (existing.user.toString() !== payload.sub) {
    throw new AppError('Invalid refresh token', 401, 'UNAUTHORIZED');
  }

  if (existing.revokedAt) {
    // Reuse of a rotated/revoked token → revoke entire family
    await revokeRefreshFamily(existing.familyId, 'reuse_detected');
    throw new AppError('Refresh token reuse detected', 401, 'TOKEN_REUSE');
  }
  if (existing.expiresAt.getTime() <= now.getTime()) {
    existing.revokedAt = now;
    existing.revokeReason = 'expired';
    await existing.save();
    throw new AppError('Refresh token expired', 401, 'UNAUTHORIZED');
  }

  // Atomic claim: only one concurrent refresh can mark this session rotated
  const claimed = await RefreshSession.findOneAndUpdate(
    {
      _id: existing._id,
      revokedAt: null,
      tokenHash
    },
    {
      $set: {
        revokedAt: now,
        revokeReason: 'rotated'
      }
    },
    { new: true }
  );

  if (!claimed) {
    // Lost the atomic claim — another refresh already rotated this token.
    // Do NOT wipe the family here: concurrent twins are benign; true reuse is
    // handled above when the token is presented again after revokedAt is set.
    throw new AppError('Refresh token already rotated', 401, 'UNAUTHORIZED');
  }

  const next = await createRefreshSession({
    userId: payload.sub,
    role: payload.role,
    familyId: existing.familyId,
    userAgent: input.userAgent,
    ip: input.ip
  });

  claimed.replacedBySid = next.sid;
  await claimed.save();

  return {
    refreshToken: next.refreshToken,
    userId: payload.sub,
    role: payload.role,
    sid: next.sid,
    familyId: next.familyId
  };
}

export async function revokeRefreshSessionByToken(
  rawToken: string | null | undefined,
  reason: RevokeReason = 'logout'
): Promise<boolean> {
  if (!rawToken) return false;
  try {
    const payload = verifyRefreshJwt(rawToken);
    const tokenHash = hashRefreshToken(rawToken);
    const result = await RefreshSession.updateOne(
      { sid: payload.sid, tokenHash, revokedAt: null },
      { $set: { revokedAt: new Date(), revokeReason: reason } }
    );
    return result.modifiedCount > 0;
  } catch {
    return false;
  }
}

export async function revokeRefreshFamily(familyId: string, reason: RevokeReason): Promise<number> {
  const result = await RefreshSession.updateMany(
    { familyId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokeReason: reason } }
  );
  return result.modifiedCount;
}

export async function revokeAllUserSessions(
  userId: string | mongoose.Types.ObjectId,
  reason: RevokeReason
): Promise<number> {
  const result = await RefreshSession.updateMany(
    { user: userId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokeReason: reason } }
  );
  return result.modifiedCount;
}
