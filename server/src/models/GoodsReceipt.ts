import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

export const GOODS_RECEIPT_STATUSES = ['draft', 'posted', 'cancelled'] as const;
export type GoodsReceiptStatus = (typeof GOODS_RECEIPT_STATUSES)[number];

const receiptLineSchema = new Schema(
  {
    poLineId: { type: String, required: true },
    quantityReceived: { type: Number, required: true, min: 0 },
    quantityAccepted: { type: Number, required: true, min: 0 },
    quantityRejected: { type: Number, min: 0, default: 0 },
    quantityDamaged: { type: Number, min: 0, default: 0 },
    quantityShort: { type: Number, min: 0, default: 0 },
    rejectReason: { type: String, trim: true, maxlength: 500, default: '' },
    damageReason: { type: String, trim: true, maxlength: 500, default: '' },
    shopPart: { type: Schema.Types.ObjectId, ref: 'Part' },
    unitCost: { type: Number, min: 0, default: 0 },
    lineValueAccepted: { type: Number, min: 0, default: 0 }
  },
  { _id: false }
);

const goodsReceiptSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true, index: true },
    purchaseOrder: {
      type: Schema.Types.ObjectId,
      ref: 'SupplierPurchaseOrder',
      required: true,
      index: true
    },
    shipment: { type: Schema.Types.ObjectId, ref: 'SupplierShipment', index: true },
    shop: { type: Schema.Types.ObjectId, ref: 'RepairShop', required: true, index: true },
    supplierBusiness: {
      type: Schema.Types.ObjectId,
      ref: 'SupplierBusiness',
      required: true,
      index: true
    },
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: GOODS_RECEIPT_STATUSES,
      default: 'posted',
      index: true
    },
    receivedAt: { type: Date, default: Date.now },
    notes: { type: String, trim: true, maxlength: 2000, default: '' },
    lines: { type: [receiptLineSchema], default: [] },
    totalAcceptedValue: { type: Number, min: 0, default: 0 },
    /** Client-supplied or server-generated key; unique per shop to enforce idempotent posting */
    idempotencyKey: { type: String, index: true }
  },
  { timestamps: true }
);

goodsReceiptSchema.index(
  { shop: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
    name: 'grn_idempotency_unique'
  }
);
goodsReceiptSchema.index({ purchaseOrder: 1, receivedAt: -1 });
goodsReceiptSchema.index({ shop: 1, receivedAt: -1 });

export type GoodsReceiptDoc = InferSchemaType<typeof goodsReceiptSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
};

export const GoodsReceipt: Model<GoodsReceiptDoc> =
  mongoose.models.GoodsReceipt || mongoose.model<GoodsReceiptDoc>('GoodsReceipt', goodsReceiptSchema);
