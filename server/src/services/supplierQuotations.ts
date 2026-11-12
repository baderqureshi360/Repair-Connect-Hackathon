import mongoose from 'mongoose';
import { SupplierQuotation, SupplierRfq, SupplierBusiness } from '../models/index.js';
import { AppError } from '../utils/errors.js';
import { writeAudit } from './audit.js';
import type { AuthUser } from '../middleware/auth.js';
import {
  assertShopAccess,
  lineId,
  notifyUsers,
  publicRef,
  requireApprovedSupplierBusiness,
  shopAdminUserIds
} from './supplierNetworkShared.js';
import { maybeExpire, serializeQuotationBrief, serializeRfq } from './supplierRfqs.js';

type QuoteLineInput = {
  rfqLineId: string;
  unitPrice: number;
  availableQuantity: number;
  quotedQuantity: number;
  moq?: number;
  unavailable?: boolean;
  isAlternative?: boolean;
  alternativeName?: string;
  alternativeSku?: string;
  warranty?: string;
  notes?: string;
};

function computeTotals(
  lines: Array<{ unitPrice: number; quotedQuantity: number; unavailable?: boolean }>,
  deliveryCharges: number,
  taxAmount: number,
  taxPercent: number
) {
  const subtotal = lines.reduce((sum, l) => {
    if (l.unavailable) return sum;
    return sum + Number(l.unitPrice || 0) * Number(l.quotedQuantity || 0);
  }, 0);
  const tax =
    taxAmount > 0 ? taxAmount : Math.round(((subtotal + deliveryCharges) * (taxPercent || 0)) / 100);
  const totalAmount = Math.round((subtotal + deliveryCharges + tax) * 100) / 100;
  return { subtotal: Math.round(subtotal * 100) / 100, taxAmount: tax, totalAmount };
}

function normalizeLines(rfq: InstanceType<typeof SupplierRfq>, lines: QuoteLineInput[]) {
  const rfqLineIds = new Set((rfq.items || []).map((i) => i.lineId));
  if (!lines?.length) throw new AppError('Quotation lines are required', 400, 'LINES_REQUIRED');

  return lines.map((line) => {
    if (!rfqLineIds.has(line.rfqLineId)) {
      throw new AppError(`Unknown RFQ line ${line.rfqLineId}`, 400, 'INVALID_LINE');
    }
    const unavailable = Boolean(line.unavailable);
    const unitPrice = Number(line.unitPrice);
    const availableQuantity = Math.max(0, Math.floor(Number(line.availableQuantity) || 0));
    const quotedQuantity = Math.max(0, Math.floor(Number(line.quotedQuantity) || 0));
    if (!unavailable) {
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        throw new AppError('Unit price must be >= 0', 400, 'INVALID_PRICE');
      }
      if (quotedQuantity < 1) throw new AppError('Quoted quantity required', 400, 'INVALID_QTY');
    }
    if (line.isAlternative && !String(line.alternativeName || '').trim()) {
      throw new AppError('Alternative products require a name', 400, 'ALT_NAME_REQUIRED');
    }
    return {
      lineId: lineId(),
      rfqLineId: line.rfqLineId,
      unitPrice: unavailable ? 0 : unitPrice,
      availableQuantity,
      quotedQuantity: unavailable ? 0 : quotedQuantity,
      moq: Math.max(1, Math.floor(Number(line.moq) || 1)),
      unavailable,
      isAlternative: Boolean(line.isAlternative),
      alternativeName: String(line.alternativeName || '').trim().slice(0, 160),
      alternativeSku: String(line.alternativeSku || '').trim().slice(0, 80),
      warranty: String(line.warranty || '').trim().slice(0, 200),
      notes: String(line.notes || '').trim().slice(0, 1000)
    };
  });
}

async function loadAddressedRfq(businessId: string, rfqIdOrPublic: string) {
  const key = String(rfqIdOrPublic || '').trim();
  const rfq = await SupplierRfq.findOne({
    $or: [{ publicId: key }, ...(mongoose.isValidObjectId(key) ? [{ _id: key }] : [])]
  });
  if (!rfq) throw new AppError('RFQ not found', 404, 'NOT_FOUND');
  await maybeExpire(rfq);
  const addressed = (rfq.supplierBusinesses || []).some((id) => String(id) === String(businessId));
  if (!addressed || rfq.status === 'draft') throw new AppError('RFQ not found', 404, 'NOT_FOUND');
  if (['cancelled', 'expired', 'completed'].includes(rfq.status)) {
    throw new AppError(`RFQ is ${rfq.status}`, 409, 'RFQ_CLOSED');
  }
  return rfq;
}

export async function submitQuotation(input: {
  user: AuthUser;
  rfqId: string;
  lines: QuoteLineInput[];
  deliveryCharges?: number;
  taxAmount?: number;
  taxPercent?: number;
  estimatedDeliveryDate?: string;
  warranty?: string;
  validityUntil?: string;
  notes?: string;
  currency?: string;
}) {
  const business = await requireApprovedSupplierBusiness(input.user.id);
  const rfq = await loadAddressedRfq(String(business._id), input.rfqId);

  const existing = await SupplierQuotation.findOne({
    rfq: rfq._id,
    supplierBusiness: business._id
  });
  if (existing && ['accepted'].includes(existing.status)) {
    throw new AppError('Accepted quotations cannot be modified', 409, 'LOCKED');
  }
  if (existing && existing.status === 'withdrawn') {
    throw new AppError('Withdrawn quotations cannot be resubmitted; contact the shop', 409, 'WITHDRAWN');
  }

  const lines = normalizeLines(rfq, input.lines);
  const deliveryCharges = Math.max(0, Number(input.deliveryCharges) || 0);
  const taxPercent = Math.max(0, Math.min(100, Number(input.taxPercent) || 0));
  const taxAmountInput = Math.max(0, Number(input.taxAmount) || 0);
  const totals = computeTotals(lines, deliveryCharges, taxAmountInput, taxPercent);

  let quotation: InstanceType<typeof SupplierQuotation>;
  if (existing) {
    existing.lines = lines as typeof existing.lines;
    existing.deliveryCharges = deliveryCharges;
    existing.taxPercent = taxPercent;
    existing.taxAmount = totals.taxAmount;
    existing.subtotal = totals.subtotal;
    existing.totalAmount = totals.totalAmount;
    existing.estimatedDeliveryDate = input.estimatedDeliveryDate
      ? new Date(input.estimatedDeliveryDate)
      : undefined;
    existing.warranty = String(input.warranty || '').trim().slice(0, 200);
    existing.validityUntil = input.validityUntil ? new Date(input.validityUntil) : undefined;
    existing.notes = String(input.notes || '').trim().slice(0, 2000);
    existing.currency = String(input.currency || existing.currency || 'PKR').slice(0, 8);
    existing.revision = (existing.revision || 1) + (existing.status === 'submitted' || existing.status === 'revised' ? 1 : 0);
    existing.status = existing.status === 'draft' || !existing.submittedAt ? 'submitted' : 'revised';
    const submittedNow = new Date();
    // Preserve first valid submission forever (including after later withdraw).
    existing.firstSubmittedAt = existing.firstSubmittedAt || existing.submittedAt || submittedNow;
    existing.submittedAt = existing.submittedAt || submittedNow;
    existing.submittedBy = new mongoose.Types.ObjectId(input.user.id);
    await existing.save();
    quotation = existing;
  } else {
    const submittedNow = new Date();
    quotation = await SupplierQuotation.create({
      publicId: publicRef('QT', 5),
      rfq: rfq._id,
      supplierBusiness: business._id,
      submittedBy: input.user.id,
      status: 'submitted',
      revision: 1,
      lines,
      deliveryCharges,
      taxPercent,
      taxAmount: totals.taxAmount,
      subtotal: totals.subtotal,
      totalAmount: totals.totalAmount,
      estimatedDeliveryDate: input.estimatedDeliveryDate
        ? new Date(input.estimatedDeliveryDate)
        : undefined,
      warranty: String(input.warranty || '').trim().slice(0, 200),
      validityUntil: input.validityUntil ? new Date(input.validityUntil) : undefined,
      notes: String(input.notes || '').trim().slice(0, 2000),
      currency: String(input.currency || 'PKR').slice(0, 8),
      firstSubmittedAt: submittedNow,
      submittedAt: submittedNow
    });
  }

  const quoteCount = await SupplierQuotation.countDocuments({
    rfq: rfq._id,
    status: { $in: ['submitted', 'revised', 'accepted'] }
  });
  if (rfq.status === 'sent' && quoteCount >= 1) {
    rfq.status = quoteCount >= (rfq.supplierBusinesses || []).length ? 'partially_responded' : 'partially_responded';
    // Keep partially_responded until all respond or shop completes; if all responded still partially until accept
    await rfq.save();
  } else if (rfq.status === 'sent') {
    rfq.status = 'partially_responded';
    await rfq.save();
  }

  const admins = await shopAdminUserIds(String(rfq.shop));
  await notifyUsers(
    admins,
    'supplier_quotation',
    'New supplier quotation',
    `${quotation.publicId} for ${rfq.publicId}`,
    { rfqId: String(rfq._id), quotationId: String(quotation._id) }
  );

  await writeAudit({
    actor: input.user.id,
    action: existing ? 'supplier_quotation.revise' : 'supplier_quotation.submit',
    entityType: 'SupplierQuotation',
    entityId: quotation._id,
    shop: rfq.shop,
    details: { publicId: quotation.publicId, rfqPublicId: rfq.publicId, totalAmount: quotation.totalAmount }
  });

  return serializeQuotationBrief(quotation);
}

export async function withdrawQuotation(input: {
  user: AuthUser;
  quotationId: string;
  reason: string;
}) {
  const business = await requireApprovedSupplierBusiness(input.user.id);
  const quotation = await SupplierQuotation.findById(input.quotationId);
  if (!quotation || String(quotation.supplierBusiness) !== String(business._id)) {
    throw new AppError('Quotation not found', 404, 'NOT_FOUND');
  }
  if (quotation.status === 'accepted') {
    throw new AppError('Accepted quotations cannot be withdrawn', 409, 'LOCKED');
  }
  if (quotation.status === 'withdrawn') {
    throw new AppError('Already withdrawn', 409, 'ALREADY_WITHDRAWN');
  }
  const reason = String(input.reason || '').trim();
  if (reason.length < 5) throw new AppError('Withdrawal reason required', 400, 'REASON_REQUIRED');

  quotation.status = 'withdrawn';
  quotation.withdrawnReason = reason.slice(0, 1000);
  quotation.withdrawnAt = new Date();
  // Do not clear firstSubmittedAt / submittedAt — response-time metrics still count the first valid submit.
  await quotation.save();

  const rfq = await SupplierRfq.findById(quotation.rfq);
  if (rfq) {
    const admins = await shopAdminUserIds(String(rfq.shop));
    await notifyUsers(
      admins,
      'supplier_quotation',
      'Quotation withdrawn',
      `${quotation.publicId} withdrawn`,
      { rfqId: String(rfq._id), quotationId: String(quotation._id) }
    );
  }

  await writeAudit({
    actor: input.user.id,
    action: 'supplier_quotation.withdraw',
    entityType: 'SupplierQuotation',
    entityId: quotation._id,
    shop: rfq?.shop,
    details: { reason, publicId: quotation.publicId }
  });

  return serializeQuotationBrief(quotation);
}

export async function compareQuotations(user: AuthUser, rfqId: string) {
  const key = String(rfqId || '').trim();
  const rfq = await SupplierRfq.findOne({
    $or: [{ publicId: key }, ...(mongoose.isValidObjectId(key) ? [{ _id: key }] : [])]
  });
  if (!rfq) throw new AppError('RFQ not found', 404, 'NOT_FOUND');
  assertShopAccess(user, String(rfq.shop));
  await maybeExpire(rfq);

  const quotations = await SupplierQuotation.find({
    rfq: rfq._id,
    status: { $in: ['submitted', 'revised', 'accepted'] }
  });
  const suppliers = await SupplierBusiness.find({
    _id: { $in: quotations.map((q) => q.supplierBusiness) }
  }).select('businessName publicId verified city');
  const bySupplier = new Map(suppliers.map((s) => [String(s._id), s]));

  const columns = quotations.map((q) => {
    const biz = bySupplier.get(String(q.supplierBusiness));
    const brief = serializeQuotationBrief(q);
    return {
      ...brief,
      supplier: biz
        ? {
            id: String(biz._id),
            publicId: biz.publicId,
            businessName: biz.businessName,
            verified: Boolean(biz.verified),
            city: biz.city
          }
        : null,
      // Explicitly no auto-ranking by price
      suggested: false
    };
  });

  const itemMatrix = (rfq.items || []).map((item) => ({
    rfqLineId: item.lineId,
    name: item.name,
    requestedQuantity: item.quantity,
    quotes: columns.map((col) => {
      const line = col.lines.find((l) => l.rfqLineId === item.lineId);
      if (!line) {
        return {
          quotationId: col.id,
          missing: true,
          unavailable: true,
          unitPrice: null,
          quotedQuantity: 0,
          lineTotal: 0,
          isAlternative: false
        };
      }
      return {
        quotationId: col.id,
        missing: false,
        unavailable: line.unavailable,
        unitPrice: line.unitPrice,
        quotedQuantity: line.quotedQuantity,
        availableQuantity: line.availableQuantity,
        moq: line.moq,
        lineTotal: line.lineTotal,
        isAlternative: line.isAlternative,
        alternativeName: line.alternativeName,
        warranty: line.warranty
      };
    })
  }));

  return {
    rfq: serializeRfq(rfq),
    columns,
    itemMatrix,
    note: 'No quotation is auto-selected. Review totals, delivery, and alternatives before accepting.'
  };
}

function isTransientTxnError(err: unknown) {
  const e = err as { code?: number; errorLabels?: string[]; hasErrorLabel?: (l: string) => boolean };
  if (!e) return false;
  if (e.code === 112 || e.code === 24) return true;
  if (typeof e.hasErrorLabel === 'function' && e.hasErrorLabel('TransientTransactionError')) return true;
  return Array.isArray(e.errorLabels) && e.errorLabels.includes('TransientTransactionError');
}

export async function acceptQuotation(input: {
  user: AuthUser;
  rfqId: string;
  quotationId: string;
  acceptedLineIds?: string[];
}) {
  const key = String(input.rfqId || '').trim();
  const rfq = await SupplierRfq.findOne({
    $or: [{ publicId: key }, ...(mongoose.isValidObjectId(key) ? [{ _id: key }] : [])]
  });
  if (!rfq) throw new AppError('RFQ not found', 404, 'NOT_FOUND');
  assertShopAccess(input.user, String(rfq.shop));
  await maybeExpire(rfq);
  if (['cancelled', 'expired', 'completed'].includes(rfq.status)) {
    throw new AppError('RFQ is closed', 409, 'RFQ_CLOSED');
  }

  const maxAttempts = 4;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      const lockedRfq = await SupplierRfq.findById(rfq._id).session(session);
      if (!lockedRfq) throw new AppError('RFQ not found', 404, 'NOT_FOUND');
      if (lockedRfq.status === 'completed' && lockedRfq.acceptedQuotation) {
        throw new AppError('RFQ already has an accepted quotation', 409, 'ALREADY_ACCEPTED');
      }

      const quotation = await SupplierQuotation.findOne({
        _id: input.quotationId,
        rfq: lockedRfq._id,
        status: { $in: ['submitted', 'revised'] }
      }).session(session);
      if (!quotation) throw new AppError('Quotation not found or not acceptable', 404, 'NOT_FOUND');

      if (quotation.validityUntil && quotation.validityUntil.getTime() < Date.now()) {
        quotation.status = 'expired';
        await quotation.save({ session });
        await session.commitTransaction();
        throw new AppError('Quotation has expired', 409, 'QUOTE_EXPIRED');
      }

      const acceptedLineIds = (input.acceptedLineIds || []).map(String).filter(Boolean);
      if (acceptedLineIds.length) {
        const valid = new Set((quotation.lines || []).map((l) => l.lineId));
        for (const id of acceptedLineIds) {
          if (!valid.has(id)) throw new AppError(`Invalid line ${id}`, 400, 'INVALID_LINE');
        }
      }

      quotation.status = 'accepted';
      quotation.acceptedAt = new Date();
      await quotation.save({ session });

      await SupplierQuotation.updateMany(
        {
          rfq: lockedRfq._id,
          _id: { $ne: quotation._id },
          status: { $in: ['submitted', 'revised', 'draft'] }
        },
        { $set: { status: 'rejected' } },
        { session }
      );

      lockedRfq.status = 'completed';
      lockedRfq.completedAt = new Date();
      lockedRfq.acceptedQuotation = quotation._id;
      lockedRfq.acceptedLineIds = acceptedLineIds;
      await lockedRfq.save({ session });

      await session.commitTransaction();

      await writeAudit({
        actor: input.user.id,
        action: 'supplier_quotation.accept',
        entityType: 'SupplierQuotation',
        entityId: quotation._id,
        shop: lockedRfq.shop,
        details: {
          rfqPublicId: lockedRfq.publicId,
          quotationPublicId: quotation.publicId,
          acceptedLineIds,
          totalAmount: quotation.totalAmount
        }
      });

      const owner = await SupplierBusiness.findById(quotation.supplierBusiness).select('owner');
      await notifyUsers(
        [owner?.owner],
        'supplier_quotation',
        'Quotation accepted',
        `${quotation.publicId} was accepted for ${lockedRfq.publicId}`,
        { rfqId: String(lockedRfq._id), quotationId: String(quotation._id) }
      );

      return {
        rfq: serializeRfq(lockedRfq),
        quotation: serializeQuotationBrief(quotation)
      };
    } catch (err) {
      await session.abortTransaction().catch(() => undefined);
      if (err instanceof AppError) throw err;
      lastErr = err;
      if (isTransientTxnError(err) && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 25 * attempt));
        // Re-check completed state before retry
        const latest = await SupplierRfq.findById(rfq._id);
        if (latest?.status === 'completed') {
          throw new AppError('RFQ already has an accepted quotation', 409, 'ALREADY_ACCEPTED');
        }
        continue;
      }
      throw err;
    } finally {
      session.endSession();
    }
  }
  throw lastErr;
}
