import mongoose from 'mongoose';
import {
  SupplierBusiness,
  SupplierPurchaseOrder,
  SupplierQuotation,
  SupplierRfq,
  SupplierShipment
} from '../models/index.js';
import {
  metricOrInsufficient,
  SUPPLIER_PERFORMANCE_MIN_SAMPLES
} from '../constants/supplierPerformance.js';
import { AppError } from '../utils/errors.js';
import type { AuthUser } from '../middleware/auth.js';
import { requireApprovedSupplierBusiness } from './supplierNetworkShared.js';
import { aggregateVerifiedReviewStats } from './supplierReviews.js';
import { SUPPLIER_GENUINE_RATING_MIN_REVIEWS } from '../models/SupplierReview.js';

/**
 * Performance formulas (server-side only — never client-supplied):
 *
 * Fulfilment rate:
 *   Denominator sample = non-cancelled POs in issued|acknowledged|partially_fulfilled|fulfilled|closed.
 *   Value = sum(quantityReceivedAccepted) ÷ sum(quantityOrdered) across those POs.
 *   Partial fulfilment appears as a ratio < 1 (e.g. 7/10 → 70%).
 *   Cancelled POs (shop or supplier) are excluded from both numerator and denominator.
 *
 * On-time delivery (arrived shipments only):
 *   Eligible unit = shipment with status in dispatched|in_transit|delayed|delivered that has:
 *     (a) a valid expected date (shipment.expectedArrivalDate OR PO.supplierExpectedDeliveryDate
 *         OR PO.expectedDeliveryDate), AND
 *     (b) an actual arrival signal (actualArrivalDate, or dispatchDate when status=delivered).
 *   Shipments without a valid expected date are excluded (not counted against the supplier).
 *   Incomplete shipments without an actual arrival are NOT in the on-time denominator.
 *   On-time when actual <= end of expected date day.
 *
 * Pending overdue (reported separately — not mixed into on-time %):
 *   Shipments with a valid expected date in the past, no actual arrival yet, and status not delivered.
 *   Surfaced as pendingOverdue so marketplace never treats in-flight late work as “on time”.
 *
 * Quotation response time (hours):
 *   For RFQs that include this supplier, were sent (sentAt set), and are not cancelled/expired/draft,
 *   take the supplier’s first valid quotation submission timestamp:
 *     firstSubmittedAt || submittedAt (preserved even if the quotation is later withdrawn).
 *   Draft-only quotations (no submission timestamp) are excluded.
 *   responseHours = (firstSubmit - rfq.sentAt) / 3600000. Average across samples.
 *
 * Supplier cancellation rate:
 *   Denominator = POs that reached issued (issuedAt set) for this supplier.
 *   Numerator = those cancelled via supplier reject (rejectedAt set) OR cancelReason starting with
 *   "Supplier rejected". Shop-initiated cancels are excluded from the numerator.
 *
 * Verified reviews:
 *   Averages over published + reported + moderated verified reviews with isGenuine=true.
 *   Hidden / unpublished reviews never affect public ratings. See supplierReviews VISIBLE_STATUSES.
 */

function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function isSupplierInitiatedCancel(po: {
  rejectedAt?: Date | null;
  cancelReason?: string | null;
}) {
  if (po.rejectedAt) return true;
  const reason = String(po.cancelReason || '');
  return /^Supplier rejected:/i.test(reason);
}

export async function computeSupplierPerformance(supplierBusinessId: mongoose.Types.ObjectId) {
  const pos = await SupplierPurchaseOrder.find({
    supplierBusiness: supplierBusinessId,
    status: { $ne: 'draft' }
  }).select(
    'status lines issuedAt cancelledAt rejectedAt cancelReason expectedDeliveryDate supplierExpectedDeliveryDate'
  );

  // --- Fulfilment ---
  let orderedQty = 0;
  let acceptedQty = 0;
  let fulfilmentPoCount = 0;
  for (const po of pos) {
    if (po.status === 'cancelled') continue;
    if (!['issued', 'acknowledged', 'partially_fulfilled', 'fulfilled', 'closed'].includes(po.status)) {
      continue;
    }
    fulfilmentPoCount += 1;
    for (const line of po.lines || []) {
      orderedQty += Number(line.quantityOrdered || 0);
      acceptedQty += Number(line.quantityReceivedAccepted || 0);
    }
  }
  const fulfilmentRatio = orderedQty > 0 ? acceptedQty / orderedQty : null;
  const fulfilmentRate = metricOrInsufficient(
    fulfilmentRatio !== null ? Math.round(fulfilmentRatio * 1000) / 10 : null,
    fulfilmentPoCount,
    SUPPLIER_PERFORMANCE_MIN_SAMPLES.fulfilmentRate,
    (v) => `${v}%`
  );

  // --- On-time delivery + pending overdue ---
  const shipments = await SupplierShipment.find({
    supplierBusiness: supplierBusinessId,
    status: { $in: ['dispatched', 'in_transit', 'delayed', 'delivered'] }
  }).select('purchaseOrder expectedArrivalDate actualArrivalDate dispatchDate status');

  const poExpected = new Map<string, Date | null>();
  for (const po of pos) {
    poExpected.set(
      String(po._id),
      po.supplierExpectedDeliveryDate || po.expectedDeliveryDate || null
    );
  }

  const now = Date.now();
  let onTimeEligible = 0;
  let onTimeCount = 0;
  let missingExpectedDate = 0;
  let incompleteNoActual = 0;
  let pendingOverdue = 0;

  for (const sh of shipments) {
    const expected =
      sh.expectedArrivalDate || poExpected.get(String(sh.purchaseOrder)) || null;
    if (!expected) {
      missingExpectedDate += 1;
      continue; // missing expected date → excluded from on-time
    }

    const actual = sh.actualArrivalDate || (sh.status === 'delivered' ? sh.dispatchDate : null);
    if (!actual) {
      incompleteNoActual += 1;
      if (
        sh.status !== 'delivered' &&
        endOfDay(new Date(expected)).getTime() < now
      ) {
        pendingOverdue += 1;
      }
      // Incomplete / in-flight: not in on-time denominator (avoids misleading %).
      continue;
    }

    onTimeEligible += 1;
    if (new Date(actual).getTime() <= endOfDay(new Date(expected)).getTime()) {
      onTimeCount += 1;
    }
  }
  const onTimeRatio = onTimeEligible > 0 ? onTimeCount / onTimeEligible : null;
  const onTimeDelivery = metricOrInsufficient(
    onTimeRatio !== null ? Math.round(onTimeRatio * 1000) / 10 : null,
    onTimeEligible,
    SUPPLIER_PERFORMANCE_MIN_SAMPLES.onTimeDelivery,
    (v) => `${v}%`
  );

  // --- Quotation response time ---
  const rfqs = await SupplierRfq.find({
    supplierBusinesses: supplierBusinessId,
    sentAt: { $exists: true, $ne: null },
    status: { $nin: ['cancelled', 'expired', 'draft'] }
  }).select('_id sentAt status');

  // Include withdrawn quotations: firstSubmittedAt/submittedAt are preserved on withdraw.
  const quotes = await SupplierQuotation.find({
    supplierBusiness: supplierBusinessId,
    rfq: { $in: rfqs.map((r) => r._id) },
    status: { $ne: 'draft' },
    $or: [
      { firstSubmittedAt: { $exists: true, $ne: null } },
      { submittedAt: { $exists: true, $ne: null } }
    ]
  }).select('rfq submittedAt firstSubmittedAt status');

  const firstByRfq = new Map<string, Date>();
  for (const q of quotes) {
    const key = String(q.rfq);
    const submitted =
      (q as { firstSubmittedAt?: Date }).firstSubmittedAt || q.submittedAt;
    if (!submitted) continue;
    const prev = firstByRfq.get(key);
    if (!prev || submitted < prev) firstByRfq.set(key, submitted);
  }

  const responseHours: number[] = [];
  for (const rfq of rfqs) {
    const first = firstByRfq.get(String(rfq._id));
    if (!first || !rfq.sentAt) continue;
    const hours = (first.getTime() - new Date(rfq.sentAt).getTime()) / 3600000;
    if (hours >= 0) responseHours.push(hours);
  }
  const avgHours =
    responseHours.length > 0
      ? Math.round((responseHours.reduce((a, b) => a + b, 0) / responseHours.length) * 10) / 10
      : null;
  const quotationResponseTime = metricOrInsufficient(
    avgHours,
    responseHours.length,
    SUPPLIER_PERFORMANCE_MIN_SAMPLES.quotationResponse,
    (v) => `${v}h`
  );

  // --- Supplier cancellation rate ---
  const issued = pos.filter((p) => Boolean(p.issuedAt));
  const supplierCancels = issued.filter(
    (p) => p.status === 'cancelled' && isSupplierInitiatedCancel(p)
  );
  const cancelRatio = issued.length > 0 ? supplierCancels.length / issued.length : null;
  const cancellationRate = metricOrInsufficient(
    cancelRatio !== null ? Math.round(cancelRatio * 1000) / 10 : null,
    issued.length,
    SUPPLIER_PERFORMANCE_MIN_SAMPLES.cancellationRate,
    (v) => `${v}%`
  );

  // --- Verified reviews ---
  const reviewStats = await aggregateVerifiedReviewStats(supplierBusinessId);
  const enoughReviews = reviewStats.count >= SUPPLIER_GENUINE_RATING_MIN_REVIEWS;
  const verifiedReviews = {
    overallAverage: enoughReviews ? reviewStats.overall : null,
    categoryAverages: enoughReviews ? reviewStats.categories : null,
    totalPublishedVerified: reviewStats.count,
    sampleCount: reviewStats.count,
    enoughData: enoughReviews,
    label: enoughReviews
      ? `${reviewStats.overall}★ (${reviewStats.count})`
      : reviewStats.count === 0
        ? 'No verified reviews'
        : 'Not enough data',
    minSamples: SUPPLIER_GENUINE_RATING_MIN_REVIEWS
  };

  // Simple trend: last 90d fulfilment vs prior 90d when both have enough samples
  const d90 = 90 * 24 * 60 * 60 * 1000;
  const recentPos = pos.filter((p) => {
    const t = (p as { updatedAt?: Date; issuedAt?: Date }).issuedAt || (p as { updatedAt?: Date }).updatedAt;
    return t && now - new Date(t).getTime() <= d90 && p.status !== 'cancelled';
  });
  const priorPos = pos.filter((p) => {
    const t = (p as { updatedAt?: Date; issuedAt?: Date }).issuedAt || (p as { updatedAt?: Date }).updatedAt;
    if (!t) return false;
    const age = now - new Date(t).getTime();
    return age > d90 && age <= 2 * d90 && p.status !== 'cancelled';
  });
  function fillRate(list: typeof pos) {
    let o = 0;
    let a = 0;
    for (const po of list) {
      if (!['issued', 'acknowledged', 'partially_fulfilled', 'fulfilled', 'closed'].includes(po.status)) continue;
      for (const line of po.lines || []) {
        o += Number(line.quantityOrdered || 0);
        a += Number(line.quantityReceivedAccepted || 0);
      }
    }
    return o > 0 ? Math.round((a / o) * 1000) / 10 : null;
  }
  const recentFill = fillRate(recentPos);
  const priorFill = fillRate(priorPos);
  const trends =
    recentPos.length >= SUPPLIER_PERFORMANCE_MIN_SAMPLES.fulfilmentRate &&
    priorPos.length >= SUPPLIER_PERFORMANCE_MIN_SAMPLES.fulfilmentRate &&
    recentFill !== null &&
    priorFill !== null
      ? {
          fulfilmentRate: {
            recent90d: recentFill,
            prior90d: priorFill,
            direction: recentFill === priorFill ? 'flat' : recentFill > priorFill ? 'up' : 'down',
            sampleCounts: { recent90d: recentPos.length, prior90d: priorPos.length }
          }
        }
      : null;

  return {
    definitions: {
      fulfilmentRate:
        'Accepted received quantity ÷ ordered quantity on non-cancelled issued POs. Partial fulfilment reduces the ratio. Cancelled POs excluded.',
      onTimeDelivery:
        'Share of ARRIVED shipments (with actual arrival) that met a valid expected delivery date. Shipments without expected date or without actual arrival are excluded from this percentage.',
      pendingOverdue:
        'Count of in-flight shipments past their expected date with no actual arrival yet. Reported separately — never counted as on-time.',
      quotationResponseTime:
        'Average hours from RFQ sentAt to the supplier’s first valid quotation submission (firstSubmittedAt/submittedAt). Preserved if the quotation is later withdrawn. Cancelled/expired/draft RFQs and draft-only quotations excluded.',
      cancellationRate:
        'Supplier-initiated cancellations (rejects) ÷ issued POs. Shop-initiated cancellations are excluded from the numerator.',
      verifiedReviews:
        'Averages over published, reported, and moderated verified reviews (isGenuine=true). Hidden reviews never affect public ratings. Status "moderated" means operator restored visibility after review — still rating-eligible.'
    },
    thresholds: SUPPLIER_PERFORMANCE_MIN_SAMPLES,
    fulfilmentRate,
    onTimeDelivery,
    pendingOverdue: {
      count: pendingOverdue,
      sampleCount: pendingOverdue,
      label:
        pendingOverdue === 0
          ? 'No pending overdue shipments'
          : `${pendingOverdue} pending overdue shipment(s)`
    },
    quotationResponseTime,
    cancellationRate,
    verifiedReviews,
    trends,
    raw: {
      fulfilment: { orderedQty, acceptedQty, poCount: fulfilmentPoCount },
      onTime: {
        onTimeCount,
        eligible: onTimeEligible,
        missingExpectedDate,
        incompleteNoActual,
        pendingOverdue
      },
      cancellation: { supplierCancels: supplierCancels.length, issued: issued.length }
    }
  };
}

export async function getSupplierPerformanceForBusiness(publicIdOrId: string) {
  const key = String(publicIdOrId || '').trim();
  const business = await SupplierBusiness.findOne({
    $or: [{ publicId: key }, ...(mongoose.isValidObjectId(key) ? [{ _id: key }] : [])]
  }).select('_id publicId businessName verified status isActive');
  if (!business) throw new AppError('Supplier not found', 404, 'NOT_FOUND');
  const performance = await computeSupplierPerformance(business._id);
  return {
    supplierBusinessId: String(business._id),
    publicId: business.publicId,
    businessName: business.businessName,
    verified: Boolean(business.verified),
    performance
  };
}

export async function getMySupplierPerformance(user: AuthUser) {
  const business = await requireApprovedSupplierBusiness(user.id);
  const performance = await computeSupplierPerformance(business._id);
  return {
    supplierBusinessId: String(business._id),
    publicId: business.publicId,
    businessName: business.businessName,
    verified: Boolean(business.verified),
    performance
  };
}

export async function performanceMap(businessIds: mongoose.Types.ObjectId[]) {
  const map = new Map<string, Awaited<ReturnType<typeof computeSupplierPerformance>>>();
  await Promise.all(
    businessIds.map(async (id) => {
      map.set(String(id), await computeSupplierPerformance(id));
    })
  );
  return map;
}
