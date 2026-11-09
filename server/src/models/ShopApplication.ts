import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';
import { SERVICE_CATEGORY_IDS } from '../constants/serviceCategories.js';

/**
 * Application statuses.
 * Legacy values `pending` / `contacted` / `provisioned` remain valid for historical rows.
 * New writes use pending_review | approved | rejected | cancelled.
 */
export const SHOP_APPLICATION_STATUSES = [
  'pending',
  'pending_review',
  'contacted',
  'approved',
  'rejected',
  'cancelled',
  'provisioned'
] as const;

export type ShopApplicationStatus = (typeof SHOP_APPLICATION_STATUSES)[number];

export function isPendingApplicationStatus(status: string): boolean {
  return status === 'pending' || status === 'pending_review' || status === 'contacted';
}

export function isApprovedApplicationStatus(status: string): boolean {
  return status === 'approved' || status === 'provisioned';
}

const shopApplicationSchema = new Schema(
  {
    shopName: { type: String, required: true, trim: true, maxlength: 160 },
    businessEmail: { type: String, required: true, trim: true, lowercase: true, index: true },
    businessPhone: { type: String, trim: true, maxlength: 40, default: '' },
    contactPerson: { type: String, required: true, trim: true, maxlength: 120 },
    ownerPhone: { type: String, trim: true, maxlength: 40, default: '' },
    phone: { type: String, required: true, trim: true, maxlength: 40 },
    address: { type: String, required: true, trim: true, maxlength: 300 },
    city: { type: String, required: true, trim: true, maxlength: 80 },
    region: { type: String, required: true, trim: true, maxlength: 80 },
    mechanicCount: { type: Number, min: 0, max: 500 },
    servicesDescription: { type: String, required: true, trim: true, maxlength: 2000 },
    serviceCategories: {
      type: [String],
      enum: SERVICE_CATEGORY_IDS,
      default: []
    },
    supportedDevices: { type: [String], default: [] },
    supportedBrands: { type: [String], default: [] },
    status: {
      type: String,
      enum: SHOP_APPLICATION_STATUSES,
      default: 'pending_review',
      index: true
    },
    publicId: { type: String, required: true, unique: true, index: true },
    /** Linked owner account after password-based registration (never set from client role). */
    owner: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    /** Shop created on approval — prevents duplicate shop creation. */
    provisionedShop: { type: Schema.Types.ObjectId, ref: 'RepairShop', index: true },
    reviewRemarks: { type: String, default: '', maxlength: 2000 },
    rejectionReason: { type: String, default: '', maxlength: 2000 },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    approvedAt: { type: Date },
    termsAcceptedAt: { type: Date },
    notes: { type: String, default: '', maxlength: 1000 },
    submittedIp: { type: String, default: '' }
  },
  { timestamps: true }
);

shopApplicationSchema.index(
  { businessEmail: 1, status: 1 },
  { name: 'application_email_status_idx' }
);

export type ShopApplicationDoc = InferSchemaType<typeof shopApplicationSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
};

export const ShopApplication: Model<ShopApplicationDoc> =
  mongoose.models.ShopApplication ||
  mongoose.model<ShopApplicationDoc>('ShopApplication', shopApplicationSchema);
