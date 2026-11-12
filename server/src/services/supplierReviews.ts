import mongoose from 'mongoose';
import {
  GoodsReceipt,
  SupplierBusiness,
  SupplierPurchaseOrder,
  SupplierReview
} from '../models/index.js';
import {
  SUPPLIER_REVIEW_CATEGORIES,
  SUPPLIER_REVIEW_EDIT_WINDOW_MS,
  type SupplierReviewCategory
} from '../models/SupplierReview.js';
import { AppError } from '../utils/errors.js';
import type { AuthUser } from '../middleware/auth.js';
import { writeAudit } from './audit.js';
import { publicRef, requireApprovedSupplierBusiness } from './supplierNetworkShared.js';

/**
 * Public visibility + rating eligibility statuses.
 *
 * - published: normal verified shop review — counts in public averages.
 * - reported: flagged for moderation but still visible until hidden — counts in public averages
 *   (report does not silently erase ratings).
 * - moderated: operator restored / cleared a report after investigation — remains publicly visible
 *   and rating-eligible (treated as published for averages; status records moderation outcome).
 * - hidden: operator-hidden — NEVER visible publicly and NEVER included in averages
 *   (isGenuine forced false; original review body and moderationHistory preserved).
 */
const VISIBLE_STATUSES = ['published', 'reported', 'moderated'] as const;

/** Statuses that contribute to marketplace / portal rating aggregates. Same as VISIBLE_STATUSES. */
export const PUBLIC_RATING_STATUSES = VISIBLE_STATUSES;

function star(n: unknown): number {
  const v = Number(n);
  if (!Number.isInteger(v) || v < 1 || v > 5) {
    throw new AppError('Each category rating must be an integer from 1 to 5', 400, 'INVALID_RATING');
  }
  return v;
}

function parseCategories(input: Record<string, unknown>) {
  const categoryRatings = {
    productQuality: star(input.productQuality),
    deliveryPerformance: star(input.deliveryPerformance),
    communication: star(input.communication),
    orderFulfilment: star(input.orderFulfilment),
    overallExperience: star(input.overallExperience)
  };
  return categoryRatings;
}

export function serializeReview(
  review: InstanceType<typeof SupplierReview>,
  opts?: { includeModeration?: boolean; includeReports?: boolean }
) {
  const base = {
    id: String(review._id),
    publicId: review.publicId,
    supplierBusinessId: String(review.supplierBusiness),
    shopId: String(review.shop),
    authorId: String(review.author),
    purchaseOrderId: String(review.purchaseOrder),
    purchaseOrderPublicId: review.purchaseOrderPublicId,
    rating: review.rating,
    categoryRatings: review.categoryRatings,
    comment: review.comment || '',
    isVerified: Boolean(review.isVerified),
    verificationStatus: review.isVerified ? 'verified' : 'unverified',
    status: review.status,
    supplierResponse: review.supplierResponse
      ? {
          body: review.supplierResponse.body,
          respondedAt: review.supplierResponse.respondedAt,
          respondedBy: String(review.supplierResponse.respondedBy)
        }
      : null,
    createdAt: (review as { createdAt?: Date }).createdAt || null,
    updatedAt: (review as { updatedAt?: Date }).updatedAt || null,
    verifiedAt: review.verifiedAt || null
  };
  if (opts?.includeModeration) {
    return {
      ...base,
      editHistory: (review.editHistory || []).map((e) => ({
        editedAt: e.editedAt,
        editedBy: String(e.editedBy),
        previous: e.previous
      })),
      moderationHistory: (review.moderationHistory || []).map((m) => ({
        action: m.action,
        reason: m.reason,
        actor: String(m.actor),
        at: m.at,
        previousStatus: m.previousStatus,
        nextStatus: m.nextStatus
      })),
      ...(opts.includeReports
        ? {
            reports: (review.reports || []).map((r) => ({
              reporter: String(r.reporter),
              shop: r.shop ? String(r.shop) : null,
              reason: r.reason,
              reportedAt: r.reportedAt
            }))
          }
        : {})
    };
  }
  return base;
}

/**
 * Eligible when:
 * - PO belongs to shop and supplier
 * - status is fulfilled or closed
 * - at least one posted GRN with accepted quantity > 0
 * - not cancelled
 * - no existing review for this PO
 */
export async function assertReviewEligiblePo(input: {
  shopId: string;
  supplierBusinessId: string;
  purchaseOrderId: string;
}) {
  const po = await SupplierPurchaseOrder.findOne({
    $or: [
      { publicId: input.purchaseOrderId },
      ...(mongoose.isValidObjectId(input.purchaseOrderId)
        ? [{ _id: input.purchaseOrderId }]
        : [])
    ]
  });
  if (!po) throw new AppError('Purchase order not found', 404, 'PO_NOT_FOUND');
  if (String(po.shop) !== String(input.shopId)) {
    throw new AppError('Purchase order does not belong to this shop', 403, 'PO_SHOP_MISMATCH');
  }
  if (String(po.supplierBusiness) !== String(input.supplierBusinessId)) {
    throw new AppError('Purchase order does not belong to this supplier', 403, 'PO_SUPPLIER_MISMATCH');
  }
  if (po.status === 'cancelled') {
    throw new AppError('Cancelled purchase orders are not eligible for review', 409, 'PO_CANCELLED');
  }
  if (!['fulfilled', 'closed'].includes(po.status)) {
    throw new AppError(
      'Only fulfilled or closed purchase orders with accepted goods are eligible for review',
      409,
      'PO_NOT_ELIGIBLE'
    );
  }

  const accepted = (po.lines || []).reduce(
    (s, l) => s + Number(l.quantityReceivedAccepted || 0),
    0
  );
  if (accepted < 1) {
    throw new AppError('Purchase order has no accepted goods receipts', 409, 'PO_NO_ACCEPTED_GOODS');
  }

  const grn = await GoodsReceipt.findOne({
    purchaseOrder: po._id,
    shop: po.shop,
    status: 'posted',
    'lines.quantityAccepted': { $gt: 0 }
  }).select('_id');
  if (!grn) {
    throw new AppError('No posted goods receipt with accepted quantity found', 409, 'PO_NO_GRN');
  }

  const existing = await SupplierReview.findOne({ purchaseOrder: po._id }).select('_id');
  if (existing) {
    throw new AppError('A review already exists for this purchase order', 409, 'DUPLICATE_REVIEW');
  }

  return po;
}

export async function listReviewEligiblePurchaseOrders(input: {
  user: AuthUser;
  shopId: string;
  supplierBusinessId: string;
}) {
  if (!input.user.shopIds.includes(input.shopId)) {
    throw new AppError('Access denied for this shop', 403, 'SHOP_FORBIDDEN');
  }
  const business = await resolveSupplierBusiness(input.supplierBusinessId);
  const reviewed = await SupplierReview.find({
    shop: input.shopId,
    supplierBusiness: business._id
  }).select('purchaseOrder');
  const reviewedPoIds = reviewed.map((r) => r.purchaseOrder);

  const pos = await SupplierPurchaseOrder.find({
    shop: input.shopId,
    supplierBusiness: business._id,
    status: { $in: ['fulfilled', 'closed'] },
    _id: { $nin: reviewedPoIds }
  })
    .sort({ updatedAt: -1 })
    .limit(50);

  const eligible = [];
  for (const po of pos) {
    const accepted = (po.lines || []).reduce(
      (s, l) => s + Number(l.quantityReceivedAccepted || 0),
      0
    );
    if (accepted < 1) continue;
    const grn = await GoodsReceipt.exists({
      purchaseOrder: po._id,
      status: 'posted',
      'lines.quantityAccepted': { $gt: 0 }
    });
    if (!grn) continue;
    eligible.push({
      id: String(po._id),
      publicId: po.publicId,
      status: po.status,
      grandTotal: po.grandTotal,
      fulfilledOrClosedAt: po.closedAt || (po as { updatedAt?: Date }).updatedAt || null
    });
  }
  return { items: eligible };
}

async function resolveSupplierBusiness(publicIdOrId: string) {
  const key = String(publicIdOrId || '').trim();
  const business = await SupplierBusiness.findOne({
    $or: [{ publicId: key }, ...(mongoose.isValidObjectId(key) ? [{ _id: key }] : [])]
  });
  if (!business) throw new AppError('Supplier not found', 404, 'NOT_FOUND');
  return business;
}

export async function createVerifiedSupplierReview(input: {
  user: AuthUser;
  publicIdOrId: string;
  shopId: string;
  purchaseOrderId: string;
  categoryRatings: Record<string, unknown>;
  comment?: string;
}) {
  if (input.user.role === 'supplier') {
    throw new AppError('Suppliers cannot submit reviews', 403, 'SUPPLIER_SELF_REVIEW');
  }
  if (input.user.role !== 'shop_admin') {
    throw new AppError('Only shop admins can submit supplier reviews', 403, 'FORBIDDEN');
  }
  if (!input.user.shopIds.includes(input.shopId)) {
    throw new AppError('Access denied for this shop', 403, 'SHOP_FORBIDDEN');
  }

  const business = await resolveSupplierBusiness(input.publicIdOrId);
  if (business.status !== 'approved' || !business.isActive) {
    throw new AppError('Supplier not found', 404, 'NOT_FOUND');
  }
  if (String(business.owner) === String(input.user.id)) {
    throw new AppError('Suppliers cannot review themselves', 403, 'SUPPLIER_SELF_REVIEW');
  }

  const po = await assertReviewEligiblePo({
    shopId: input.shopId,
    supplierBusinessId: String(business._id),
    purchaseOrderId: input.purchaseOrderId
  });

  const categoryRatings = parseCategories(input.categoryRatings);
  const comment = String(input.comment || '').trim().slice(0, 1000);

  let review: InstanceType<typeof SupplierReview>;
  try {
    review = await SupplierReview.create({
      publicId: publicRef('SRV', 10),
      supplierBusiness: business._id,
      shop: input.shopId,
      author: input.user.id,
      purchaseOrder: po._id,
      purchaseOrderPublicId: po.publicId,
      rating: categoryRatings.overallExperience,
      categoryRatings,
      comment,
      isVerified: true,
      isGenuine: true,
      status: 'published',
      verifiedAt: new Date()
    });
  } catch (err: unknown) {
    if ((err as { code?: number })?.code === 11000) {
      throw new AppError('A review already exists for this purchase order', 409, 'DUPLICATE_REVIEW');
    }
    throw err;
  }

  await writeAudit({
    actor: input.user.id,
    action: 'supplier_review.create',
    entityType: 'SupplierReview',
    entityId: review._id,
    shop: input.shopId,
    details: {
      supplierBusinessId: business._id,
      purchaseOrderId: po._id,
      purchaseOrderPublicId: po.publicId,
      rating: review.rating,
      categories: categoryRatings
    }
  });

  return serializeReview(review);
}

export async function updateVerifiedSupplierReview(input: {
  user: AuthUser;
  reviewId: string;
  categoryRatings?: Record<string, unknown>;
  comment?: string;
}) {
  if (input.user.role !== 'shop_admin') {
    throw new AppError('Only shop admins can edit reviews', 403, 'FORBIDDEN');
  }
  const review = await SupplierReview.findById(input.reviewId);
  if (!review) throw new AppError('Review not found', 404, 'NOT_FOUND');
  if (!input.user.shopIds.includes(String(review.shop))) {
    throw new AppError('Access denied for this shop', 403, 'SHOP_FORBIDDEN');
  }
  if (String(review.author) !== String(input.user.id) && input.user.role === 'shop_admin') {
    // Same-shop admins may edit shop reviews within policy
    if (!input.user.shopIds.includes(String(review.shop))) {
      throw new AppError('Cannot edit another shop review', 403, 'FORBIDDEN');
    }
  }
  if (review.status === 'hidden') {
    throw new AppError('Hidden reviews cannot be edited', 409, 'REVIEW_HIDDEN');
  }

  const createdAt = (review as { createdAt?: Date }).createdAt || review.verifiedAt || new Date();
  if (Date.now() - new Date(createdAt).getTime() > SUPPLIER_REVIEW_EDIT_WINDOW_MS) {
    throw new AppError('Review edit window has expired', 409, 'EDIT_WINDOW_EXPIRED');
  }

  const previous = {
    rating: review.rating,
    categoryRatings: { ...review.categoryRatings },
    comment: review.comment || ''
  };

  if (input.categoryRatings) {
    const categoryRatings = parseCategories(input.categoryRatings);
    review.categoryRatings = categoryRatings as typeof review.categoryRatings;
    review.rating = categoryRatings.overallExperience;
  }
  if (input.comment !== undefined) {
    review.comment = String(input.comment || '').trim().slice(0, 1000);
  }

  review.editHistory.push({
    editedAt: new Date(),
    editedBy: input.user.id as unknown as mongoose.Types.ObjectId,
    previous
  } as never);
  await review.save();

  await writeAudit({
    actor: input.user.id,
    action: 'supplier_review.update',
    entityType: 'SupplierReview',
    entityId: review._id,
    shop: review.shop,
    details: { previous, next: { rating: review.rating, categoryRatings: review.categoryRatings, comment: review.comment } }
  });

  return serializeReview(review, { includeModeration: true });
}

export async function listPublishedSupplierReviews(input: {
  publicIdOrId: string;
  limit?: number;
  skip?: number;
}) {
  const business = await resolveSupplierBusiness(input.publicIdOrId);
  const limit = Math.min(Math.max(input.limit || 20, 1), 50);
  const skip = Math.max(input.skip || 0, 0);
  const filter = {
    supplierBusiness: business._id,
    isVerified: true,
    status: { $in: [...VISIBLE_STATUSES] }
  };
  const [items, total] = await Promise.all([
    SupplierReview.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    SupplierReview.countDocuments(filter)
  ]);
  return { total, items: items.map((r) => serializeReview(r)) };
}

export async function reportSupplierReview(input: {
  user: AuthUser;
  reviewId: string;
  reason: string;
  shopId?: string;
}) {
  const reason = String(input.reason || '').trim();
  if (reason.length < 5) throw new AppError('Report reason required', 400, 'REASON_REQUIRED');

  const review = await SupplierReview.findById(input.reviewId);
  if (!review) throw new AppError('Review not found', 404, 'NOT_FOUND');
  if (!VISIBLE_STATUSES.includes(review.status as (typeof VISIBLE_STATUSES)[number]) && review.status !== 'reported') {
    if (review.status === 'hidden') {
      throw new AppError('Review is already hidden', 409, 'ALREADY_HIDDEN');
    }
  }

  const already = (review.reports || []).some((r) => String(r.reporter) === String(input.user.id));
  if (already) {
    throw new AppError('You have already reported this review', 409, 'DUPLICATE_REPORT');
  }

  // Prevent rapid abuse: max 5 reports from same user across all reviews in 24h
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentReports = await SupplierReview.countDocuments({
    'reports.reporter': input.user.id,
    'reports.reportedAt': { $gte: since }
  });
  if (recentReports >= 5) {
    throw new AppError('Too many reports in 24 hours', 429, 'REPORT_RATE_LIMIT');
  }

  const shopId =
    input.shopId && input.user.shopIds.includes(input.shopId) ? input.shopId : input.user.shopIds[0];

  review.reports.push({
    reporter: input.user.id as unknown as mongoose.Types.ObjectId,
    shop: shopId as unknown as mongoose.Types.ObjectId,
    reason: reason.slice(0, 1000),
    reportedAt: new Date()
  } as never);
  const previousStatus = review.status;
  if (review.status === 'published' || review.status === 'moderated') {
    review.status = 'reported';
  }
  review.moderationHistory.push({
    action: 'report',
    reason: reason.slice(0, 2000),
    actor: input.user.id as unknown as mongoose.Types.ObjectId,
    at: new Date(),
    previousStatus,
    nextStatus: review.status
  } as never);
  await review.save();

  await writeAudit({
    actor: input.user.id,
    action: 'supplier_review.report',
    entityType: 'SupplierReview',
    entityId: review._id,
    shop: shopId,
    details: { reason }
  });

  return serializeReview(review);
}

export async function respondToSupplierReview(input: {
  user: AuthUser;
  reviewId: string;
  body: string;
}) {
  const business = await requireApprovedSupplierBusiness(input.user.id);
  const review = await SupplierReview.findById(input.reviewId);
  if (!review) throw new AppError('Review not found', 404, 'NOT_FOUND');
  if (String(review.supplierBusiness) !== String(business._id)) {
    throw new AppError('Review not found', 404, 'NOT_FOUND');
  }
  if (!VISIBLE_STATUSES.includes(review.status as (typeof VISIBLE_STATUSES)[number])) {
    throw new AppError('Cannot respond to a hidden review', 409, 'REVIEW_HIDDEN');
  }
  const body = String(input.body || '').trim();
  if (body.length < 2) throw new AppError('Response required', 400, 'RESPONSE_REQUIRED');

  // Response does not alter original review fields
  review.supplierResponse = {
    body: body.slice(0, 2000),
    respondedAt: new Date(),
    respondedBy: input.user.id as unknown as mongoose.Types.ObjectId
  };
  await review.save();

  await writeAudit({
    actor: input.user.id,
    action: 'supplier_review.respond',
    entityType: 'SupplierReview',
    entityId: review._id,
    details: { responseLength: body.length }
  });

  return serializeReview(review);
}

export async function listSupplierOwnReviews(user: AuthUser, status?: string) {
  const business = await requireApprovedSupplierBusiness(user.id);
  const filter: Record<string, unknown> = {
    supplierBusiness: business._id,
    isVerified: true
  };
  if (status) filter.status = status;
  else filter.status = { $in: [...VISIBLE_STATUSES] };
  const items = await SupplierReview.find(filter).sort({ createdAt: -1 }).limit(100);
  return { items: items.map((r) => serializeReview(r)) };
}

export async function listReportedReviewsForPlatform(input: {
  status?: string;
  limit?: number;
  skip?: number;
}) {
  const limit = Math.min(Math.max(input.limit || 50, 1), 100);
  const skip = Math.max(input.skip || 0, 0);
  const filter: Record<string, unknown> = {};
  if (input.status) filter.status = input.status;
  else filter.status = { $in: ['reported', 'hidden', 'moderated'] };

  const [items, total] = await Promise.all([
    SupplierReview.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit),
    SupplierReview.countDocuments(filter)
  ]);
  return {
    total,
    items: items.map((r) => serializeReview(r, { includeModeration: true, includeReports: true }))
  };
}

export async function moderateSupplierReview(input: {
  user: AuthUser;
  reviewId: string;
  action: 'hide' | 'restore' | 'clear_report';
  reason: string;
}) {
  if (input.user.role !== 'platform_operator') {
    throw new AppError('Only platform operators can moderate reviews', 403, 'FORBIDDEN');
  }
  const reason = String(input.reason || '').trim();
  if (reason.length < 5) throw new AppError('Moderation reason required', 400, 'REASON_REQUIRED');

  const review = await SupplierReview.findById(input.reviewId);
  if (!review) throw new AppError('Review not found', 404, 'NOT_FOUND');

  const previousStatus = review.status;
  let nextStatus = review.status;
  let auditAction = 'supplier_review.moderate';

  if (input.action === 'hide') {
    nextStatus = 'hidden';
    review.isGenuine = false; // excluded from public aggregates while preserving record
    auditAction = 'supplier_review.hide';
  } else if (input.action === 'restore') {
    // Restored reviews stay public and rating-eligible under status "moderated".
    nextStatus = 'moderated';
    review.isGenuine = Boolean(review.isVerified);
    auditAction = 'supplier_review.restore';
  } else if (input.action === 'clear_report') {
    // Cleared reports return to public rating pool as "moderated" (not silent delete).
    nextStatus = 'moderated';
    review.isGenuine = Boolean(review.isVerified);
    auditAction = 'supplier_review.clear_report';
  }

  review.status = nextStatus;
  review.moderationHistory.push({
    action: input.action,
    reason: reason.slice(0, 2000),
    actor: input.user.id as unknown as mongoose.Types.ObjectId,
    at: new Date(),
    previousStatus,
    nextStatus
  } as never);
  await review.save();

  await writeAudit({
    actor: input.user.id,
    action: auditAction,
    entityType: 'SupplierReview',
    entityId: review._id,
    details: { action: input.action, reason, previousStatus, nextStatus }
  });

  return serializeReview(review, { includeModeration: true, includeReports: true });
}

export async function aggregateVerifiedReviewStats(supplierBusinessId: mongoose.Types.ObjectId) {
  const rows = await SupplierReview.aggregate<{
    _id: null;
    count: number;
    overall: number;
    productQuality: number;
    deliveryPerformance: number;
    communication: number;
    orderFulfilment: number;
    overallExperience: number;
  }>([
    {
      $match: {
        supplierBusiness: supplierBusinessId,
        isVerified: true,
        isGenuine: true,
        status: { $in: [...VISIBLE_STATUSES] }
      }
    },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        overall: { $avg: '$rating' },
        productQuality: { $avg: '$categoryRatings.productQuality' },
        deliveryPerformance: { $avg: '$categoryRatings.deliveryPerformance' },
        communication: { $avg: '$categoryRatings.communication' },
        orderFulfilment: { $avg: '$categoryRatings.orderFulfilment' },
        overallExperience: { $avg: '$categoryRatings.overallExperience' }
      }
    }
  ]);
  const row = rows[0];
  if (!row) {
    return {
      count: 0,
      overall: null as number | null,
      categories: null as Record<SupplierReviewCategory, number> | null
    };
  }
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    count: row.count,
    overall: round(row.overall),
    categories: {
      productQuality: round(row.productQuality),
      deliveryPerformance: round(row.deliveryPerformance),
      communication: round(row.communication),
      orderFulfilment: round(row.orderFulfilment),
      overallExperience: round(row.overallExperience)
    } satisfies Record<SupplierReviewCategory, number>
  };
}

export { SUPPLIER_REVIEW_CATEGORIES, VISIBLE_STATUSES };
