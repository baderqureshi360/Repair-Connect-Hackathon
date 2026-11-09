import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const inventoryMovementSchema = new Schema(
  {
    part: { type: Schema.Types.ObjectId, ref: 'Part', required: true, index: true },
    shop: { type: Schema.Types.ObjectId, ref: 'RepairShop', required: true, index: true },
    type: {
      type: String,
      enum: ['stock_in', 'stock_out', 'reserve', 'release', 'adjust', 'transfer_out', 'transfer_in'],
      required: true,
      index: true
    },
    quantity: { type: Number, required: true },
    balanceAfterAvailable: { type: Number, required: true, min: 0 },
    balanceAfterReserved: { type: Number, required: true, min: 0 },
    performedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    referenceType: { type: String },
    referenceId: { type: Schema.Types.ObjectId },
    notes: { type: String, default: '' }
  },
  { timestamps: true }
);

export type InventoryMovementDoc = InferSchemaType<typeof inventoryMovementSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const InventoryMovement: Model<InventoryMovementDoc> =
  mongoose.models.InventoryMovement ||
  mongoose.model<InventoryMovementDoc>('InventoryMovement', inventoryMovementSchema);
