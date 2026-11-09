import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';
import { ROLES } from '../types/roles.js';

const shopMembershipSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    shop: { type: Schema.Types.ObjectId, ref: 'RepairShop', required: true, index: true },
    role: {
      type: String,
      enum: ROLES.filter((r) => r !== 'customer'),
      required: true
    },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

shopMembershipSchema.index({ user: 1, shop: 1, role: 1 }, { unique: true });

export type ShopMembershipDoc = InferSchemaType<typeof shopMembershipSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const ShopMembership: Model<ShopMembershipDoc> =
  mongoose.models.ShopMembership ||
  mongoose.model<ShopMembershipDoc>('ShopMembership', shopMembershipSchema);
