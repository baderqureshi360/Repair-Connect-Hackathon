import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';
import { PART_CATEGORY_IDS } from '../constants/partCategories.js';

/**
 * Supplier network application statuses.
 * New writes use pending_review | approved | rejected | cancelled | suspended.
 */
export const SUPPLIER_APPLICATION_STATUSES = [
  'pending_review',
  'approved',
  'rejected',
  'cancelled',
  'suspended'
] as const;

export type SupplierApplicationStatus = (typeof SUPPLIER_APPLICATION_STATUSES)[number];

export function isPendingSupplierApplicationStatus(status: string): boolean {
  return status === 'pending_review';
}

export function isApprovedSupplierApplicationStatus(status: string): boolean {
  return status === 'approved';
}

const verificationDocSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    dataUrl: { type: String, required: true, maxlength: 400_000 }
  },
  { _id: false }
);

const supplierApplicationSchema = new Schema(
  {
    businessName: { type: String, required: true, trim: true, maxlength: 160 },
    businessEmail: { type: String, required: true, trim: true, lowercase: true, index: true },
    businessPhone: { type: String, required: true, trim: true, maxlength: 40 },
    contactPerson: { type: String, required: true, trim: true, maxlength: 120 },
    ownerPhone: { type: String, trim: true, maxlength: 40, default: '' },
    address: { type: String, required: true, trim: true, maxlength: 300 },
    city: { type: String, required: true, trim: true, maxlength: 80, index: true },
    region: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    partCategories: {
      type: [String],
      enum: PART_CATEGORY_IDS,
      default: []
    },
    supportedBrands: { type: [String], default: [] },
    deliveryCities: { type: [String], default: [] },
    logoUrl: { type: String, default: '', maxlength: 400_000 },
    verificationDocuments: { type: [verificationDocSchema], default: [] },
    status: {
      type: String,
      enum: SUPPLIER_APPLICATION_STATUSES,
      default: 'pending_review',
      index: true
    },
    publicId: { type: String, required: true, unique: true, index: true },
    owner: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    provisionedBusiness: { type: Schema.Types.ObjectId, ref: 'SupplierBusiness', index: true },
    reviewRemarks: { type: String, default: '', maxlength: 2000 },
    rejectionReason: { type: String, default: '', maxlength: 2000 },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    approvedAt: { type: Date },
    suspendedAt: { type: Date },
    termsAcceptedAt: { type: Date },
    submittedIp: { type: String, default: '' }
  },
  { timestamps: true }
);

supplierApplicationSchema.index(
  { businessEmail: 1, status: 1 },
  { name: 'supplier_application_email_status_idx' }
);
supplierApplicationSchema.index(
  { businessName: 1, city: 1, status: 1 },
  { name: 'supplier_application_name_city_status_idx' }
);

export type SupplierApplicationDoc = InferSchemaType<typeof supplierApplicationSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
};

export const SupplierApplication: Model<SupplierApplicationDoc> =
  mongoose.models.SupplierApplication ||
  mongoose.model<SupplierApplicationDoc>('SupplierApplication', supplierApplicationSchema);
