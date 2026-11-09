import mongoose from 'mongoose';
import type { AuthUser } from '../middleware/auth.js';
import { AppError } from '../utils/errors.js';

export function toObjectId(id: string) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError('Invalid resource id', 400, 'INVALID_ID');
  }
  return new mongoose.Types.ObjectId(id);
}

export function assertShopAccess(user: AuthUser, shopId: string) {
  if (user.role === 'customer') return;
  if (!user.shopIds.includes(String(shopId))) {
    throw new AppError('Access denied for this shop', 403, 'SHOP_FORBIDDEN');
  }
}

function idOf(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && '_id' in value) {
    return String((value as { _id: unknown })._id);
  }
  return String(value);
}

/** List/search/count filter derived only from the authenticated session. */
export function repairScopeFilter(user: AuthUser): Record<string, unknown> {
  if (user.role === 'customer') {
    return { customer: user.id };
  }
  if (user.role === 'mechanic') {
    return {
      assignedMechanic: user.id,
      shop: { $in: user.shopIds }
    };
  }
  return { shop: { $in: user.shopIds } };
}

/** Aggregation $match with ObjectIds for reliable pipeline scoping. */
export function repairStatsMatch(user: AuthUser): Record<string, unknown> {
  if (user.role === 'customer') {
    return { customer: toObjectId(user.id) };
  }
  if (user.role === 'mechanic') {
    return {
      assignedMechanic: toObjectId(user.id),
      shop: { $in: user.shopIds.map((id) => toObjectId(id)) }
    };
  }
  return { shop: { $in: user.shopIds.map((id) => toObjectId(id)) } };
}

export type RepairAccessShape = {
  /** Optional for walk-in repairs that only store a contact snapshot. */
  customer?: unknown;
  shop: unknown;
  assignedMechanic?: unknown;
  status?: string;
};

/**
 * View access:
 * - customer: owner only (linked account required)
 * - mechanic: assigned + shop membership
 * - parts/admin: shop membership
 */
export function assertCanViewRepair(user: AuthUser, repair: RepairAccessShape) {
  const customerId = idOf(repair.customer);
  const shopId = idOf(repair.shop);
  const assignee = idOf(repair.assignedMechanic);

  if (user.role === 'customer') {
    if (!customerId || customerId !== user.id) {
      throw new AppError('Forbidden', 403, 'FORBIDDEN');
    }
    return;
  }

  assertShopAccess(user, shopId);

  if (user.role === 'mechanic' && assignee !== user.id) {
    throw new AppError('Not assigned to this repair', 403, 'FORBIDDEN');
  }
}

/** Mutating mechanic/admin paths; parts coordinators are not repair mutators by default. */
export function assertCanMutateRepair(user: AuthUser, repair: RepairAccessShape) {
  assertCanViewRepair(user, repair);
  if (user.role === 'parts_coordinator') {
    throw new AppError('Insufficient permissions', 403, 'FORBIDDEN');
  }
  if (repair.status === 'completed') {
    throw new AppError(
      'Closed repairs cannot be modified — reopen with an audited reason first',
      409,
      'REPAIR_CLOSED'
    );
  }
}

/** Customer-facing redaction: never expose internal notes or internal checklist items. */
export function sanitizeRepairForViewer(user: AuthUser, repair: Record<string, unknown>) {
  if (user.role !== 'customer') return repair;
  const copy = { ...repair };
  delete copy.internalNotes;
  if (Array.isArray(copy.diagnosisChecklist)) {
    copy.diagnosisChecklist = (copy.diagnosisChecklist as { visibility?: string }[]).filter(
      (i) => i.visibility !== 'internal'
    );
  }
  if (Array.isArray(copy.completionChecklist)) {
    copy.completionChecklist = (copy.completionChecklist as { visibility?: string }[]).filter(
      (i) => i.visibility !== 'internal'
    );
  }
  if (Array.isArray(copy.photos)) {
    copy.photos = (copy.photos as { visibility?: string }[]).filter((p) => p.visibility !== 'internal');
  }
  return copy;
}

export function assertSameUser(user: AuthUser, targetUserId: string) {
  if (user.id !== String(targetUserId)) {
    throw new AppError('Forbidden', 403, 'FORBIDDEN');
  }
}
