import mongoose from 'mongoose';
import {
  RepairShop,
  SupplierBusiness,
  SupplierPurchaseOrder,
  SupplierQuotation,
  SupplierRfq
} from '../models/index.js';
import { AppError } from '../utils/errors.js';
import { writeAudit } from './audit.js';
import type { AuthUser } from '../middleware/auth.js';
import {
  assertShopAccess,
  assertShopReceivingAccess,
  lineId,
  normalizeAttachments,
  notifyUsers,
  publicRef,
  requireApprovedSupplierBusiness,
  shopAdminUserIds,
  shopReceivingUserIds,
  supplierOwnerId
} from './supplierNetworkShared.js';
import { postLedgerEntry } from './supplierLedger.js';

function roundMoney(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function computePoTotals(
  lines: Array<{ quantityOrdered: number; unitPrice: number; discountAmount?: number; taxPercent?: number }>,
  deliveryCharges: number,
  headerDiscount: number
) {
  let subtotal = 0;
  let taxAmount = 0;
  for (const line of lines) {
    const base = Math.max(0, line.quantityOrdered * line.unitPrice - (line.discountAmount || 0));
    const tax = base * ((line.taxPercent || 0) / 100);
    subtotal += base;
    taxAmount += tax;
  }
  subtotal = roundMoney(subtotal);
  taxAmount = roundMoney(taxAmount);
  const delivery = Math.max(0, deliveryCharges);
  const discount = Math.max(0, headerDiscount);
  const grandTotal = roundMoney(Math.max(0, subtotal + taxAmount + delivery - discount));
  return { subtotal, taxAmount, deliveryCharges: delivery, discountAmount: discount, grandTotal };
}

export function serializePurchaseOrder(po: InstanceType<typeof SupplierPurchaseOrder>) {
  return {
    id: String(po._id),
    publicId: po.publicId,
    shopId: String(po.shop),
    supplierBusinessId: String(po.supplierBusiness),
    rfqId: po.rfq ? String(po.rfq) : null,
    quotationId: po.quotation ? String(po.quotation) : null,
    status: po.status,
    revision: po.revision,
    currency: po.currency,
    subtotal: po.subtotal,
    taxAmount: po.taxAmount,
    deliveryCharges: po.deliveryCharges,
    discountAmount: po.discountAmount,
    grandTotal: po.grandTotal,
    deliveryAddress: po.deliveryAddress || '',
    expectedDeliveryDate: po.expectedDeliveryDate || null,
    terms: po.terms || '',
    notes: po.notes || '',
    issuedAt: po.issuedAt || null,
    acknowledgedAt: po.acknowledgedAt || null,
    rejectedAt: po.rejectedAt || null,
    rejectionReason: po.rejectionReason || '',
    cancelledAt: po.cancelledAt || null,
    cancelReason: po.cancelReason || '',
    closedAt: po.closedAt || null,
    supplierExpectedDispatchDate: po.supplierExpectedDispatchDate || null,
    supplierExpectedDeliveryDate: po.supplierExpectedDeliveryDate || null,
    lines: (po.lines || []).map((l) => ({
      lineId: l.lineId,
      quotationLineId: l.quotationLineId || '',
      rfqLineId: l.rfqLineId || '',
      name: l.name,
      sku: l.sku || '',
      manufacturerPartNumber: l.manufacturerPartNumber || '',
      quantityOrdered: l.quantityOrdered,
      quantityReceivedAccepted: l.quantityReceivedAccepted || 0,
      quantityRejected: l.quantityRejected || 0,
      quantityDamaged: l.quantityDamaged || 0,
      quantityShipped: l.quantityShipped || 0,
      unitPrice: l.unitPrice,
      discountAmount: l.discountAmount || 0,
      taxPercent: l.taxPercent || 0,
      lineSubtotal: l.lineSubtotal || 0,
      notes: l.notes || '',
      isAlternative: Boolean(l.isAlternative),
      shopPartId: l.shopPart ? String(l.shopPart) : null
    })),
    attachments: (po.attachments || []).map((a) => ({
      name: a.name,
      dataUrl: a.dataUrl,
      contentType: a.contentType,
      size: a.size
    })),
    amendments: (po.amendments || []).map((a) => ({
      amendmentId: a.amendmentId,
      reason: a.reason,
      changedBy: String(a.changedBy),
      changedAt: a.changedAt,
      before: a.before,
      after: a.after
    })),
    createdAt: po.createdAt || null,
    updatedAt: po.updatedAt || null
  };
}

async function loadPoForShop(user: AuthUser, poId: string, opts?: { receivingOk?: boolean }) {
  const key = String(poId || '').trim();
  const po = await SupplierPurchaseOrder.findOne({
    $or: [{ publicId: key }, ...(mongoose.isValidObjectId(key) ? [{ _id: key }] : [])]
  });
  if (!po) throw new AppError('Purchase order not found', 404, 'NOT_FOUND');
  if (opts?.receivingOk) {
    assertShopReceivingAccess(user, String(po.shop));
  } else {
    assertShopAccess(user, String(po.shop));
  }
  return po;
}

async function loadPoForSupplier(user: AuthUser, poId: string) {
  const business = await requireApprovedSupplierBusiness(user.id);
  const key = String(poId || '').trim();
  const po = await SupplierPurchaseOrder.findOne({
    $or: [{ publicId: key }, ...(mongoose.isValidObjectId(key) ? [{ _id: key }] : [])],
    supplierBusiness: business._id
  });
  if (!po) throw new AppError('Purchase order not found', 404, 'NOT_FOUND');
  return { po, business };
}

function selectedQuotationLines(
  quotation: InstanceType<typeof SupplierQuotation>,
  acceptedLineIds: string[]
) {
  const lines = quotation.lines || [];
  if (!acceptedLineIds.length) {
    return lines.filter((l) => !l.unavailable && l.quotedQuantity > 0);
  }
  const set = new Set(acceptedLineIds.map(String));
  const selected = lines.filter((l) => set.has(l.lineId));
  if (selected.length !== acceptedLineIds.length) {
    throw new AppError('One or more accepted line ids are invalid', 400, 'INVALID_LINE');
  }
  return selected.filter((l) => !l.unavailable && l.quotedQuantity > 0);
}

export async function createPurchaseOrderFromQuotation(input: {
  user: AuthUser;
  rfqId: string;
  quotationId?: string;
  acceptedLineIds?: string[];
  deliveryAddress?: string;
  expectedDeliveryDate?: string;
  terms?: string;
  notes?: string;
  attachments?: Array<{ name?: string; dataUrl: string; contentType?: string }>;
  issue?: boolean;
}) {
  const rfqKey = String(input.rfqId || '').trim();
  const rfq = await SupplierRfq.findOne({
    $or: [{ publicId: rfqKey }, ...(mongoose.isValidObjectId(rfqKey) ? [{ _id: rfqKey }] : [])]
  });
  if (!rfq) throw new AppError('RFQ not found', 404, 'NOT_FOUND');
  assertShopAccess(input.user, String(rfq.shop));

  if (rfq.status !== 'completed' || !rfq.acceptedQuotation) {
    throw new AppError('RFQ must have an accepted quotation before creating a PO', 409, 'RFQ_NOT_ACCEPTED');
  }

  const quotationId = input.quotationId || String(rfq.acceptedQuotation);
  const quotation = await SupplierQuotation.findById(quotationId);
  if (!quotation || String(quotation.rfq) !== String(rfq._id)) {
    throw new AppError('Quotation not found for this RFQ', 404, 'NOT_FOUND');
  }
  if (quotation.status !== 'accepted') {
    throw new AppError('Quotation is not accepted', 409, 'QUOTE_NOT_ACCEPTED');
  }

  const existing = await SupplierPurchaseOrder.findOne({
    quotation: quotation._id,
    status: { $nin: ['cancelled'] }
  });
  if (existing) {
    throw new AppError('An active purchase order already exists for this quotation', 409, 'PO_EXISTS');
  }

  const acceptedLineIds =
    input.acceptedLineIds?.length ? input.acceptedLineIds.map(String) : (rfq.acceptedLineIds || []).map(String);
  const qLines = selectedQuotationLines(quotation, acceptedLineIds);
  if (!qLines.length) {
    throw new AppError('No quotable lines available for PO', 400, 'NO_LINES');
  }

  const rfqItems = new Map((rfq.items || []).map((i) => [i.lineId, i]));
  const taxPercent = Number(quotation.taxPercent) || 0;
  const lines = qLines.map((ql) => {
    const rfqItem = rfqItems.get(ql.rfqLineId);
    const name = ql.isAlternative && ql.alternativeName ? ql.alternativeName : rfqItem?.name || 'Item';
    const sku = ql.isAlternative && ql.alternativeSku ? ql.alternativeSku : rfqItem?.sku || '';
    const qty = ql.quotedQuantity;
    const unitPrice = ql.unitPrice;
    const lineSubtotal = roundMoney(qty * unitPrice);
    return {
      lineId: lineId(),
      quotationLineId: ql.lineId,
      rfqLineId: ql.rfqLineId,
      name,
      sku,
      manufacturerPartNumber: rfqItem?.manufacturerPartNumber || '',
      quantityOrdered: qty,
      quantityReceivedAccepted: 0,
      quantityRejected: 0,
      quantityDamaged: 0,
      quantityShipped: 0,
      unitPrice,
      discountAmount: 0,
      taxPercent,
      lineSubtotal,
      notes: ql.notes || '',
      isAlternative: Boolean(ql.isAlternative),
      catalogItem: rfqItem?.catalogItem
    };
  });

  const proportionalDelivery =
    quotation.totalAmount > 0
      ? roundMoney(
          (quotation.deliveryCharges || 0) *
            (lines.reduce((s, l) => s + l.lineSubtotal, 0) / Math.max(1, quotation.subtotal || quotation.totalAmount))
        )
      : quotation.deliveryCharges || 0;

  const totals = computePoTotals(lines, proportionalDelivery, 0);
  const shop = await RepairShop.findById(rfq.shop).select('address city region name');
  const deliveryAddress =
    String(input.deliveryAddress || '').trim() ||
    [shop?.address, shop?.city, shop?.region].filter(Boolean).join(', ');

  const issue = Boolean(input.issue);
  const po = await SupplierPurchaseOrder.create({
    publicId: publicRef('PO', 5),
    shop: rfq.shop,
    supplierBusiness: quotation.supplierBusiness,
    rfq: rfq._id,
    quotation: quotation._id,
    createdBy: input.user.id,
    status: issue ? 'issued' : 'draft',
    lines,
    currency: quotation.currency || 'PKR',
    ...totals,
    deliveryAddress,
    expectedDeliveryDate: input.expectedDeliveryDate
      ? new Date(input.expectedDeliveryDate)
      : quotation.estimatedDeliveryDate || rfq.requiredDeliveryDate,
    terms: String(input.terms || '').trim().slice(0, 4000),
    notes: String(input.notes || '').trim().slice(0, 4000),
    attachments: normalizeAttachments(input.attachments),
    issuedAt: issue ? new Date() : undefined
  });

  await writeAudit({
    actor: input.user.id,
    action: issue ? 'supplier_po.issue' : 'supplier_po.create',
    entityType: 'SupplierPurchaseOrder',
    entityId: po._id,
    shop: po.shop,
    details: { publicId: po.publicId, rfqPublicId: rfq.publicId, grandTotal: po.grandTotal }
  });

  if (issue) {
    const owner = await supplierOwnerId(String(po.supplierBusiness));
    await notifyUsers(
      [owner],
      'supplier_po',
      'New purchase order',
      `${po.publicId} issued for ${totals.grandTotal} ${po.currency}`,
      { purchaseOrderId: String(po._id), publicId: po.publicId }
    );
    await postLedgerEntry({
      user: input.user,
      shopId: String(po.shop),
      supplierBusinessId: String(po.supplierBusiness),
      purchaseOrderId: String(po._id),
      kind: 'po_obligation',
      amount: po.grandTotal,
      currency: po.currency,
      notes: `PO ${po.publicId} issued`,
      idempotencyKey: `po-obligation:${po.publicId}`
    });
  }

  return serializePurchaseOrder(po);
}

export async function issuePurchaseOrder(user: AuthUser, poId: string) {
  const po = await loadPoForShop(user, poId);
  if (po.status !== 'draft') throw new AppError('Only draft POs can be issued', 409, 'INVALID_STATE');
  po.status = 'issued';
  po.issuedAt = new Date();
  await po.save();

  await writeAudit({
    actor: user.id,
    action: 'supplier_po.issue',
    entityType: 'SupplierPurchaseOrder',
    entityId: po._id,
    shop: po.shop,
    details: { publicId: po.publicId }
  });

  const owner = await supplierOwnerId(String(po.supplierBusiness));
  await notifyUsers(
    [owner],
    'supplier_po',
    'New purchase order',
    `${po.publicId} issued for ${po.grandTotal} ${po.currency}`,
    { purchaseOrderId: String(po._id), publicId: po.publicId }
  );

  await postLedgerEntry({
    user,
    shopId: String(po.shop),
    supplierBusinessId: String(po.supplierBusiness),
    purchaseOrderId: String(po._id),
    kind: 'po_obligation',
    amount: po.grandTotal,
    currency: po.currency,
    notes: `PO ${po.publicId} issued`,
    idempotencyKey: `po-obligation:${po.publicId}`
  });

  return serializePurchaseOrder(po);
}

export async function acknowledgePurchaseOrder(
  user: AuthUser,
  poId: string,
  input: { expectedDispatchDate?: string; expectedDeliveryDate?: string; notes?: string }
) {
  const { po } = await loadPoForSupplier(user, poId);
  if (po.status !== 'issued') throw new AppError('Only issued POs can be acknowledged', 409, 'INVALID_STATE');
  po.status = 'acknowledged';
  po.acknowledgedAt = new Date();
  po.acknowledgedBy = new mongoose.Types.ObjectId(user.id);
  if (input.expectedDispatchDate) po.supplierExpectedDispatchDate = new Date(input.expectedDispatchDate);
  if (input.expectedDeliveryDate) po.supplierExpectedDeliveryDate = new Date(input.expectedDeliveryDate);
  if (input.notes) po.notes = `${po.notes || ''}\nSupplier: ${String(input.notes).trim()}`.trim().slice(0, 4000);
  await po.save();

  await writeAudit({
    actor: user.id,
    action: 'supplier_po.acknowledge',
    entityType: 'SupplierPurchaseOrder',
    entityId: po._id,
    shop: po.shop,
    details: { publicId: po.publicId }
  });

  await notifyUsers(
    await shopReceivingUserIds(String(po.shop)),
    'supplier_po',
    'PO acknowledged',
    `${po.publicId} was acknowledged by the supplier`,
    { purchaseOrderId: String(po._id), hrefHint: 'purchase_order' }
  );

  return serializePurchaseOrder(po);
}

export async function rejectPurchaseOrder(user: AuthUser, poId: string, reason: string) {
  const { po } = await loadPoForSupplier(user, poId);
  if (!['issued'].includes(po.status)) {
    throw new AppError('Only issued POs can be rejected', 409, 'INVALID_STATE');
  }
  const trimmed = String(reason || '').trim();
  if (trimmed.length < 5) throw new AppError('Rejection reason required', 400, 'REASON_REQUIRED');

  po.status = 'cancelled';
  po.rejectedAt = new Date();
  po.rejectionReason = trimmed.slice(0, 1000);
  po.cancelledAt = new Date();
  po.cancelReason = `Supplier rejected: ${trimmed}`.slice(0, 1000);
  await po.save();

  await writeAudit({
    actor: user.id,
    action: 'supplier_po.reject',
    entityType: 'SupplierPurchaseOrder',
    entityId: po._id,
    shop: po.shop,
    details: { publicId: po.publicId, reason: trimmed }
  });

  await notifyUsers(
    await shopReceivingUserIds(String(po.shop)),
    'supplier_po',
    'PO rejected',
    `${po.publicId} was rejected: ${trimmed}`,
    { purchaseOrderId: String(po._id), hrefHint: 'purchase_order' }
  );

  return serializePurchaseOrder(po);
}

export async function cancelPurchaseOrder(user: AuthUser, poId: string, reason: string) {
  const po = await loadPoForShop(user, poId);
  if (['fulfilled', 'closed', 'cancelled'].includes(po.status)) {
    throw new AppError(`Cannot cancel a ${po.status} PO`, 409, 'INVALID_STATE');
  }
  if (['partially_fulfilled'].includes(po.status)) {
    throw new AppError('Partially fulfilled POs cannot be fully cancelled; close remaining instead', 409, 'INVALID_STATE');
  }
  const trimmed = String(reason || '').trim();
  if (trimmed.length < 5) throw new AppError('Cancel reason required', 400, 'REASON_REQUIRED');

  const wasIssued = Boolean(po.issuedAt);
  po.status = 'cancelled';
  po.cancelledAt = new Date();
  po.cancelReason = trimmed.slice(0, 1000);
  await po.save();

  await writeAudit({
    actor: user.id,
    action: 'supplier_po.cancel',
    entityType: 'SupplierPurchaseOrder',
    entityId: po._id,
    shop: po.shop,
    details: { publicId: po.publicId, reason: trimmed }
  });

  if (wasIssued) {
    const owner = await supplierOwnerId(String(po.supplierBusiness));
    await notifyUsers(
      [owner],
      'supplier_po',
      'PO cancelled',
      `${po.publicId} was cancelled by the shop`,
      { purchaseOrderId: String(po._id) }
    );
  }

  return serializePurchaseOrder(po);
}

export async function amendPurchaseOrder(
  user: AuthUser,
  poId: string,
  input: {
    reason: string;
    deliveryAddress?: string;
    expectedDeliveryDate?: string | null;
    terms?: string;
    notes?: string;
    deliveryCharges?: number;
    discountAmount?: number;
    lines?: Array<{ lineId: string; quantityOrdered?: number; unitPrice?: number; notes?: string }>;
  }
) {
  const po = await loadPoForShop(user, poId);
  const reason = String(input.reason || '').trim();
  if (reason.length < 5) throw new AppError('Amendment reason required', 400, 'REASON_REQUIRED');

  if (['cancelled', 'closed', 'fulfilled'].includes(po.status)) {
    throw new AppError(`Cannot amend a ${po.status} PO`, 409, 'INVALID_STATE');
  }

  // After acknowledgement, quantities/prices require explicit amendment (this path) — never silent.
  const locked = ['acknowledged', 'partially_fulfilled', 'issued'].includes(po.status);
  if (locked && input.lines?.length && !reason) {
    throw new AppError('Amendment reason required after acknowledgement', 400, 'REASON_REQUIRED');
  }

  const before = {
    deliveryAddress: po.deliveryAddress,
    expectedDeliveryDate: po.expectedDeliveryDate,
    terms: po.terms,
    notes: po.notes,
    deliveryCharges: po.deliveryCharges,
    discountAmount: po.discountAmount,
    lines: (po.lines || []).map((l) => ({
      lineId: l.lineId,
      quantityOrdered: l.quantityOrdered,
      unitPrice: l.unitPrice,
      notes: l.notes
    }))
  };

  if (input.deliveryAddress !== undefined) po.deliveryAddress = String(input.deliveryAddress).trim().slice(0, 500);
  if (input.expectedDeliveryDate !== undefined) {
    po.expectedDeliveryDate = input.expectedDeliveryDate ? new Date(input.expectedDeliveryDate) : undefined;
  }
  if (input.terms !== undefined) po.terms = String(input.terms).trim().slice(0, 4000);
  if (input.notes !== undefined) po.notes = String(input.notes).trim().slice(0, 4000);

  if (input.lines?.length) {
    const byId = new Map((po.lines || []).map((l) => [l.lineId, l]));
    for (const patch of input.lines) {
      const line = byId.get(patch.lineId);
      if (!line) throw new AppError(`Unknown line ${patch.lineId}`, 400, 'INVALID_LINE');
      if (patch.quantityOrdered !== undefined) {
        const q = Math.floor(Number(patch.quantityOrdered));
        if (q < 1) throw new AppError('Quantity must be at least 1', 400, 'INVALID_QUANTITY');
        if (q < (line.quantityReceivedAccepted || 0)) {
          throw new AppError('Cannot reduce ordered qty below accepted received qty', 409, 'QTY_BELOW_RECEIVED');
        }
        line.quantityOrdered = q;
      }
      if (patch.unitPrice !== undefined) {
        const p = Number(patch.unitPrice);
        if (p < 0) throw new AppError('Invalid unit price', 400, 'INVALID_PRICE');
        line.unitPrice = p;
      }
      if (patch.notes !== undefined) line.notes = String(patch.notes).trim().slice(0, 1000);
      line.lineSubtotal = roundMoney(line.quantityOrdered * line.unitPrice - (line.discountAmount || 0));
    }
  }

  const deliveryCharges =
    input.deliveryCharges !== undefined ? Math.max(0, Number(input.deliveryCharges) || 0) : po.deliveryCharges;
  const discountAmount =
    input.discountAmount !== undefined ? Math.max(0, Number(input.discountAmount) || 0) : po.discountAmount;
  const totals = computePoTotals(po.lines || [], deliveryCharges, discountAmount);
  Object.assign(po, totals);

  const after = {
    deliveryAddress: po.deliveryAddress,
    expectedDeliveryDate: po.expectedDeliveryDate,
    terms: po.terms,
    notes: po.notes,
    deliveryCharges: po.deliveryCharges,
    discountAmount: po.discountAmount,
    lines: (po.lines || []).map((l) => ({
      lineId: l.lineId,
      quantityOrdered: l.quantityOrdered,
      unitPrice: l.unitPrice,
      notes: l.notes
    }))
  };

  po.amendments = po.amendments || [];
  po.amendments.push({
    amendmentId: publicRef('AMD', 4),
    reason: reason.slice(0, 1000),
    changedBy: new mongoose.Types.ObjectId(user.id),
    changedAt: new Date(),
    before,
    after
  });
  po.revision = (po.revision || 1) + 1;
  await po.save();

  await writeAudit({
    actor: user.id,
    action: 'supplier_po.amend',
    entityType: 'SupplierPurchaseOrder',
    entityId: po._id,
    shop: po.shop,
    details: { publicId: po.publicId, reason, revision: po.revision }
  });

  const owner = await supplierOwnerId(String(po.supplierBusiness));
  await notifyUsers(
    [owner, ...(await shopReceivingUserIds(String(po.shop)))],
    'supplier_po',
    'PO amended',
    `${po.publicId} was amended (rev ${po.revision})`,
    { purchaseOrderId: String(po._id) }
  );

  return serializePurchaseOrder(po);
}

export async function getPurchaseOrder(user: AuthUser, poId: string) {
  if (user.role === 'supplier') {
    const { po } = await loadPoForSupplier(user, poId);
    return serializePurchaseOrder(po);
  }
  const po = await loadPoForShop(user, poId, { receivingOk: true });
  return serializePurchaseOrder(po);
}

export async function listShopPurchaseOrders(user: AuthUser, shopId: string, status?: string) {
  assertShopAccess(user, shopId);
  const filter: Record<string, unknown> = { shop: shopId };
  if (status) filter.status = status;
  const rows = await SupplierPurchaseOrder.find(filter).sort({ createdAt: -1 }).limit(200);
  return rows.map(serializePurchaseOrder);
}

export async function listReceivablePurchaseOrders(user: AuthUser, shopId: string, status?: string) {
  assertShopReceivingAccess(user, shopId);
  const filter: Record<string, unknown> = {
    shop: shopId,
    status: { $in: ['issued', 'acknowledged', 'partially_fulfilled', 'fulfilled'] }
  };
  if (status) filter.status = status;
  const rows = await SupplierPurchaseOrder.find(filter).sort({ createdAt: -1 }).limit(200);
  return rows.map(serializePurchaseOrder);
}

export async function listSupplierPurchaseOrders(user: AuthUser, status?: string) {
  const business = await requireApprovedSupplierBusiness(user.id);
  const filter: Record<string, unknown> = {
    supplierBusiness: business._id,
    status: { $nin: ['draft'] }
  };
  if (status) filter.status = status;
  const rows = await SupplierPurchaseOrder.find(filter).sort({ createdAt: -1 }).limit(200);
  return rows.map(serializePurchaseOrder);
}

export async function refreshPurchaseOrderFulfilmentStatus(
  po: InstanceType<typeof SupplierPurchaseOrder>,
  session?: mongoose.ClientSession
) {
  const lines = po.lines || [];
  if (!lines.length) return po;
  const allFulfilled = lines.every((l) => (l.quantityReceivedAccepted || 0) >= l.quantityOrdered);
  const anyReceived = lines.some((l) => (l.quantityReceivedAccepted || 0) > 0);
  if (allFulfilled && ['acknowledged', 'partially_fulfilled', 'issued'].includes(po.status)) {
    po.status = 'fulfilled';
    if (!po.fulfilledAt) po.fulfilledAt = new Date();
  } else if (anyReceived && ['acknowledged', 'issued'].includes(po.status)) {
    po.status = 'partially_fulfilled';
  }
  await po.save({ session });
  return po;
}

export async function getPurchaseOrderPrintData(user: AuthUser, poId: string) {
  const data = await getPurchaseOrder(user, poId);
  const po = await SupplierPurchaseOrder.findById(data.id);
  if (!po) throw new AppError('Purchase order not found', 404, 'NOT_FOUND');
  const [shop, supplier] = await Promise.all([
    RepairShop.findById(po.shop).select('name address city region phone email'),
    SupplierBusiness.findById(po.supplierBusiness).select(
      'businessName address city region businessPhone businessEmail'
    )
  ]);
  return {
    ...data,
    shop: shop
      ? {
          name: shop.name,
          address: shop.address,
          city: shop.city,
          region: shop.region,
          phone: shop.phone,
          email: shop.email
        }
      : null,
    supplier: supplier
      ? {
          businessName: supplier.businessName,
          address: supplier.address,
          city: supplier.city,
          region: supplier.region,
          phone: supplier.businessPhone,
          email: supplier.businessEmail
        }
      : null
  };
}
