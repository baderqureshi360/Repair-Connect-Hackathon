import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

/**
 * Server-side refresh session registry.
 * Stores SHA-256 hashes only — never plaintext refresh JWTs.
 * Rotation links sessions via familyId; reuse of a rotated token revokes the family.
 */
const refreshSessionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    /** Opaque session id embedded in JWT `sid` claim */
    sid: { type: String, required: true, unique: true, index: true },
    /** Rotation family — all sessions from one login lineage share this id */
    familyId: { type: String, required: true, index: true },
    /** SHA-256 hex of the refresh JWT */
    tokenHash: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null, index: true },
    revokeReason: {
      type: String,
      enum: [
        '',
        'logout',
        'rotated',
        'reuse_detected',
        'password_change',
        'password_reset',
        'account_deactivated',
        'supplier_suspended',
        'admin_revoke',
        'expired'
      ],
      default: ''
    },
    replacedBySid: { type: String, default: '' },
    userAgent: { type: String, maxlength: 300, default: '' },
    ip: { type: String, maxlength: 80, default: '' }
  },
  { timestamps: true }
);

refreshSessionSchema.index({ user: 1, revokedAt: 1, expiresAt: 1 });
refreshSessionSchema.index({ familyId: 1, revokedAt: 1 });
/** TTL cleanup of expired rows (MongoDB TTL index). */
refreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type RefreshSessionDoc = InferSchemaType<typeof refreshSessionSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
};

export const RefreshSession: Model<RefreshSessionDoc> =
  mongoose.models.RefreshSession ||
  mongoose.model<RefreshSessionDoc>('RefreshSession', refreshSessionSchema);
