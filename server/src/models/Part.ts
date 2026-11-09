import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const partSchema = new Schema(
  {
    shop: { type: Schema.Types.ObjectId, ref: 'RepairShop', required: true, index: true },
    sku: { type: String, required: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    category: { type: String, default: 'general', index: true },
    quantityAvailable: { type: Number, required: true, min: 0, default: 0 },
    quantityReserved: { type: Number, required: true, min: 0, default: 0 },
    reorderLevel: { type: Number, required: true, min: 0, default: 2 },
    unitCost: { type: Number, required: true, min: 0 },
    supplier: { type: String, default: '' },
    supplierSku: { type: String, default: '' },
    supplierRef: { type: Schema.Types.ObjectId, ref: 'Supplier' },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

partSchema.index({ shop: 1, sku: 1 }, { unique: true });
partSchema.virtual('quantityUnavailable').get(function (this: { quantityAvailable: number; quantityReserved: number }) {
  return Math.max(0, this.quantityReserved);
});

export type PartDoc = InferSchemaType<typeof partSchema> & { _id: mongoose.Types.ObjectId };

export const Part: Model<PartDoc> =
  mongoose.models.Part || mongoose.model<PartDoc>('Part', partSchema);
