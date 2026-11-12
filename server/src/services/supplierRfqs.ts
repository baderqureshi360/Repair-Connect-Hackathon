import mongoose from 'mongoose';
import { SupplierRfq, SupplierQuotation, SupplierBusiness } from '../models/index.js';
import { AppError } from '../utils/errors.js';
import { writeAudit } from './audit.js';
import type { AuthUser } from '../middleware/auth.js';
import {
  assertShopAccess,
  lineId,
  normalizeAttachments,
  notifyUsers,
  publicRef,
  requireApprovedSupplierBusiness,
  requireApprovedSupplierById,
  supplierOwnerId
} from './supplierNetworkShared.js';

function serializeRfq(
  rfq: InstanceType<typeof SupplierRfq>,
  extras?: Record<string, unknown>
) {
  return {
    id: String(rfq._id),
    publicId: rfq.publicId,
    shopId: String(rfq.shop),
    title: rfq.title,
    additionalRequirements: rfq.additionalRequirements || '',
    requiredDeliveryDate: rfq.requiredDeliveryDate || null,
    status: rfq.status,
    expiresAt: rfq.expiresAt || null,
    sentAt: rfq.sentAt || null,
    completedAt: rfq.completedAt || null,
    cancelledAt: rfq.cancelledAt || null,
    cancelReason: rfq.cancelReason || '',
    items: (rfq.items || []).map((i) => ({
      lineId: i.lineId,
      name: i.name,
      sku: i.sku || '',
      manufacturerPartNumber: i.manufacturerPartNumber || '',
      catalogItem: i.catalogItem ? String(i.catalogItem) : null,
      quantity: i.quantity,
      specifications: i.specifications || '',
      notes: i.notes || ''
    })),
    supplierBusinessIds: (rfq.supplierBusinesses || []).map((id) => String(id)),
    attachments: (rfq.attachments || []).map((a) => ({
      name: a.name,
      dataUrl: a.dataUrl,
      contentType: a.contentType,
      size: a.size
    })),
    acceptedQuotationId: rfq.acceptedQuotation ? String(rfq.acceptedQuotation) : null,
    acceptedLineIds: rfq.acceptedLineIds || [],
    createdAt: rfq.createdAt || null,
    updatedAt: rfq.updatedAt || null,
    ...extras
  };
}

async function maybeExpire(rfq: InstanceType<typeof SupplierRfq>) {
  if (
    rfq.expiresAt &&
    rfq.expiresAt.getTime() < Date.now() &&
    ['sent', 'partially_responded', 'draft'].includes(rfq.status)
  ) {
    rfq.status = 'expired';
    await rfq.save();
  }
  return rfq;
}

export async function createRfq(input: {
  user: AuthUser;
  shopId: string;
  title: string;
  additionalRequirements?: string;
  requiredDeliveryDate?: string;
  expiresAt?: string;
  supplierBusinessIds: string[];
  items: Array<{
    name: string;
    sku?: string;
    manufacturerPartNumber?: string;
    catalogItem?: string;
    quantity: number;
    specifications?: string;
    notes?: string;
  }>;
  attachments?: Array<{ name?: string; dataUrl: string; contentType?: string }>;
  send?: boolean;
}) {
  assertShopAccess(input.user, input.shopId);
  if (!input.items?.length) throw new AppError('Add at least one RFQ item', 400, 'ITEMS_REQUIRED');
  if (!input.supplierBusinessIds?.length) {
    throw new AppError('Select at least one supplier', 400, 'SUPPLIERS_REQUIRED');
  }

  const uniqueSupplierIds = [...new Set(input.supplierBusinessIds.map(String))];
  for (const id of uniqueSupplierIds) {
    await requireApprovedSupplierById(id);
  }

  const items = input.items.map((item) => {
    const quantity = Math.floor(Number(item.quantity));
    if (!Number.isFinite(quantity) || quantity < 1) {
      throw new AppError('Item quantity must be at least 1', 400, 'INVALID_QUANTITY');
    }
    const name = String(item.name || '').trim();
    if (name.length < 2) throw new AppError('Item name is required', 400, 'ITEM_NAME');
    return {
      lineId: lineId(),
      name: name.slice(0, 160),
      sku: String(item.sku || '').trim().slice(0, 80),
      manufacturerPartNumber: String(item.manufacturerPartNumber || '').trim().slice(0, 80),
      catalogItem:
        item.catalogItem && mongoose.isValidObjectId(item.catalogItem) ? item.catalogItem : undefined,
      quantity,
      specifications: String(item.specifications || '').trim().slice(0, 2000),
      notes: String(item.notes || '').trim().slice(0, 1000)
    };
  });

  const send = Boolean(input.send);
  const rfq = await SupplierRfq.create({
    publicId: publicRef('RFQ', 5),
    shop: input.shopId,
    createdBy: input.user.id,
    title: String(input.title).trim().slice(0, 200),
    additionalRequirements: String(input.additionalRequirements || '').trim().slice(0, 4000),
    requiredDeliveryDate: input.requiredDeliveryDate ? new Date(input.requiredDeliveryDate) : undefined,
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
    status: send ? 'sent' : 'draft',
    sentAt: send ? new Date() : undefined,
    items,
    supplierBusinesses: uniqueSupplierIds,
    attachments: normalizeAttachments(input.attachments)
  });

  await writeAudit({
    actor: input.user.id,
    action: send ? 'supplier_rfq.send' : 'supplier_rfq.create',
    entityType: 'SupplierRfq',
    entityId: rfq._id,
    shop: input.shopId,
    details: { publicId: rfq.publicId, suppliers: uniqueSupplierIds.length }
  });

  if (send) {
    for (const sid of uniqueSupplierIds) {
      const owner = await supplierOwnerId(sid);
      await notifyUsers(
        [owner],
        'supplier_rfq',
        'New RFQ received',
        `${rfq.publicId}: ${rfq.title}`,
        { rfqId: String(rfq._id), publicId: rfq.publicId }
      );
    }
  }

  return serializeRfq(rfq);
}

export async function updateDraftRfq(
  user: AuthUser,
  rfqId: string,
  input: Partial<{
    title: string;
    additionalRequirements: string;
    requiredDeliveryDate: string | null;
    expiresAt: string | null;
    supplierBusinessIds: string[];
    items: Array<{
      lineId?: string;
      name: string;
      sku?: string;
      manufacturerPartNumber?: string;
      catalogItem?: string;
      quantity: number;
      specifications?: string;
      notes?: string;
    }>;
    attachments: Array<{ name?: string; dataUrl: string; contentType?: string }>;
  }>
) {
  const rfq = await SupplierRfq.findById(rfqId);
  if (!rfq) throw new AppError('RFQ not found', 404, 'NOT_FOUND');
  assertShopAccess(user, String(rfq.shop));
  if (rfq.status !== 'draft') throw new AppError('Only draft RFQs can be edited', 409, 'INVALID_STATE');

  if (input.title !== undefined) rfq.title = String(input.title).trim().slice(0, 200);
  if (input.additionalRequirements !== undefined) {
    rfq.additionalRequirements = String(input.additionalRequirements).trim().slice(0, 4000);
  }
  if (input.requiredDeliveryDate !== undefined) {
    rfq.requiredDeliveryDate = input.requiredDeliveryDate
      ? new Date(input.requiredDeliveryDate)
      : undefined;
  }
  if (input.expiresAt !== undefined) {
    rfq.expiresAt = input.expiresAt ? new Date(input.expiresAt) : undefined;
  }
  if (input.supplierBusinessIds) {
    const ids = [...new Set(input.supplierBusinessIds.map(String))];
    if (!ids.length) throw new AppError('Select at least one supplier', 400, 'SUPPLIERS_REQUIRED');
    for (const id of ids) await requireApprovedSupplierById(id);
    rfq.supplierBusinesses = ids as unknown as typeof rfq.supplierBusinesses;
  }
  if (input.items) {
    if (!input.items.length) throw new AppError('Add at least one RFQ item', 400, 'ITEMS_REQUIRED');
    rfq.items = input.items.map((item) => ({
      lineId: item.lineId || lineId(),
      name: String(item.name).trim().slice(0, 160),
      sku: String(item.sku || '').trim().slice(0, 80),
      manufacturerPartNumber: String(item.manufacturerPartNumber || '').trim().slice(0, 80),
      catalogItem:
        item.catalogItem && mongoose.isValidObjectId(item.catalogItem) ? item.catalogItem : undefined,
      quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)),
      specifications: String(item.specifications || '').trim().slice(0, 2000),
      notes: String(item.notes || '').trim().slice(0, 1000)
    })) as typeof rfq.items;
  }
  if (input.attachments) rfq.attachments = normalizeAttachments(input.attachments) as typeof rfq.attachments;

  await rfq.save();
  return serializeRfq(rfq);
}

export async function sendRfq(user: AuthUser, rfqId: string) {
  const rfq = await SupplierRfq.findById(rfqId);
  if (!rfq) throw new AppError('RFQ not found', 404, 'NOT_FOUND');
  assertShopAccess(user, String(rfq.shop));
  if (rfq.status !== 'draft') throw new AppError('RFQ already sent', 409, 'INVALID_STATE');
  if (!(rfq.items || []).length) throw new AppError('Add at least one item', 400, 'ITEMS_REQUIRED');
  if (!(rfq.supplierBusinesses || []).length) {
    throw new AppError('Select at least one supplier', 400, 'SUPPLIERS_REQUIRED');
  }

  rfq.status = 'sent';
  rfq.sentAt = new Date();
  await rfq.save();

  for (const sid of rfq.supplierBusinesses || []) {
    const owner = await supplierOwnerId(String(sid));
    await notifyUsers(
      [owner],
      'supplier_rfq',
      'New RFQ received',
      `${rfq.publicId}: ${rfq.title}`,
      { rfqId: String(rfq._id), publicId: rfq.publicId }
    );
  }

  await writeAudit({
    actor: user.id,
    action: 'supplier_rfq.send',
    entityType: 'SupplierRfq',
    entityId: rfq._id,
    shop: rfq.shop,
    details: { publicId: rfq.publicId }
  });

  return serializeRfq(rfq);
}

export async function cancelRfq(user: AuthUser, rfqId: string, reason: string) {
  const rfq = await SupplierRfq.findById(rfqId);
  if (!rfq) throw new AppError('RFQ not found', 404, 'NOT_FOUND');
  assertShopAccess(user, String(rfq.shop));
  if (['completed', 'cancelled', 'expired'].includes(rfq.status)) {
    throw new AppError('RFQ cannot be cancelled', 409, 'INVALID_STATE');
  }
  const cancelReason = String(reason || '').trim();
  if (cancelReason.length < 5) throw new AppError('Cancellation reason required', 400, 'REASON_REQUIRED');

  rfq.status = 'cancelled';
  rfq.cancelledAt = new Date();
  rfq.cancelReason = cancelReason.slice(0, 1000);
  await rfq.save();

  await writeAudit({
    actor: user.id,
    action: 'supplier_rfq.cancel',
    entityType: 'SupplierRfq',
    entityId: rfq._id,
    shop: rfq.shop,
    details: { publicId: rfq.publicId, reason: cancelReason }
  });
  return serializeRfq(rfq);
}

export async function listShopRfqs(user: AuthUser, shopId: string, status?: string) {
  assertShopAccess(user, shopId);
  const filter: Record<string, unknown> = { shop: shopId };
  if (status) filter.status = status;
  const rows = await SupplierRfq.find(filter).sort({ createdAt: -1 }).limit(100);
  for (const r of rows) await maybeExpire(r);
  return rows.map((r) => serializeRfq(r));
}

export async function listSupplierRfqs(user: AuthUser, status?: string) {
  const business = await requireApprovedSupplierBusiness(user.id);
  const filter: Record<string, unknown> = {
    supplierBusinesses: business._id,
    status: { $nin: ['draft'] }
  };
  if (status) filter.status = status;
  const rows = await SupplierRfq.find(filter).sort({ createdAt: -1 }).limit(100);
  for (const r of rows) await maybeExpire(r);
  return rows.map((r) =>
    serializeRfq(r, {
      // Strip other suppliers from supplier view
      supplierBusinessIds: [String(business._id)]
    })
  );
}

export async function getRfqForActor(user: AuthUser, rfqIdOrPublic: string) {
  const key = String(rfqIdOrPublic || '').trim();
  const filter: Record<string, unknown> = {
    $or: [{ publicId: key }, ...(mongoose.isValidObjectId(key) ? [{ _id: key }] : [])]
  };
  const rfq = await SupplierRfq.findOne(filter);
  if (!rfq) throw new AppError('RFQ not found', 404, 'NOT_FOUND');
  await maybeExpire(rfq);

  if (user.role === 'shop_admin') {
    assertShopAccess(user, String(rfq.shop));
    const quotations = await SupplierQuotation.find({
      rfq: rfq._id,
      status: { $nin: ['draft'] }
    });
    const suppliers = await SupplierBusiness.find({
      _id: { $in: rfq.supplierBusinesses || [] }
    }).select('businessName publicId verified city');
    return {
      ...serializeRfq(rfq),
      suppliers: suppliers.map((s) => ({
        id: String(s._id),
        publicId: s.publicId,
        businessName: s.businessName,
        verified: Boolean(s.verified),
        city: s.city
      })),
      quotations: quotations.map(serializeQuotationBrief)
    };
  }

  if (user.role === 'supplier') {
    const business = await requireApprovedSupplierBusiness(user.id);
    const addressed = (rfq.supplierBusinesses || []).some((id) => String(id) === String(business._id));
    if (!addressed || rfq.status === 'draft') throw new AppError('RFQ not found', 404, 'NOT_FOUND');
    const myQuote = await SupplierQuotation.findOne({
      rfq: rfq._id,
      supplierBusiness: business._id
    });
    return {
      ...serializeRfq(rfq, { supplierBusinessIds: [String(business._id)] }),
      myQuotation: myQuote ? serializeQuotationBrief(myQuote) : null
    };
  }

  throw new AppError('Forbidden', 403, 'FORBIDDEN');
}

function serializeQuotationBrief(q: InstanceType<typeof SupplierQuotation>) {
  return {
    id: String(q._id),
    publicId: q.publicId,
    supplierBusinessId: String(q.supplierBusiness),
    status: q.status,
    revision: q.revision,
    subtotal: q.subtotal,
    deliveryCharges: q.deliveryCharges,
    taxAmount: q.taxAmount,
    totalAmount: q.totalAmount,
    currency: q.currency || 'PKR',
    validityUntil: q.validityUntil || null,
    estimatedDeliveryDate: q.estimatedDeliveryDate || null,
    submittedAt: q.submittedAt || null,
    lines: (q.lines || []).map((l) => ({
      lineId: l.lineId,
      rfqLineId: l.rfqLineId,
      unitPrice: l.unitPrice,
      availableQuantity: l.availableQuantity,
      quotedQuantity: l.quotedQuantity,
      moq: l.moq,
      unavailable: Boolean(l.unavailable),
      isAlternative: Boolean(l.isAlternative),
      alternativeName: l.alternativeName || '',
      alternativeSku: l.alternativeSku || '',
      warranty: l.warranty || '',
      notes: l.notes || '',
      lineTotal: Number(l.unitPrice || 0) * Number(l.quotedQuantity || 0)
    }))
  };
}

export { serializeQuotationBrief, serializeRfq, maybeExpire };
