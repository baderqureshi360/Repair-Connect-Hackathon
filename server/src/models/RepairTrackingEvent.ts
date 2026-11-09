import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const repairTrackingEventSchema = new Schema(
  {
    repairRequest: {
      type: Schema.Types.ObjectId,
      ref: 'RepairRequest',
      required: true,
      index: true
    },
    eventKey: { type: String, required: true, index: true },
    visibility: {
      type: String,
      enum: ['customer_visible', 'internal'],
      default: 'customer_visible',
      index: true
    },
    occurredAt: { type: Date, required: true, default: Date.now },
    dedupeKey: { type: String, required: true },
    title: { type: String, required: true },
    message: { type: String, default: '' },
    source: { type: String, default: 'system' },
    meta: { type: Schema.Types.Mixed }
  },
  { timestamps: true }
);

repairTrackingEventSchema.index(
  { repairRequest: 1, eventKey: 1, dedupeKey: 1 },
  { unique: true }
);
repairTrackingEventSchema.index({ repairRequest: 1, occurredAt: 1 });

export type RepairTrackingEventDoc = InferSchemaType<typeof repairTrackingEventSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const RepairTrackingEvent: Model<RepairTrackingEventDoc> =
  mongoose.models.RepairTrackingEvent ||
  mongoose.model<RepairTrackingEventDoc>('RepairTrackingEvent', repairTrackingEventSchema);
