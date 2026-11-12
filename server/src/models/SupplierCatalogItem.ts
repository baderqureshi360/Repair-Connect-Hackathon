import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';
import { PART_CATEGORY_IDS } from '../constants/partCategories.js';

export const SUPPLIER_PRODUCT_CONDITIONS = ['new', 'refurbished', 'used', 'oem', 'aftermarket'] as const;
export type SupplierProductCondition = (typeof SUPPLIER_PRODUCT_CONDITIONS)[number];

export const SUPPLIER_STOCK_STATUSES = [
  'in_stock',
  'low_stock',
  'out_of_stock',
  'discontinued'
] as const;
export type SupplierStockStatus = (typeof SUPPLIER_STOCK_STATUSES)[number];

export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

export function deriveStockStatus(
  quantity: number,
  opts?: { discontinued?: boolean; lowStockThreshold?: number }
): SupplierStockStatus {
  if (opts?.discontinued) return 'discontinued';
  const threshold = opts?.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
  if (quantity <= 0) return 'out_of_stock';
  if (quantity <= threshold) return 'low_stock';
  return 'in_stock';
}

const imageSchema = new Schema(
  {
    name: { type: String, trim: true, maxlength: 160, default: '' },
    dataUrl: { type: String, required: true, maxlength: 400_000 }
  },
  { _id: false }
);

const supplierCatalogItemSchema = new Schema(
  {
    supplierBusiness: {
      type: Schema.Types.ObjectId,
      ref: 'SupplierBusiness',
      required: true,
      index: true
    },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    sku: { type: String, trim: true, maxlength: 80, default: '' },
    manufacturerPartNumber: { type: String, trim: true, maxlength: 80, default: '' },
    category: {
      type: String,
      enum: PART_CATEGORY_IDS,
      required: true,
      index: true
    },
    brand: { type: String, trim: true, maxlength: 80, default: '', index: true },
    compatibleModels: { type: [String], default: [] },
    description: { type: String, trim: true, maxlength: 4000, default: '' },
    condition: {
      type: String,
      enum: SUPPLIER_PRODUCT_CONDITIONS,
      default: 'new'
    },
    warranty: { type: String, trim: true, maxlength: 200, default: '' },
    images: { type: [imageSchema], default: [] },
    unitPrice: { type: Number, min: 0, default: 0, index: true },
    currency: { type: String, default: 'PKR', maxlength: 8 },
    quantityAvailable: { type: Number, min: 0, default: 0 },
    minOrderQuantity: { type: Number, min: 1, default: 1 },
    leadTimeDays: { type: Number, min: 0, max: 365, default: 0 },
    lowStockThreshold: { type: Number, min: 0, default: DEFAULT_LOW_STOCK_THRESHOLD },
    stockStatus: {
      type: String,
      enum: SUPPLIER_STOCK_STATUSES,
      default: 'out_of_stock',
      index: true
    },
    /** Legacy flag kept in sync with stockStatus for Phase 1 clients. */
    inStock: { type: Boolean, default: false, index: true },
    isActive: { type: Boolean, default: true, index: true },
    isArchived: { type: Boolean, default: false, index: true },
    archivedAt: { type: Date },
    stockVersion: { type: Number, default: 0, min: 0 }
  },
  { timestamps: true }
);

supplierCatalogItemSchema.index(
  { supplierBusiness: 1, sku: 1 },
  {
    unique: true,
    partialFilterExpression: { sku: { $type: 'string', $gt: '' } },
    name: 'supplier_catalog_sku_unique'
  }
);
supplierCatalogItemSchema.index({ supplierBusiness: 1, name: 1 });
supplierCatalogItemSchema.index({
  name: 'text',
  sku: 'text',
  manufacturerPartNumber: 'text',
  description: 'text'
});
supplierCatalogItemSchema.index({
  isActive: 1,
  isArchived: 1,
  stockStatus: 1,
  unitPrice: 1
});

export type SupplierCatalogItemDoc = InferSchemaType<typeof supplierCatalogItemSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
};

export const SupplierCatalogItem: Model<SupplierCatalogItemDoc> =
  mongoose.models.SupplierCatalogItem ||
  mongoose.model<SupplierCatalogItemDoc>('SupplierCatalogItem', supplierCatalogItemSchema);
