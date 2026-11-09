import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';
import { SERVICE_CATEGORY_IDS } from '../constants/serviceCategories.js';

const dayHoursSchema = new Schema(
  {
    open: { type: String, default: '09:00' },
    close: { type: String, default: '18:00' },
    closed: { type: Boolean, default: false }
  },
  { _id: false }
);

const repairShopSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    address: { type: String, required: true },
    city: { type: String, required: true, index: true },
    phone: { type: String, required: true },
    email: { type: String, trim: true, lowercase: true },
    contactPerson: { type: String, trim: true, default: '' },
    region: { type: String, trim: true, default: '' },
    isActive: { type: Boolean, default: true },
    archivedAt: { type: Date },
    archiveReason: { type: String, default: '' },
    description: { type: String, default: '' },
    /** Public discovery categories — only show shops that actually offer these services. */
    serviceCategories: {
      type: [String],
      enum: SERVICE_CATEGORY_IDS,
      default: [],
      index: true
    },
    /** Optional brand/device hints for directory filters (free-text, shop-authored). */
    supportedBrands: { type: [String], default: [] },
    supportedDevices: { type: [String], default: [] },
    /** When false, phone/email are withheld from public customer directory cards. */
    showPhonePublic: { type: Boolean, default: true },
    showEmailPublic: { type: Boolean, default: true },
    dailyCapacity: { type: Number, min: 1, default: 16 },
    slotMinutes: { type: Number, min: 15, default: 60 },
    operatingHours: {
      type: Map,
      of: dayHoursSchema,
      default: () =>
        new Map([
          ['mon', { open: '09:00', close: '18:00', closed: false }],
          ['tue', { open: '09:00', close: '18:00', closed: false }],
          ['wed', { open: '09:00', close: '18:00', closed: false }],
          ['thu', { open: '09:00', close: '18:00', closed: false }],
          ['fri', { open: '09:00', close: '18:00', closed: false }],
          ['sat', { open: '10:00', close: '16:00', closed: false }],
          ['sun', { open: '00:00', close: '00:00', closed: true }]
        ])
    },
    cancelPolicyHours: { type: Number, min: 0, default: 2 }
  },
  { timestamps: true }
);

export type RepairShopDoc = InferSchemaType<typeof repairShopSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const RepairShop: Model<RepairShopDoc> =
  mongoose.models.RepairShop || mongoose.model<RepairShopDoc>('RepairShop', repairShopSchema);
