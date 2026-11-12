import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

export const SUPPLIER_RFQ_STATUSES = [
  'draft',
  'sent',
  'partially_responded',
  'completed',
  'cancelled',
  'expired'
] as const;
export type SupplierRfqStatus = (typeof SUPPLIER_RFQ_STATUSES)[number];

const attachmentSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    dataUrl: { type: String, required: true, maxlength: 400_000 },
    contentType: { type: String, default: 'application/octet-stream', maxlength: 120 },
    size: { type: Number, min: 0, default: 0 }
  },
  { _id: false }
);

const rfqItemSchema = new Schema(
  {
    lineId: { type: String, required: true },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    sku: { type: String, trim: true, maxlength: 80, default: '' },
    manufacturerPartNumber: { type: String, trim: true, maxlength: 80, default: '' },
    catalogItem: { type: Schema.Types.ObjectId, ref: 'SupplierCatalogItem' },
    quantity: { type: Number, required: true, min: 1 },
    specifications: { type: String, trim: true, maxlength: 2000, default: '' },
    notes: { type: String, trim: true, maxlength: 1000, default: '' }
  },
  { _id: false }
);

const supplierRfqSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true, index: true },
    shop: { type: Schema.Types.ObjectId, ref: 'RepairShop', required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    additionalRequirements: { type: String, trim: true, maxlength: 4000, default: '' },
    requiredDeliveryDate: { type: Date },
    status: {
      type: String,
      enum: SUPPLIER_RFQ_STATUSES,
      default: 'draft',
      index: true
    },
    expiresAt: { type: Date, index: true },
    items: { type: [rfqItemSchema], default: [] },
    supplierBusinesses: {
      type: [{ type: Schema.Types.ObjectId, ref: 'SupplierBusiness' }],
      default: [],
      index: true
    },
    attachments: { type: [attachmentSchema], default: [] },
    sentAt: { type: Date },
    completedAt: { type: Date },
    cancelledAt: { type: Date },
    cancelReason: { type: String, default: '', maxlength: 1000 },
    acceptedQuotation: { type: Schema.Types.ObjectId, ref: 'SupplierQuotation' },
    /** Selected quotation line IDs when partial item acceptance is used */
    acceptedLineIds: { type: [String], default: [] }
  },
  { timestamps: true }
);

supplierRfqSchema.index({ shop: 1, status: 1, createdAt: -1 });
supplierRfqSchema.index({ supplierBusinesses: 1, status: 1, createdAt: -1 });

export type SupplierRfqDoc = InferSchemaType<typeof supplierRfqSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
};

export const SupplierRfq: Model<SupplierRfqDoc> =
  mongoose.models.SupplierRfq || mongoose.model<SupplierRfqDoc>('SupplierRfq', supplierRfqSchema);
