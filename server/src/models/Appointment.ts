import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const appointmentSchema = new Schema(
  {
    shop: { type: Schema.Types.ObjectId, ref: 'RepairShop', required: true, index: true },
    customer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    repairRequest: { type: Schema.Types.ObjectId, ref: 'RepairRequest', index: true },
    startsAt: { type: Date, required: true, index: true },
    endsAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ['booked', 'cancelled', 'completed', 'rescheduled'],
      default: 'booked',
      index: true
    },
    notes: { type: String, default: '' },
    cancelReason: { type: String, default: '' }
  },
  { timestamps: true }
);

appointmentSchema.index(
  { shop: 1, startsAt: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'booked' },
    name: 'unique_booked_slot'
  }
);

export type AppointmentDoc = InferSchemaType<typeof appointmentSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Appointment: Model<AppointmentDoc> =
  mongoose.models.Appointment || mongoose.model<AppointmentDoc>('Appointment', appointmentSchema);
