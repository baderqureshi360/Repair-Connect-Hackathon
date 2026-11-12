import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';
import { PART_CATEGORY_IDS } from '../constants/partCategories.js';

/**
 * Approved independent supplier business for the city-based marketplace.
 * Distinct from shop-scoped inventory `Supplier` contacts.
 */
export const SUPPLIER_BUSINESS_STATUSES = ['approved', 'suspended'] as const;
export type SupplierBusinessStatus = (typeof SUPPLIER_BUSINESS_STATUSES)[number];

const supplierBusinessSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true, index: true },
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    application: { type: Schema.Types.ObjectId, ref: 'SupplierApplication', index: true },
    businessName: { type: String, required: true, trim: true, maxlength: 160, index: true },
    businessEmail: { type: String, required: true, trim: true, lowercase: true, index: true },
    businessPhone: { type: String, required: true, trim: true, maxlength: 40 },
    contactPerson: { type: String, required: true, trim: true, maxlength: 120 },
    address: { type: String, required: true, trim: true, maxlength: 300 },
    city: { type: String, required: true, trim: true, maxlength: 80, index: true },
    region: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, default: '', maxlength: 2000 },
    partCategories: {
      type: [String],
      enum: PART_CATEGORY_IDS,
      default: [],
      index: true
    },
    supportedBrands: { type: [String], default: [] },
    deliveryCities: { type: [String], default: [], index: true },
    logoUrl: { type: String, default: '', maxlength: 400_000 },
    verificationDocuments: {
      type: [
        {
          name: { type: String, trim: true, maxlength: 160 },
          dataUrl: { type: String, maxlength: 400_000 }
        }
      ],
      default: []
    },
    status: {
      type: String,
      enum: SUPPLIER_BUSINESS_STATUSES,
      default: 'approved',
      index: true
    },
    isActive: { type: Boolean, default: true, index: true },
    verified: { type: Boolean, default: true },
    availability: {
      type: String,
      enum: ['available', 'limited', 'unavailable'],
      default: 'available',
      index: true
    },
    suspendedAt: { type: Date },
    suspendReason: { type: String, default: '', maxlength: 2000 }
  },
  { timestamps: true }
);

supplierBusinessSchema.index({ businessName: 'text', description: 'text' });
supplierBusinessSchema.index({ deliveryCities: 1, isActive: 1, status: 1 });

export type SupplierBusinessDoc = InferSchemaType<typeof supplierBusinessSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
};

export const SupplierBusiness: Model<SupplierBusinessDoc> =
  mongoose.models.SupplierBusiness ||
  mongoose.model<SupplierBusinessDoc>('SupplierBusiness', supplierBusinessSchema);
