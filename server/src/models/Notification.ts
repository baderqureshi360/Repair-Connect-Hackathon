import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const notificationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    repairRequest: { type: Schema.Types.ObjectId, ref: 'RepairRequest' },
    isRead: { type: Boolean, default: false, index: true },
    meta: { type: Schema.Types.Mixed }
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });

export type NotificationDoc = InferSchemaType<typeof notificationSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Notification: Model<NotificationDoc> =
  mongoose.models.Notification ||
  mongoose.model<NotificationDoc>('Notification', notificationSchema);
