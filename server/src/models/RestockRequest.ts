import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const restockRequestSchema = new Schema(
  {
    shop: { type: Schema.Types.ObjectId, ref: 'RepairShop', required: true, index: true },
    part: { type: Schema.Types.ObjectId, ref: 'Part', required: true, index: true },
    supplier: { type: Schema.Types.ObjectId, ref: 'Supplier' },
    quantity: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: ['requested', 'ordered', 'received', 'cancelled'],
      default: 'requested',
      index: true
    },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    notes: { type: String, default: '' },
    receivedQuantity: { type: Number, min: 0 }
  },
  { timestamps: true }
);

export type RestockRequestDoc = InferSchemaType<typeof restockRequestSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const RestockRequest: Model<RestockRequestDoc> =
  mongoose.models.RestockRequest ||
  mongoose.model<RestockRequestDoc>('RestockRequest', restockRequestSchema);
