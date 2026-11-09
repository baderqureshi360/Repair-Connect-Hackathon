import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const estimateDecisionSchema = new Schema(
  {
    repairRequest: {
      type: Schema.Types.ObjectId,
      ref: 'RepairRequest',
      required: true,
      index: true
    },
    estimate: { type: Schema.Types.ObjectId, ref: 'RepairEstimate', required: true, unique: true },
    customer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    decision: { type: String, enum: ['approved', 'rejected'], required: true },
    reason: { type: String, default: '' },
    decidedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

export type EstimateDecisionDoc = InferSchemaType<typeof estimateDecisionSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const EstimateDecision: Model<EstimateDecisionDoc> =
  mongoose.models.EstimateDecision ||
  mongoose.model<EstimateDecisionDoc>('EstimateDecision', estimateDecisionSchema);
