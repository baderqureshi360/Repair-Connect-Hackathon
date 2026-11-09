import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const partsReservationSchema = new Schema(
  {
    partsRequest: {
      type: Schema.Types.ObjectId,
      ref: 'PartsRequest',
      required: true,
      index: true
    },
    repairRequest: {
      type: Schema.Types.ObjectId,
      ref: 'RepairRequest',
      required: true,
      index: true
    },
    part: { type: Schema.Types.ObjectId, ref: 'Part', required: true, index: true },
    shop: { type: Schema.Types.ObjectId, ref: 'RepairShop', required: true },
    quantity: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: ['active', 'released', 'consumed'],
      default: 'active',
      index: true
    },
    reservedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reservedAt: { type: Date, default: Date.now },
    releasedAt: { type: Date },
    consumedAt: { type: Date }
  },
  { timestamps: true }
);

export type PartsReservationDoc = InferSchemaType<typeof partsReservationSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const PartsReservation: Model<PartsReservationDoc> =
  mongoose.models.PartsReservation ||
  mongoose.model<PartsReservationDoc>('PartsReservation', partsReservationSchema);
