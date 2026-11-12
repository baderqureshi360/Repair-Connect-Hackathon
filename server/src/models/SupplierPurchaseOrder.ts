import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

export const SUPPLIER_PO_STATUSES = [
  'draft',
  'issued',
  'acknowledged',
  'partially_fulfilled',
  'fulfilled',
  'cancelled',
  'closed'
] as const;
export type SupplierPoStatus = (typeof SUPPLIER_PO_STATUSES)[number];

const attachmentSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    dataUrl: { type: String, required: true, maxlength: 400_000 },
    contentType: { type: String, default: 'application/octet-stream', maxlength: 120 },
    size: { type: Number, min: 0, default: 0 }
  },
  { _id: false }
);

const poLineSchema = new Schema(
  {
    lineId: { type: String, required: true },
    quotationLineId: { type: String, default: '' },
    rfqLineId: { type: String, default: '' },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    sku: { type: String, trim: true, maxlength: 80, default: '' },
    manufacturerPartNumber: { type: String, trim: true, maxlength: 80, default: '' },
    quantityOrdered: { type: Number, required: true, min: 1 },
    quantityReceivedAccepted: { type: Number, min: 0, default: 0 },
    quantityRejected: { type: Number, min: 0, default: 0 },
    quantityDamaged: { type: Number, min: 0, default: 0 },
    quantityShipped: { type: Number, min: 0, default: 0 },
    unitPrice: { type: Number, required: true, min: 0 },
    discountAmount: { type: Number, min: 0, default: 0 },
    taxPercent: { type: Number, min: 0, max: 100, default: 0 },
    lineSubtotal: { type: Number, min: 0, default: 0 },
    notes: { type: String, trim: true, maxlength: 1000, default: '' },
    isAlternative: { type: Boolean, default: false },
    catalogItem: { type: Schema.Types.ObjectId, ref: 'SupplierCatalogItem' },
    shopPart: { type: Schema.Types.ObjectId, ref: 'Part' }
  },
  { _id: false }
);

const amendmentSchema = new Schema(
  {
    amendmentId: { type: String, required: true },
    reason: { type: String, required: true, maxlength: 1000 },
    changedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    changedAt: { type: Date, default: Date.now },
    before: { type: Schema.Types.Mixed },
    after: { type: Schema.Types.Mixed }
  },
  { _id: false }
);

const supplierPurchaseOrderSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true, index: true },
    shop: { type: Schema.Types.ObjectId, ref: 'RepairShop', required: true, index: true },
    supplierBusiness: {
      type: Schema.Types.ObjectId,
      ref: 'SupplierBusiness',
      required: true,
      index: true
    },
    rfq: { type: Schema.Types.ObjectId, ref: 'SupplierRfq', index: true },
    quotation: { type: Schema.Types.ObjectId, ref: 'SupplierQuotation', index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: SUPPLIER_PO_STATUSES,
      default: 'draft',
      index: true
    },
    lines: { type: [poLineSchema], default: [] },
    currency: { type: String, default: 'PKR', maxlength: 8 },
    subtotal: { type: Number, min: 0, default: 0 },
    taxAmount: { type: Number, min: 0, default: 0 },
    deliveryCharges: { type: Number, min: 0, default: 0 },
    discountAmount: { type: Number, min: 0, default: 0 },
    grandTotal: { type: Number, min: 0, default: 0 },
    deliveryAddress: { type: String, trim: true, maxlength: 500, default: '' },
    expectedDeliveryDate: { type: Date },
    terms: { type: String, trim: true, maxlength: 4000, default: '' },
    notes: { type: String, trim: true, maxlength: 4000, default: '' },
    attachments: { type: [attachmentSchema], default: [] },
    issuedAt: { type: Date },
    acknowledgedAt: { type: Date },
    acknowledgedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    rejectedAt: { type: Date },
    rejectionReason: { type: String, maxlength: 1000, default: '' },
    cancelledAt: { type: Date },
    cancelReason: { type: String, maxlength: 1000, default: '' },
    closedAt: { type: Date },
    fulfilledAt: { type: Date },
    supplierExpectedDispatchDate: { type: Date },
    supplierExpectedDeliveryDate: { type: Date },
    amendments: { type: [amendmentSchema], default: [] },
    revision: { type: Number, min: 1, default: 1 }
  },
  { timestamps: true }
);

supplierPurchaseOrderSchema.index({ shop: 1, status: 1, createdAt: -1 });
supplierPurchaseOrderSchema.index({ shop: 1, issuedAt: -1, status: 1 });
supplierPurchaseOrderSchema.index({ supplierBusiness: 1, status: 1, createdAt: -1 });
supplierPurchaseOrderSchema.index({ supplierBusiness: 1, issuedAt: -1, status: 1 });
supplierPurchaseOrderSchema.index({ shop: 1, supplierBusiness: 1, createdAt: -1 });
supplierPurchaseOrderSchema.index(
  { quotation: 1 },
  {
    unique: true,
    partialFilterExpression: { quotation: { $type: 'objectId' }, status: { $nin: ['cancelled'] } },
    name: 'one_active_po_per_quotation'
  }
);

export type SupplierPurchaseOrderDoc = InferSchemaType<typeof supplierPurchaseOrderSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
};

export const SupplierPurchaseOrder: Model<SupplierPurchaseOrderDoc> =
  mongoose.models.SupplierPurchaseOrder ||
  mongoose.model<SupplierPurchaseOrderDoc>('SupplierPurchaseOrder', supplierPurchaseOrderSchema);
