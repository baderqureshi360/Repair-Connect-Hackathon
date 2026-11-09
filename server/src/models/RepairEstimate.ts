import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const estimateLineSchema = new Schema(
  {
    description: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 }
  },
  { _id: false }
);

const repairEstimateSchema = new Schema(
  {
    repairRequest: {
      type: Schema.Types.ObjectId,
      ref: 'RepairRequest',
      required: true,
      index: true
    },
    mechanic: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    laborCost: { type: Number, required: true, min: 0 },
    partsCost: { type: Number, required: true, min: 0 },
    totalCost: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'PKR' },
    lineItems: [estimateLineSchema],
    notes: { type: String, default: '' },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true
    },
    version: { type: Number, default: 1 }
  },
  { timestamps: true }
);

repairEstimateSchema.index({ repairRequest: 1, version: 1 }, { unique: true });

export type RepairEstimateDoc = InferSchemaType<typeof repairEstimateSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const RepairEstimate: Model<RepairEstimateDoc> =
  mongoose.models.RepairEstimate ||
  mongoose.model<RepairEstimateDoc>('RepairEstimate', repairEstimateSchema);
