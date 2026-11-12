import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const attachmentSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    dataUrl: { type: String, required: true, maxlength: 400_000 },
    contentType: { type: String, default: 'application/octet-stream', maxlength: 120 },
    size: { type: Number, min: 0, default: 0 }
  },
  { _id: false }
);

const supplierConversationSchema = new Schema(
  {
    shop: { type: Schema.Types.ObjectId, ref: 'RepairShop', required: true, index: true },
    supplierBusiness: {
      type: Schema.Types.ObjectId,
      ref: 'SupplierBusiness',
      required: true,
      index: true
    },
    subject: { type: String, trim: true, maxlength: 200, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    shopUnreadCount: { type: Number, min: 0, default: 0 },
    supplierUnreadCount: { type: Number, min: 0, default: 0 },
    isClosed: { type: Boolean, default: false }
  },
  { timestamps: true }
);

supplierConversationSchema.index(
  { shop: 1, supplierBusiness: 1 },
  { unique: true, name: 'shop_supplier_conversation_unique' }
);
supplierConversationSchema.index({ supplierBusiness: 1, lastMessageAt: -1 });
supplierConversationSchema.index({ shop: 1, lastMessageAt: -1 });

const supplierConversationMessageSchema = new Schema(
  {
    conversation: {
      type: Schema.Types.ObjectId,
      ref: 'SupplierConversation',
      required: true,
      index: true
    },
    shop: { type: Schema.Types.ObjectId, ref: 'RepairShop', required: true, index: true },
    supplierBusiness: {
      type: Schema.Types.ObjectId,
      ref: 'SupplierBusiness',
      required: true,
      index: true
    },
    sender: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    senderRole: { type: String, enum: ['shop_admin', 'supplier'], required: true },
    senderName: { type: String, required: true, trim: true, maxlength: 120 },
    body: { type: String, required: true, trim: true, maxlength: 4000 },
    /** shop_internal is never returned to suppliers */
    visibility: {
      type: String,
      enum: ['participant_visible', 'shop_internal'],
      default: 'participant_visible',
      index: true
    },
    attachments: { type: [attachmentSchema], default: [] },
    readBy: [{ type: Schema.Types.ObjectId, ref: 'User' }]
  },
  { timestamps: true }
);

supplierConversationMessageSchema.index({ conversation: 1, createdAt: 1 });
supplierConversationMessageSchema.index({ conversation: 1, visibility: 1, createdAt: 1 });

export type SupplierConversationDoc = InferSchemaType<typeof supplierConversationSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
};

export type SupplierConversationMessageDoc = InferSchemaType<
  typeof supplierConversationMessageSchema
> & {
  _id: mongoose.Types.ObjectId;
  createdAt?: Date;
};

export const SupplierConversation: Model<SupplierConversationDoc> =
  mongoose.models.SupplierConversation ||
  mongoose.model<SupplierConversationDoc>('SupplierConversation', supplierConversationSchema);

export const SupplierConversationMessage: Model<SupplierConversationMessageDoc> =
  mongoose.models.SupplierConversationMessage ||
  mongoose.model<SupplierConversationMessageDoc>(
    'SupplierConversationMessage',
    supplierConversationMessageSchema
  );
