import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const diagnosisSchema = new Schema(
  {
    repairRequest: {
      type: Schema.Types.ObjectId,
      ref: 'RepairRequest',
      required: true,
      index: true
    },
    mechanic: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    findings: { type: String, required: true },
    recommendedActions: { type: String, required: true },
    notes: { type: String, default: '' }
  },
  { timestamps: true }
);

export type DiagnosisDoc = InferSchemaType<typeof diagnosisSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Diagnosis: Model<DiagnosisDoc> =
  mongoose.models.Diagnosis || mongoose.model<DiagnosisDoc>('Diagnosis', diagnosisSchema);
