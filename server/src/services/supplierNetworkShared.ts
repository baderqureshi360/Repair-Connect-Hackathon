import crypto from 'crypto';
import mongoose from 'mongoose';
import { Notification, SupplierBusiness, User } from '../models/index.js';
import { AppError } from '../utils/errors.js';
import type { AuthUser } from '../middleware/auth.js';

const ALLOWED_ATTACHMENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
  'application/octet-stream'
]);

export type NetworkAttachment = {
  name: string;
  dataUrl: string;
  contentType: string;
  size: number;
};

export function publicRef(prefix: string, bytes = 6) {
  return `${prefix}-${crypto.randomBytes(bytes).toString('hex').toUpperCase()}`;
}

export function lineId() {
  return `L-${crypto.randomBytes(4).toString('hex')}`;
}

export function normalizeAttachments(
  input?: Array<{ name?: string; dataUrl: string; contentType?: string }>
): NetworkAttachment[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((a) => {
      const dataUrl = String(a.dataUrl || '').trim();
      const contentType = String(a.contentType || detectContentType(dataUrl)).trim().slice(0, 120);
      const name = String(a.name || 'attachment').trim().slice(0, 160) || 'attachment';
      const size = estimateDataUrlBytes(dataUrl);
      if (!dataUrl) return null;
      if (size > 350_000) {
        throw new AppError(`Attachment "${name}" exceeds size limit`, 400, 'ATTACHMENT_TOO_LARGE');
      }
      if (!ALLOWED_ATTACHMENT_TYPES.has(contentType) && !contentType.startsWith('image/')) {
        throw new AppError(`Attachment type not allowed: ${contentType}`, 400, 'ATTACHMENT_TYPE');
      }
      return { name, dataUrl: dataUrl.slice(0, 400_000), contentType, size };
    })
    .filter((a): a is NetworkAttachment => Boolean(a))
    .slice(0, 5);
}

function detectContentType(dataUrl: string) {
  const m = /^data:([^;,]+)/i.exec(dataUrl);
  return m?.[1] || 'application/octet-stream';
}

function estimateDataUrlBytes(dataUrl: string) {
  const comma = dataUrl.indexOf(',');
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Math.floor((b64.length * 3) / 4);
}

export function assertShopAccess(user: AuthUser, shopId: string) {
  if (user.role !== 'shop_admin' || !user.shopIds.includes(shopId)) {
    throw new AppError('Access denied for this shop', 403, 'SHOP_FORBIDDEN');
  }
}

/** Shop admin or parts coordinator with membership — used for receiving. */
export function assertShopReceivingAccess(user: AuthUser, shopId: string) {
  if (
    !['shop_admin', 'parts_coordinator'].includes(user.role) ||
    !user.shopIds.includes(shopId)
  ) {
    throw new AppError('Access denied for this shop', 403, 'SHOP_FORBIDDEN');
  }
}

export async function requireApprovedSupplierBusiness(ownerId: string) {
  const business = await SupplierBusiness.findOne({ owner: ownerId });
  if (!business) throw new AppError('Supplier business not found', 404, 'NOT_FOUND');
  if (business.status !== 'approved' || !business.isActive) {
    throw new AppError('Supplier business is not active', 403, 'SUPPLIER_INACTIVE');
  }
  return business;
}

export async function requireApprovedSupplierById(supplierBusinessId: string) {
  if (!mongoose.isValidObjectId(supplierBusinessId)) {
    throw new AppError('Invalid supplier', 400, 'INVALID_SUPPLIER');
  }
  const business = await SupplierBusiness.findById(supplierBusinessId);
  if (!business || business.status !== 'approved' || !business.isActive) {
    throw new AppError('Supplier not found or not available', 404, 'SUPPLIER_NOT_FOUND');
  }
  return business;
}

export async function notifyUsers(
  userIds: Array<string | mongoose.Types.ObjectId | undefined | null>,
  type: string,
  title: string,
  message: string,
  meta?: Record<string, unknown>
) {
  const unique = [...new Set(userIds.filter(Boolean).map(String))];
  for (const userId of unique) {
    try {
      await Notification.create({ user: userId, type, title, message, meta });
    } catch {
      /* non-blocking */
    }
  }
}

export async function shopAdminUserIds(shopId: string): Promise<string[]> {
  const { ShopMembership } = await import('../models/index.js');
  const memberships = await ShopMembership.find({
    shop: shopId,
    role: 'shop_admin',
    isActive: true
  }).select('user');
  return memberships.map((m) => String(m.user));
}

export async function shopReceivingUserIds(shopId: string): Promise<string[]> {
  const { ShopMembership } = await import('../models/index.js');
  const memberships = await ShopMembership.find({
    shop: shopId,
    role: { $in: ['shop_admin', 'parts_coordinator'] },
    isActive: true
  }).select('user');
  return memberships.map((m) => String(m.user));
}

export async function supplierOwnerId(supplierBusinessId: string): Promise<string | null> {
  const biz = await SupplierBusiness.findById(supplierBusinessId).select('owner');
  return biz?.owner ? String(biz.owner) : null;
}

export async function userName(userId: string) {
  const user = await User.findById(userId).select('name');
  return user?.name || 'User';
}
