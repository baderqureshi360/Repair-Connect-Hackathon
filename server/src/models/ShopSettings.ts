import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const shopSettingsSchema = new Schema(
  {
    shop: { type: Schema.Types.ObjectId, ref: 'RepairShop', required: true, unique: true, index: true },
    logoUrl: { type: String, maxlength: 400_000 },
    receiptHeader: { type: String, maxlength: 500, default: '' },
    receiptFooter: { type: String, maxlength: 500, default: 'Thank you for choosing RepairConnect.' },
    currency: { type: String, maxlength: 8, default: 'PKR' },
    taxLabel: { type: String, maxlength: 40, default: 'Tax' },
    taxRatePercent: { type: Number, min: 0, max: 100, default: 0 },
    warrantyTerms: { type: String, maxlength: 2000, default: 'Standard workshop warranty applies as stated on completion.' },
    defaultPrintFormat: { type: String, enum: ['a4', 'thermal80', 'thermal58'], default: 'a4' },
    printLanguage: { type: String, enum: ['en', 'ur'], default: 'en' },
    businessLegalName: { type: String, maxlength: 160 },
    contactExtra: { type: String, maxlength: 200 },
    /** Collection vs payment are separate operations — policy gates collection only. */
    paymentPolicy: {
      requirePaymentBeforeCollection: { type: Boolean, default: false },
      allowPartialPayment: { type: Boolean, default: true }
    }
  },
  { timestamps: true }
);

export type ShopSettingsDoc = InferSchemaType<typeof shopSettingsSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const ShopSettings: Model<ShopSettingsDoc> =
  mongoose.models.ShopSettings || mongoose.model<ShopSettingsDoc>('ShopSettings', shopSettingsSchema);
