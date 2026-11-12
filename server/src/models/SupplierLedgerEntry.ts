import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

/**
 * Immutable supplier purchasing ledger — separate from customer PaymentRecord.
 * Corrections use entryType=reversal linked to the original.
 */
export const SUPPLIER_LEDGER_KINDS = [
  'po_obligation',
  'goods_received',
  'supplier_invoice',
  'payment',
  'credit_note',
  'adjustment',
  'reversal'
] as const;
export type SupplierLedgerKind = (typeof SUPPLIER_LEDGER_KINDS)[number];

export const SUPPLIER_PAYMENT_METHODS = [
  'cash',
  'bank_transfer',
  'cheque',
  'jazzcash',
  'easypaisa',
  'other'
] as const;

const supplierLedgerEntrySchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true, index: true },
    shop: { type: Schema.Types.ObjectId, ref: 'RepairShop', required: true, index: true },
    supplierBusiness: {
      type: Schema.Types.ObjectId,
      ref: 'SupplierBusiness',
      required: true,
      index: true
    },
    purchaseOrder: { type: Schema.Types.ObjectId, ref: 'SupplierPurchaseOrder', index: true },
    goodsReceipt: { type: Schema.Types.ObjectId, ref: 'GoodsReceipt', index: true },
    kind: {
      type: String,
      enum: SUPPLIER_LEDGER_KINDS,
      required: true,
      index: true
    },
    entryType: {
      type: String,
      enum: ['posting', 'reversal'],
      default: 'posting',
      index: true
    },
    /** Signed amount in shop currency: obligations/invoices positive payable; payments/credits negative */
    amount: { type: Number, required: true },
    currency: { type: String, default: 'PKR', maxlength: 8 },
    /** For invoices/payments */
    externalReference: { type: String, trim: true, maxlength: 120, default: '' },
    paymentMethod: {
      type: String,
      enum: [...SUPPLIER_PAYMENT_METHODS, ''],
      default: ''
    },
    paidAt: { type: Date },
    notes: { type: String, trim: true, maxlength: 1000, default: '' },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reversesEntry: { type: Schema.Types.ObjectId, ref: 'SupplierLedgerEntry' },
    reversalReason: { type: String, maxlength: 500, default: '' },
    status: {
      type: String,
      enum: ['posted', 'reversed'],
      default: 'posted',
      index: true
    },
    idempotencyKey: { type: String, index: true }
  },
  { timestamps: true }
);

supplierLedgerEntrySchema.index(
  { shop: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
    name: 'supplier_ledger_idempotency_unique'
  }
);
supplierLedgerEntrySchema.index({ shop: 1, supplierBusiness: 1, createdAt: -1 });
supplierLedgerEntrySchema.index({ purchaseOrder: 1, kind: 1, createdAt: -1 });

export type SupplierLedgerEntryDoc = InferSchemaType<typeof supplierLedgerEntrySchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
};

export const SupplierLedgerEntry: Model<SupplierLedgerEntryDoc> =
  mongoose.models.SupplierLedgerEntry ||
  mongoose.model<SupplierLedgerEntryDoc>('SupplierLedgerEntry', supplierLedgerEntrySchema);
