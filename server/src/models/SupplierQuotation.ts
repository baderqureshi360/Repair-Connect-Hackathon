import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

export const SUPPLIER_QUOTATION_STATUSES = [
  'draft',
  'submitted',
  'revised',
  'withdrawn',
  'accepted',
  'rejected',
  'expired'
] as const;
export type SupplierQuotationStatus = (typeof SUPPLIER_QUOTATION_STATUSES)[number];

const quotationLineSchema = new Schema(
  {
    lineId: { type: String, required: true },
    rfqLineId: { type: String, required: true },
    unitPrice: { type: Number, required: true, min: 0 },
    availableQuantity: { type: Number, required: true, min: 0 },
    quotedQuantity: { type: Number, required: true, min: 0 },
    moq: { type: Number, min: 1, default: 1 },
    unavailable: { type: Boolean, default: false },
    isAlternative: { type: Boolean, default: false },
    alternativeName: { type: String, trim: true, maxlength: 160, default: '' },
    alternativeSku: { type: String, trim: true, maxlength: 80, default: '' },
    warranty: { type: String, trim: true, maxlength: 200, default: '' },
    notes: { type: String, trim: true, maxlength: 1000, default: '' }
  },
  { _id: false }
);

const supplierQuotationSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true, index: true },
    rfq: { type: Schema.Types.ObjectId, ref: 'SupplierRfq', required: true, index: true },
    supplierBusiness: {
      type: Schema.Types.ObjectId,
      ref: 'SupplierBusiness',
      required: true,
      index: true
    },
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: SUPPLIER_QUOTATION_STATUSES,
      default: 'draft',
      index: true
    },
    revision: { type: Number, min: 1, default: 1 },
    lines: { type: [quotationLineSchema], default: [] },
    deliveryCharges: { type: Number, min: 0, default: 0 },
    taxAmount: { type: Number, min: 0, default: 0 },
    taxPercent: { type: Number, min: 0, max: 100, default: 0 },
    estimatedDeliveryDate: { type: Date },
    warranty: { type: String, trim: true, maxlength: 200, default: '' },
    validityUntil: { type: Date, index: true },
    notes: { type: String, trim: true, maxlength: 2000, default: '' },
    currency: { type: String, default: 'PKR', maxlength: 8 },
    subtotal: { type: Number, min: 0, default: 0 },
    totalAmount: { type: Number, min: 0, default: 0 },
    withdrawnReason: { type: String, default: '', maxlength: 1000 },
    withdrawnAt: { type: Date },
    /**
     * First successful non-draft submission time.
     * Never cleared on withdraw/revise — used for quotation response-time metrics.
     */
    firstSubmittedAt: { type: Date },
    /** Latest (or first) submission timestamp; also preserved on withdraw. */
    submittedAt: { type: Date },
    acceptedAt: { type: Date }
  },
  { timestamps: true }
);

supplierQuotationSchema.index(
  { rfq: 1, supplierBusiness: 1 },
  { unique: true, name: 'rfq_supplier_quotation_unique' }
);
supplierQuotationSchema.index({ supplierBusiness: 1, status: 1, updatedAt: -1 });

export type SupplierQuotationDoc = InferSchemaType<typeof supplierQuotationSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
};

export const SupplierQuotation: Model<SupplierQuotationDoc> =
  mongoose.models.SupplierQuotation ||
  mongoose.model<SupplierQuotationDoc>('SupplierQuotation', supplierQuotationSchema);
