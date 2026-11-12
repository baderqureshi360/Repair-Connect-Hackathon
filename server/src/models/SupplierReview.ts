import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

/** Qualifying verified rating requires at least this many published verified reviews. */
export const SUPPLIER_GENUINE_RATING_MIN_REVIEWS = 3;

/** Shop may edit a verified review within this window after creation. */
export const SUPPLIER_REVIEW_EDIT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export const SUPPLIER_REVIEW_STATUSES = [
  'published',
  'reported',
  'hidden',
  'moderated'
] as const;
export type SupplierReviewStatus = (typeof SUPPLIER_REVIEW_STATUSES)[number];

export const SUPPLIER_REVIEW_CATEGORIES = [
  'productQuality',
  'deliveryPerformance',
  'communication',
  'orderFulfilment',
  'overallExperience'
] as const;
export type SupplierReviewCategory = (typeof SUPPLIER_REVIEW_CATEGORIES)[number];

const categoryRatingsSchema = new Schema(
  {
    productQuality: { type: Number, required: true, min: 1, max: 5 },
    deliveryPerformance: { type: Number, required: true, min: 1, max: 5 },
    communication: { type: Number, required: true, min: 1, max: 5 },
    orderFulfilment: { type: Number, required: true, min: 1, max: 5 },
    overallExperience: { type: Number, required: true, min: 1, max: 5 }
  },
  { _id: false }
);

const editHistorySchema = new Schema(
  {
    editedAt: { type: Date, required: true },
    editedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    previous: { type: Schema.Types.Mixed, required: true }
  },
  { _id: false }
);

const supplierResponseSchema = new Schema(
  {
    body: { type: String, required: true, trim: true, maxlength: 2000 },
    respondedAt: { type: Date, required: true },
    respondedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { _id: false }
);

const moderationEventSchema = new Schema(
  {
    action: {
      type: String,
      enum: ['report', 'hide', 'restore', 'clear_report', 'note'],
      required: true
    },
    reason: { type: String, required: true, trim: true, maxlength: 2000 },
    actor: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    at: { type: Date, required: true, default: Date.now },
    previousStatus: { type: String, enum: SUPPLIER_REVIEW_STATUSES },
    nextStatus: { type: String, enum: SUPPLIER_REVIEW_STATUSES }
  },
  { _id: false }
);

const reportSchema = new Schema(
  {
    reporter: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    shop: { type: Schema.Types.ObjectId, ref: 'RepairShop' },
    reason: { type: String, required: true, trim: true, maxlength: 1000 },
    reportedAt: { type: Date, required: true, default: Date.now }
  },
  { _id: false }
);

const supplierReviewSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true, index: true },
    supplierBusiness: {
      type: Schema.Types.ObjectId,
      ref: 'SupplierBusiness',
      required: true,
      index: true
    },
    shop: { type: Schema.Types.ObjectId, ref: 'RepairShop', required: true, index: true },
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    purchaseOrder: {
      type: Schema.Types.ObjectId,
      ref: 'SupplierPurchaseOrder',
      required: true
      // uniqueness enforced by one_review_per_po below (avoid duplicate non-unique index)
    },
    purchaseOrderPublicId: { type: String, required: true, trim: true, maxlength: 40 },
    /** Denormalized overall rating (overallExperience) for aggregates. */
    rating: { type: Number, required: true, min: 1, max: 5 },
    categoryRatings: { type: categoryRatingsSchema, required: true },
    comment: { type: String, trim: true, maxlength: 1000, default: '' },
    /** True only when created from an eligible completed purchasing transaction. */
    isVerified: { type: Boolean, default: true, index: true },
    /** Legacy aggregation flag — mirrors published+verified visibility. */
    isGenuine: { type: Boolean, default: true, index: true },
    status: {
      type: String,
      enum: SUPPLIER_REVIEW_STATUSES,
      default: 'published',
      index: true
    },
    supplierResponse: { type: supplierResponseSchema },
    editHistory: { type: [editHistorySchema], default: [] },
    reports: { type: [reportSchema], default: [] },
    moderationHistory: { type: [moderationEventSchema], default: [] },
    verifiedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

/** One verified review per eligible purchase order. */
supplierReviewSchema.index({ purchaseOrder: 1 }, { unique: true, name: 'one_review_per_po' });
supplierReviewSchema.index({ supplierBusiness: 1, status: 1, createdAt: -1 });
supplierReviewSchema.index({ supplierBusiness: 1, shop: 1, createdAt: -1 });
supplierReviewSchema.index({ status: 1, updatedAt: -1 });

export type SupplierReviewDoc = InferSchemaType<typeof supplierReviewSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const SupplierReview: Model<SupplierReviewDoc> =
  mongoose.models.SupplierReview ||
  mongoose.model<SupplierReviewDoc>('SupplierReview', supplierReviewSchema);
