import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const passwordResetSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true, index: true },
    consumedAt: { type: Date },
    requestedIp: { type: String }
  },
  { timestamps: true }
);

export type PasswordResetDoc = InferSchemaType<typeof passwordResetSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const PasswordReset: Model<PasswordResetDoc> =
  mongoose.models.PasswordReset ||
  mongoose.model<PasswordResetDoc>('PasswordReset', passwordResetSchema);
