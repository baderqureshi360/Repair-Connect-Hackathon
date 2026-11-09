import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const attachmentSchema = new Schema(
  {
    url: { type: String, required: true, maxlength: 400_000 },
    caption: { type: String, default: '', maxlength: 200 },
    contentType: { type: String, default: 'image/jpeg', maxlength: 80 }
  },
  { _id: true }
);

const repairMessageSchema = new Schema(
  {
    repairRequest: {
      type: Schema.Types.ObjectId,
      ref: 'RepairRequest',
      required: true,
      index: true
    },
    shop: { type: Schema.Types.ObjectId, ref: 'RepairShop', required: true, index: true },
    sender: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    senderRole: {
      type: String,
      enum: ['customer', 'mechanic', 'parts_coordinator', 'shop_admin', 'system'],
      required: true
    },
    senderName: { type: String, required: true, trim: true },
    body: { type: String, required: true, trim: true, maxlength: 4000 },
    messageType: {
      type: String,
      enum: ['general', 'status_update', 'estimate', 'payment', 'system'],
      default: 'general',
      index: true
    },
    visibility: {
      type: String,
      enum: ['customer_visible', 'internal'],
      default: 'customer_visible',
      index: true
    },
    attachments: { type: [attachmentSchema], default: [] },
    readBy: [{ type: Schema.Types.ObjectId, ref: 'User' }]
  },
  { timestamps: true }
);

repairMessageSchema.index({ repairRequest: 1, createdAt: 1 });
repairMessageSchema.index({ repairRequest: 1, visibility: 1, createdAt: 1 });
repairMessageSchema.index({ shop: 1, createdAt: -1 });

export type RepairMessageDoc = InferSchemaType<typeof repairMessageSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const RepairMessage: Model<RepairMessageDoc> =
  mongoose.models.RepairMessage ||
  mongoose.model<RepairMessageDoc>('RepairMessage', repairMessageSchema);
