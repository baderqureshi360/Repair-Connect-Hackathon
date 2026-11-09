import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const repairAssignmentSchema = new Schema(
  {
    repairRequest: {
      type: Schema.Types.ObjectId,
      ref: 'RepairRequest',
      required: true,
      unique: true,
      index: true
    },
    mechanic: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    shop: { type: Schema.Types.ObjectId, ref: 'RepairShop', required: true, index: true },
    notes: { type: String, default: '' },
    assignedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

export type RepairAssignmentDoc = InferSchemaType<typeof repairAssignmentSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const RepairAssignment: Model<RepairAssignmentDoc> =
  mongoose.models.RepairAssignment ||
  mongoose.model<RepairAssignmentDoc>('RepairAssignment', repairAssignmentSchema);
