import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';
import { REPAIR_SOURCES, REPAIR_STATUSES } from '../types/roles.js';

const photoSchema = new Schema(
  {
    url: { type: String, required: true },
    caption: { type: String, default: '' },
    kind: { type: String, enum: ['device', 'before', 'after', 'other'], default: 'device' },
    visibility: { type: String, enum: ['customer', 'internal'], default: 'customer' },
    uploadedAt: { type: Date, default: Date.now }
  },
  { _id: true }
);

const checklistItemSchema = new Schema(
  {
    label: { type: String, required: true },
    done: { type: Boolean, default: false },
    visibility: { type: String, enum: ['customer', 'internal'], default: 'internal' }
  },
  { _id: true }
);

/** Snapshot for walk-in customers who are not linked to an online account. */
const walkInContactSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, required: true, trim: true, maxlength: 40 },
    email: { type: String, trim: true, lowercase: true, maxlength: 160, default: '' },
    consentToContact: { type: Boolean, default: false },
    notes: { type: String, trim: true, maxlength: 500, default: '' }
  },
  { _id: false }
);

const repairRequestSchema = new Schema(
  {
    referenceNumber: { type: String, required: true, unique: true, index: true },
    /** Optional for walk-in intakes that only store a contact snapshot. */
    customer: { type: Schema.Types.ObjectId, ref: 'User', required: false, index: true },
    walkInContact: { type: walkInContactSchema, required: false },
    /**
     * Intake channel. No schema default — historical records stay unset.
     * New online creates set `online`; walk-in creates set `walk_in`.
     */
    source: { type: String, enum: REPAIR_SOURCES, required: false, index: true },
    shop: { type: Schema.Types.ObjectId, ref: 'RepairShop', required: true, index: true },
    deviceType: { type: String, required: true, trim: true },
    brand: { type: String, required: true, trim: true },
    model: { type: String, required: true, trim: true },
    serialNumber: { type: String, default: '', trim: true },
    accessories: { type: String, default: '', trim: true },
    problemDescription: { type: String, required: true, trim: true },
    photos: { type: [photoSchema], default: [] },
    status: { type: String, enum: REPAIR_STATUSES, default: 'submitted', index: true },
    priority: {
      type: String,
      enum: ['low', 'normal', 'high', 'urgent'],
      default: 'normal',
      index: true
    },
    deadline: { type: Date },
    finalCost: { type: Number, min: 0 },
    /**
     * Optimistic concurrency token for atomic payment/reversal commits.
     * Bumped inside MongoDB transactions so concurrent balance checks cannot both succeed.
     */
    financialRevision: { type: Number, default: 0, min: 0 },
    workPerformed: { type: String },
    laborMinutes: { type: Number, min: 0, default: 0 },
    customerNotes: { type: String, default: '' },
    internalNotes: { type: String, default: '' },
    diagnosisChecklist: { type: [checklistItemSchema], default: [] },
    completionChecklist: { type: [checklistItemSchema], default: [] },
    idempotencyKey: { type: String, index: true },
    assignedMechanic: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    /**
     * Explicit parts requirement — empty parts lists must never imply "not required".
     * undetermined → cannot start; not_required → start after approval; required → all reserved.
     */
    partsRequirement: {
      status: {
        type: String,
        enum: ['undetermined', 'not_required', 'required'],
        default: 'undetermined'
      },
      confirmedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      confirmedAt: { type: Date },
      estimate: { type: Schema.Types.ObjectId, ref: 'RepairEstimate' },
      estimateVersion: { type: Number },
      notes: { type: String, default: '' }
    },
    /** Work finished by mechanic — distinct from customer collection / job closure. */
    workCompletedAt: { type: Date },
    workCompletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    /** Device handed to customer (collection confirmed — may precede case closure). */
    collectedAt: { type: Date },
    collectedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    collectionNotes: { type: String, default: '' },
    /** Case closed timestamp (status=completed). Distinct from workCompletedAt / collectedAt. */
    completedAt: { type: Date },
    closedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    closureNotes: { type: String, default: '', maxlength: 2000 },
    caseSummary: { type: String, default: '', maxlength: 4000 },
    completionSummary: { type: String, default: '', maxlength: 2000 },
    /** Authorized reopen after closure. */
    reopenedAt: { type: Date },
    reopenedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reopenReason: { type: String, default: '', maxlength: 2000 },
    trackingToken: { type: String, unique: true, sparse: true, index: true },
    /** SHA-256 hex of normalized access code + HMAC secret; never returned by APIs. */
    trackingAccessCodeHash: { type: String, index: true, select: false },
    trackingCodeUpdatedAt: { type: Date },
    trackingExpiresAt: { type: Date, index: true },
    trackingRevokedAt: { type: Date },
    warrantyExpiresAt: { type: Date },
    warrantyMonths: { type: Number, min: 0, default: 0 },
    feedbackRating: { type: Number, min: 1, max: 5 },
    feedbackComment: { type: String, default: '' },
    feedbackAt: { type: Date },
    appointmentAt: { type: Date }
  },
  { timestamps: true }
);

repairRequestSchema.index(
  { customer: 1, shop: 1, deviceType: 1, brand: 1, model: 1, problemDescription: 1, createdAt: 1 },
  { name: 'duplicate_guard_idx' }
);
repairRequestSchema.index({ shop: 1, status: 1 });
repairRequestSchema.index(
  { idempotencyKey: 1, customer: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);

export type RepairRequestDoc = InferSchemaType<typeof repairRequestSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const RepairRequest: Model<RepairRequestDoc> =
  mongoose.models.RepairRequest ||
  mongoose.model<RepairRequestDoc>('RepairRequest', repairRequestSchema);
