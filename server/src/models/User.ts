import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';
import { ROLES } from '../types/roles.js';

const preferencesSchema = new Schema(
  {
    theme: { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
    accent: {
      type: String,
      enum: ['indigo', 'blue', 'teal', 'violet', 'emerald'],
      default: 'emerald'
    },
    density: { type: String, enum: ['comfortable', 'compact'], default: 'comfortable' },
    fontScale: { type: String, enum: ['standard', 'large'], default: 'standard' },
    reducedMotion: { type: Boolean, default: false },
    highContrast: { type: Boolean, default: false },
    sidebarCollapsed: { type: Boolean, default: false },
    dashboardWidgets: {
      type: [String],
      default: undefined
    },
    chartStyle: { type: String, enum: ['bar', 'line', 'donut'], default: 'bar' }
  },
  { _id: false }
);

/**
 * Account lifecycle:
 * - Pending shop owners use operational role `shop_admin` with `pending_shop_owner`
 *   until approval creates a ShopMembership — they cannot access shop APIs until then.
 * - Pending suppliers use role `supplier` with `pending_supplier` until approval
 *   creates a SupplierBusiness — they cannot access supplier/marketplace APIs until then.
 * - Platform onboarding authority uses role `platform_operator` (not shop-scoped).
 *   Never grant that role via public registration or shop staff APIs.
 */
export const ACCOUNT_STATUSES = ['active', 'pending_shop_owner', 'pending_supplier'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true, select: false },
    name: { type: String, required: true, trim: true },
    role: { type: String, enum: ROLES, required: true, index: true },
    accountStatus: {
      type: String,
      enum: ACCOUNT_STATUSES,
      default: 'active',
      index: true
    },
    preferredLanguage: { type: String, enum: ['en', 'ur'], default: 'en' },
    phone: { type: String, trim: true },
    avatarUrl: { type: String, trim: true, maxlength: 400_000 },
    isActive: { type: Boolean, default: true },
    notificationPreferences: {
      repairUpdates: { type: Boolean, default: true },
      estimateRequests: { type: Boolean, default: true },
      partsAlerts: { type: Boolean, default: true },
      appointmentReminders: { type: Boolean, default: true }
    },
    preferences: { type: preferencesSchema, default: () => ({}) }
  },
  { timestamps: true }
);

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: mongoose.Types.ObjectId };

export const User: Model<UserDoc> =
  mongoose.models.User || mongoose.model<UserDoc>('User', userSchema);
