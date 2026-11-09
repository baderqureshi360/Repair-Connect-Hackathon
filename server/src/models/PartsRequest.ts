import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const partsRequestSchema = new Schema(
  {
    repairRequest: {
      type: Schema.Types.ObjectId,
      ref: 'RepairRequest',
      required: true,
      index: true
    },
    shop: { type: Schema.Types.ObjectId, ref: 'RepairShop', required: true, index: true },
    part: { type: Schema.Types.ObjectId, ref: 'Part', required: true, index: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /** Bound to the estimate version that declared this requirement. */
    estimate: { type: Schema.Types.ObjectId, ref: 'RepairEstimate', index: true },
    estimateVersion: { type: Number, index: true },
    quantityRequested: { type: Number, required: true, min: 1 },
    quantityFulfilled: { type: Number, default: 0, min: 0 },
    quantityShortage: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ['pending', 'approved', 'partially_fulfilled', 'fulfilled', 'rejected', 'superseded'],
      default: 'pending',
      index: true
    },
    notes: { type: String, default: '' },
    rejectionReason: { type: String, default: '' }
  },
  { timestamps: true }
);

export type PartsRequestDoc = InferSchemaType<typeof partsRequestSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const PartsRequest: Model<PartsRequestDoc> =
  mongoose.models.PartsRequest ||
  mongoose.model<PartsRequestDoc>('PartsRequest', partsRequestSchema);
