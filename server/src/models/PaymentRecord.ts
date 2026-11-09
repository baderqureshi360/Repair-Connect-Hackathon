import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

/**
 * Immutable payment ledger entries.
 * Corrections use entryType=reversal linked to the original — never silent edits.
 */
export const PAYMENT_METHODS = [
  'cash',
  'card',
  'bank_transfer',
  'jazzcash',
  'easypaisa',
  'mobile_other',
  'other'
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const paymentRecordSchema = new Schema(
  {
    /** Public unique payment reference shown on receipts (set on all new records). */
    paymentNumber: { type: String, unique: true, sparse: true, index: true },
    shop: { type: Schema.Types.ObjectId, ref: 'RepairShop', required: true, index: true },
    repairRequest: { type: Schema.Types.ObjectId, ref: 'RepairRequest', required: true, index: true },
    customer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'PKR', maxlength: 8 },
    method: {
      type: String,
      enum: PAYMENT_METHODS,
      default: 'cash'
    },
    /** External txn id for mobile/bank payments. */
    reference: { type: String, maxlength: 120 },
    notes: { type: String, maxlength: 500 },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /** Only set when shop confirms actual receipt (API call = confirmation). */
    paidAt: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: ['confirmed', 'partially_reversed', 'reversed'],
      default: 'confirmed',
      index: true
    },
    entryType: {
      type: String,
      enum: ['payment', 'reversal'],
      default: 'payment',
      index: true
    },
    reversesPayment: { type: Schema.Types.ObjectId, ref: 'PaymentRecord' },
    /** Free-text mandatory reason stored on reversal rows. */
    reversalReason: { type: String, maxlength: 500 },
    idempotencyKey: { type: String, index: true }
  },
  { timestamps: true }
);

paymentRecordSchema.index(
  { shop: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } }
  }
);
paymentRecordSchema.index({ repairRequest: 1, paidAt: 1 });
paymentRecordSchema.index({ shop: 1, paidAt: -1 });

export type PaymentRecordDoc = InferSchemaType<typeof paymentRecordSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const PaymentRecord: Model<PaymentRecordDoc> =
  mongoose.models.PaymentRecord ||
  mongoose.model<PaymentRecordDoc>('PaymentRecord', paymentRecordSchema);
