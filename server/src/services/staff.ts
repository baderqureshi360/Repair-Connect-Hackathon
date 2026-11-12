import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import type { AuthUser } from '../middleware/auth.js';
import { PasswordReset } from '../models/PasswordReset.js';
import { RepairRequest } from '../models/RepairRequest.js';
import { ShopMembership } from '../models/ShopMembership.js';
import { User } from '../models/User.js';
import type { Role } from '../types/roles.js';
import { AppError } from '../utils/errors.js';
import { assertShopAccess, toObjectId } from './access.js';
import { writeAudit } from './audit.js';
import { revokeAllUserSessions } from './refreshSessions.js';

export const STAFF_ROLES = ['mechanic', 'parts_coordinator', 'shop_admin'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

function isStaffRole(role: string): role is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(role);
}

function assertAdminShop(actor: AuthUser, shopId: string) {
  if (actor.role !== 'shop_admin') {
    throw new AppError('Insufficient permissions', 403, 'FORBIDDEN');
  }
  assertShopAccess(actor, shopId);
}

async function countActiveShopAdmins(shopId: string, excludeMembershipId?: string) {
  const filter: Record<string, unknown> = {
    shop: toObjectId(shopId),
    role: 'shop_admin',
    isActive: true
  };
  if (excludeMembershipId) {
    filter._id = { $ne: toObjectId(excludeMembershipId) };
  }
  return ShopMembership.countDocuments(filter);
}

async function assertNotLastActiveAdmin(shopId: string, membershipId: string) {
  const remaining = await countActiveShopAdmins(shopId, membershipId);
  if (remaining < 1) {
    throw new AppError(
      'Cannot remove or demote the last active Shop Admin for this shop',
      409,
      'LAST_SHOP_ADMIN'
    );
  }
}

function serializeMembership(m: {
  _id: { toString(): string };
  role: string;
  isActive?: boolean | null;
  createdAt?: Date;
  updatedAt?: Date;
  user: unknown;
  shop: unknown;
}) {
  const user = m.user as
    | {
        _id?: { toString(): string };
        name?: string;
        email?: string;
        phone?: string;
        role?: string;
        isActive?: boolean;
        preferredLanguage?: string;
        createdAt?: Date;
      }
    | null
    | undefined;
  const shop = m.shop as
    | { _id?: { toString(): string }; name?: string; code?: string; city?: string }
    | null
    | undefined;

  const userId = user?._id?.toString();
  const shopId = shop?._id?.toString();
  return {
    _id: m._id.toString(),
    id: m._id.toString(),
    membershipId: m._id.toString(),
    role: m.role,
    isActive: m.isActive !== false,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    user: user
      ? {
          _id: userId,
          id: userId,
          name: user.name,
          email: user.email,
          phone: user.phone || '',
          role: user.role,
          isActive: user.isActive !== false,
          preferredLanguage: user.preferredLanguage || 'en',
          createdAt: user.createdAt
        }
      : null,
    shop: shop
      ? {
          _id: shopId,
          id: shopId,
          name: shop.name,
          code: shop.code,
          city: shop.city
        }
      : null
  };
}

export async function listStaff(
  actor: AuthUser,
  opts: {
    shopId?: string;
    includeInactive?: boolean;
    role?: string;
    q?: string;
  } = {}
) {
  if (actor.role !== 'shop_admin') {
    throw new AppError('Insufficient permissions', 403, 'FORBIDDEN');
  }

  let shopFilter: Record<string, unknown>;
  if (opts.shopId) {
    assertAdminShop(actor, opts.shopId);
    shopFilter = { shop: toObjectId(opts.shopId) };
  } else {
    shopFilter = { shop: { $in: actor.shopIds.map((id) => toObjectId(id)) } };
  }

  const filter: Record<string, unknown> = { ...shopFilter };
  if (!opts.includeInactive) {
    filter.isActive = true;
  }
  if (opts.role) {
    if (!isStaffRole(opts.role)) {
      throw new AppError('Invalid staff role filter', 400, 'VALIDATION_ERROR');
    }
    filter.role = opts.role;
  }

  const memberships = await ShopMembership.find(filter)
    .populate('user', 'name email role phone isActive preferredLanguage createdAt')
    .populate('shop', 'name code city')
    .sort({ createdAt: -1 });

  let rows = memberships.map((m) => serializeMembership(m as never));

  if (opts.q?.trim()) {
    const q = opts.q.trim().toLowerCase();
    rows = rows.filter((row) => {
      const hay = [row.user?.name, row.user?.email, row.user?.phone, row.role, row.shop?.name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }

  const statsSource = opts.includeInactive
    ? rows
    : (
        await ShopMembership.find(shopFilter)
          .populate('user', 'name email role phone isActive')
          .populate('shop', 'name code city')
      ).map((m) => serializeMembership(m as never));

  const byRole: Record<string, number> = {
    shop_admin: 0,
    mechanic: 0,
    parts_coordinator: 0
  };
  let active = 0;
  let inactive = 0;
  for (const row of statsSource) {
    if (row.isActive) active += 1;
    else inactive += 1;
    if (row.role in byRole) byRole[row.role] += 1;
  }

  return {
    staff: rows,
    stats: {
      total: statsSource.length,
      active,
      inactive,
      byRole
    }
  };
}

export async function getStaffMembership(actor: AuthUser, membershipId: string) {
  if (actor.role !== 'shop_admin') {
    throw new AppError('Insufficient permissions', 403, 'FORBIDDEN');
  }
  const membership = await ShopMembership.findById(toObjectId(membershipId))
    .populate('user', 'name email role phone isActive preferredLanguage createdAt')
    .populate('shop', 'name code city');
  if (!membership) throw new AppError('Staff membership not found', 404, 'NOT_FOUND');
  assertAdminShop(actor, membership.shop
    ? String((membership.shop as { _id?: unknown })._id || membership.shop)
    : '');
  return serializeMembership(membership as never);
}

export async function createStaff(
  actor: AuthUser,
  input: {
    email: string;
    password: string;
    name: string;
    role: StaffRole;
    shopId: string;
    phone?: string;
    preferredLanguage?: 'en' | 'ur';
    invite?: boolean;
  }
) {
  assertAdminShop(actor, input.shopId);

  if (!isStaffRole(input.role)) {
    throw new AppError('Invalid staff role', 400, 'VALIDATION_ERROR');
  }
  if ((input.role as string) === 'platform_operator' || (input.role as string) === 'customer') {
    throw new AppError('Cannot assign this role via staff management', 403, 'PRIVILEGE_ESCALATION');
  }

  const email = input.email.toLowerCase().trim();
  const existing = await User.findOne({ email });
  if (existing) throw new AppError('Email already registered', 409, 'DUPLICATE');

  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await User.create({
    email,
    passwordHash,
    name: input.name.trim(),
    role: input.role,
    phone: input.phone?.trim(),
    preferredLanguage: input.preferredLanguage || 'en',
    isActive: true,
    accountStatus: 'active'
  });

  const membership = await ShopMembership.create({
    user: user._id,
    shop: toObjectId(input.shopId),
    role: input.role,
    isActive: true
  });

  let invite: { resetToken?: string; expiresInMinutes: number } | undefined;
  if (input.invite) {
    const raw = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
    await PasswordReset.create({
      user: user._id,
      tokenHash,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    });
    invite = { resetToken: raw, expiresInMinutes: 60 };
  }

  await writeAudit({
    actor: actor.id,
    action: 'auth.staff_create',
    entityType: 'User',
    entityId: user._id,
    shop: input.shopId,
    details: { role: input.role, invite: Boolean(input.invite) }
  });

  const populated = await ShopMembership.findById(membership._id)
    .populate('user', 'name email role phone isActive preferredLanguage createdAt')
    .populate('shop', 'name code city');

  return {
    user: {
      id: user._id,
      email: user.email,
      name: user.name,
      role: user.role,
      phone: user.phone || ''
    },
    membership: populated ? serializeMembership(populated as never) : serializeMembership(membership as never),
    invite
  };
}

export async function updateStaff(
  actor: AuthUser,
  membershipId: string,
  input: {
    name?: string;
    phone?: string;
    role?: StaffRole;
    shopId?: string;
    preferredLanguage?: 'en' | 'ur';
  }
) {
  if (actor.role !== 'shop_admin') {
    throw new AppError('Insufficient permissions', 403, 'FORBIDDEN');
  }

  const membership = await ShopMembership.findById(toObjectId(membershipId));
  if (!membership) throw new AppError('Staff membership not found', 404, 'NOT_FOUND');

  const currentShopId = membership.shop.toString();
  assertAdminShop(actor, currentShopId);

  const user = await User.findById(membership.user);
  if (!user) throw new AppError('Staff user not found', 404, 'NOT_FOUND');

  if (user.role === 'platform_operator') {
    throw new AppError('Cannot manage platform operators', 403, 'FORBIDDEN');
  }

  const targetUserId = user._id.toString();
  const isSelf = actor.id === targetUserId;

  if (input.role && input.role !== membership.role) {
    if (!isStaffRole(input.role)) {
      throw new AppError('Invalid staff role', 400, 'VALIDATION_ERROR');
    }
    if ((input.role as string) === 'platform_operator') {
      throw new AppError('Cannot assign platform_operator via staff management', 403, 'PRIVILEGE_ESCALATION');
    }
    if (isSelf && membership.role === 'shop_admin' && input.role !== 'shop_admin') {
      throw new AppError(
        'You cannot demote your own Shop Admin role',
        403,
        'SELF_DEMOTION_FORBIDDEN'
      );
    }
    if (membership.role === 'shop_admin' && input.role !== 'shop_admin' && membership.isActive) {
      await assertNotLastActiveAdmin(currentShopId, membershipId);
    }
    membership.role = input.role;
    user.role = input.role as Role;
  }

  if (input.shopId && input.shopId !== currentShopId) {
    assertAdminShop(actor, input.shopId);
    if (membership.role === 'shop_admin' && membership.isActive) {
      await assertNotLastActiveAdmin(currentShopId, membershipId);
    }
    const conflict = await ShopMembership.findOne({
      user: user._id,
      shop: toObjectId(input.shopId),
      role: membership.role,
      _id: { $ne: membership._id }
    });
    if (conflict) {
      throw new AppError('Staff already has this role at the target shop', 409, 'DUPLICATE_MEMBERSHIP');
    }
    membership.shop = toObjectId(input.shopId) as typeof membership.shop;
  }

  if (input.name != null) user.name = input.name.trim();
  if (input.phone != null) user.phone = input.phone.trim();
  if (input.preferredLanguage != null) user.preferredLanguage = input.preferredLanguage;

  await user.save();
  await membership.save();

  await writeAudit({
    actor: actor.id,
    action: 'auth.staff_update',
    entityType: 'User',
    entityId: user._id,
    shop: membership.shop.toString(),
    details: {
      membershipId,
      name: input.name,
      phone: input.phone,
      role: input.role,
      shopId: input.shopId
    }
  });

  return getStaffMembership(actor, membershipId);
}

export async function setStaffActive(
  actor: AuthUser,
  membershipId: string,
  isActive: boolean
) {
  if (actor.role !== 'shop_admin') {
    throw new AppError('Insufficient permissions', 403, 'FORBIDDEN');
  }

  const membership = await ShopMembership.findById(toObjectId(membershipId));
  if (!membership) throw new AppError('Staff membership not found', 404, 'NOT_FOUND');

  const shopId = membership.shop.toString();
  assertAdminShop(actor, shopId);

  const user = await User.findById(membership.user);
  if (!user) throw new AppError('Staff user not found', 404, 'NOT_FOUND');
  if (user.role === 'platform_operator') {
    throw new AppError('Cannot manage platform operators', 403, 'FORBIDDEN');
  }

  if (actor.id === user._id.toString() && !isActive) {
    throw new AppError(
      'You cannot deactivate your own account',
      403,
      'SELF_DEACTIVATION_FORBIDDEN'
    );
  }

  if (!isActive && membership.role === 'shop_admin' && membership.isActive) {
    await assertNotLastActiveAdmin(shopId, membershipId);
  }

  membership.isActive = isActive;
  await membership.save();

  const otherActive = await ShopMembership.countDocuments({
    user: user._id,
    isActive: true,
    _id: { $ne: membership._id }
  });

  // Soft account deactivation when no remaining active memberships; never delete the user.
  if (!isActive && otherActive === 0) {
    user.isActive = false;
    await user.save();
    await revokeAllUserSessions(user._id, 'account_deactivated');
  } else if (isActive) {
    user.isActive = true;
    await user.save();
  } else if (!isActive) {
    // Membership deactivated but other shops remain — still revoke sessions (admin security action).
    await revokeAllUserSessions(user._id, 'admin_revoke');
  }

  await writeAudit({
    actor: actor.id,
    action: isActive ? 'auth.staff_activate' : 'auth.staff_deactivate',
    entityType: 'User',
    entityId: user._id,
    shop: shopId,
    details: { membershipId, membershipActive: isActive, userActive: user.isActive }
  });

  // Prove repair history remains intact after deactivation (no cascading deletes).
  const repairCount = await RepairRequest.countDocuments({
    $or: [{ assignedMechanic: user._id }, { collectedBy: user._id }, { closedBy: user._id }]
  });

  return {
    membership: await getStaffMembership(actor, membershipId),
    preservedRepairReferences: repairCount
  };
}

export async function resetStaffPassword(
  actor: AuthUser,
  membershipId: string,
  opts: { temporaryPassword?: string; invite?: boolean } = {}
) {
  if (actor.role !== 'shop_admin') {
    throw new AppError('Insufficient permissions', 403, 'FORBIDDEN');
  }

  const membership = await ShopMembership.findById(toObjectId(membershipId));
  if (!membership) throw new AppError('Staff membership not found', 404, 'NOT_FOUND');
  assertAdminShop(actor, membership.shop.toString());

  const user = await User.findById(membership.user).select('+passwordHash');
  if (!user) throw new AppError('Staff user not found', 404, 'NOT_FOUND');
  if (user.role === 'platform_operator') {
    throw new AppError('Cannot manage platform operators', 403, 'FORBIDDEN');
  }

  let temporaryPassword = opts.temporaryPassword;
  if (!temporaryPassword) {
    temporaryPassword = `Tmp${crypto.randomBytes(4).toString('hex')}9a`;
  }

  user.passwordHash = await bcrypt.hash(temporaryPassword, 12);
  if (!user.isActive) {
    user.isActive = true;
  }
  await user.save();
  await revokeAllUserSessions(user._id, 'password_reset');

  let invite: { resetToken?: string; expiresInMinutes: number } | undefined;
  if (opts.invite !== false) {
    const raw = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
    await PasswordReset.create({
      user: user._id,
      tokenHash,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    });
    invite = { resetToken: raw, expiresInMinutes: 60 };
  }

  await writeAudit({
    actor: actor.id,
    action: 'auth.staff_password_reset',
    entityType: 'User',
    entityId: user._id,
    shop: membership.shop.toString(),
    details: { membershipId, invite: Boolean(invite) }
  });

  return {
    userId: user._id.toString(),
    temporaryPassword,
    invite
  };
}
