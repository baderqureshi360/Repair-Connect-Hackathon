import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const supplierSchema = new Schema(
  {
    shop: { type: Schema.Types.ObjectId, ref: 'RepairShop', required: true, index: true },
    name: { type: String, required: true, trim: true },
    contactName: { type: String, default: '', trim: true },
    email: { type: String, default: '', trim: true, lowercase: true },
    phone: { type: String, default: '', trim: true },
    address: { type: String, default: '' },
    notes: { type: String, default: '' },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

supplierSchema.index({ shop: 1, name: 1 }, { unique: true });

export type SupplierDoc = InferSchemaType<typeof supplierSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Supplier: Model<SupplierDoc> =
  mongoose.models.Supplier || mongoose.model<SupplierDoc>('Supplier', supplierSchema);
