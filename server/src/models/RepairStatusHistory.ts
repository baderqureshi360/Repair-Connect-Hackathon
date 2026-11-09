import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';
import { REPAIR_STATUSES } from '../types/roles.js';

const repairStatusHistorySchema = new Schema(
  {
    repairRequest: {
      type: Schema.Types.ObjectId,
      ref: 'RepairRequest',
      required: true,
      index: true
    },
    fromStatus: { type: String, enum: REPAIR_STATUSES, default: undefined },
    toStatus: { type: String, enum: REPAIR_STATUSES, required: true },
    changedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    note: { type: String, default: '' },
    changedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

export type RepairStatusHistoryDoc = InferSchemaType<typeof repairStatusHistorySchema> & {
  _id: mongoose.Types.ObjectId;
};

export const RepairStatusHistory: Model<RepairStatusHistoryDoc> =
  mongoose.models.RepairStatusHistory ||
  mongoose.model<RepairStatusHistoryDoc>('RepairStatusHistory', repairStatusHistorySchema);
