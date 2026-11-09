import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const lineSchema = new Schema(
  {
    description: { type: String, required: true, maxlength: 200 },
    quantity: { type: Number, min: 0, default: 1 },
    unitAmount: { type: Number, min: 0, default: 0 },
    amount: { type: Number, min: 0, required: true }
  },
  { _id: false }
);

const financialDocumentSchema = new Schema(
  {
    shop: { type: Schema.Types.ObjectId, ref: 'RepairShop', required: true, index: true },
    repairRequest: { type: Schema.Types.ObjectId, ref: 'RepairRequest', required: true, index: true },
    customer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    docType: {
      type: String,
      enum: [
        'intake_receipt',
        'job_card',
        'estimate',
        'invoice',
        'payment_receipt',
        'warranty',
        'handover'
      ],
      required: true,
      index: true
    },
    documentNumber: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ['issued', 'void'],
      default: 'issued',
      index: true
    },
    issuedAt: { type: Date, default: Date.now },
    issuedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    currency: { type: String, default: 'PKR' },
    subtotal: { type: Number, min: 0, default: 0 },
    taxRatePercent: { type: Number, min: 0, max: 100, default: 0 },
    taxAmount: { type: Number, min: 0, default: 0 },
    discountAmount: { type: Number, min: 0, default: 0 },
    totalAmount: { type: Number, min: 0, default: 0 },
    amountPaid: { type: Number, min: 0, default: 0 },
    balanceDue: { type: Number, min: 0, default: 0 },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'partial', 'paid', 'not_applicable'],
      default: 'not_applicable'
    },
    lineItems: { type: [lineSchema], default: [] },
    /** Immutable snapshot of printable content at issue time. */
    snapshot: { type: Schema.Types.Mixed, required: true },
    voidReason: { type: String, maxlength: 500 },
    voidedAt: { type: Date },
    voidedBy: { type: Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

financialDocumentSchema.index({ shop: 1, documentNumber: 1 }, { unique: true });

export type FinancialDocumentDoc = InferSchemaType<typeof financialDocumentSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const FinancialDocument: Model<FinancialDocumentDoc> =
  mongoose.models.FinancialDocument ||
  mongoose.model<FinancialDocumentDoc>('FinancialDocument', financialDocumentSchema);
