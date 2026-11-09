import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const documentSequenceSchema = new Schema(
  {
    shop: { type: Schema.Types.ObjectId, ref: 'RepairShop', required: true, index: true },
    docType: {
      type: String,
      enum: [
        'intake_receipt',
        'job_card',
        'estimate',
        'invoice',
        'payment_receipt',
        'warranty',
        'handover'
      ],
      required: true
    },
    /** Monotonic counter; issued number is the value after each $inc. */
    nextNumber: { type: Number, required: true, min: 0, default: 0 }
  },
  { timestamps: true }
);

documentSequenceSchema.index({ shop: 1, docType: 1 }, { unique: true });

export type DocumentSequenceDoc = InferSchemaType<typeof documentSequenceSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const DocumentSequence: Model<DocumentSequenceDoc> =
  mongoose.models.DocumentSequence ||
  mongoose.model<DocumentSequenceDoc>('DocumentSequence', documentSequenceSchema);
