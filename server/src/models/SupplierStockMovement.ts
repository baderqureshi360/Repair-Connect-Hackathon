import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

export const SUPPLIER_STOCK_ACTIONS = [
  'set',
  'receive',
  'adjust',
  'reserve',
  'release',
  'write_off'
] as const;
export type SupplierStockAction = (typeof SUPPLIER_STOCK_ACTIONS)[number];

const supplierStockMovementSchema = new Schema(
  {
    catalogItem: {
      type: Schema.Types.ObjectId,
      ref: 'SupplierCatalogItem',
      required: true,
      index: true
    },
    supplierBusiness: {
      type: Schema.Types.ObjectId,
      ref: 'SupplierBusiness',
      required: true,
      index: true
    },
    action: {
      type: String,
      enum: SUPPLIER_STOCK_ACTIONS,
      required: true,
      index: true
    },
    quantityDelta: { type: Number, required: true },
    quantityBefore: { type: Number, required: true, min: 0 },
    quantityAfter: { type: Number, required: true, min: 0 },
    performedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    notes: { type: String, trim: true, maxlength: 500, default: '' }
  },
  { timestamps: true }
);

supplierStockMovementSchema.index({ catalogItem: 1, createdAt: -1 });
supplierStockMovementSchema.index({ supplierBusiness: 1, createdAt: -1 });

export type SupplierStockMovementDoc = InferSchemaType<typeof supplierStockMovementSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt?: Date;
};

export const SupplierStockMovement: Model<SupplierStockMovementDoc> =
  mongoose.models.SupplierStockMovement ||
  mongoose.model<SupplierStockMovementDoc>('SupplierStockMovement', supplierStockMovementSchema);
