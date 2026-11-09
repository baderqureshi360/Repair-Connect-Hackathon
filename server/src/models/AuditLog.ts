import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const auditLogSchema = new Schema(
  {
    actor: { type: Schema.Types.ObjectId, ref: 'User' },
    action: { type: String, required: true, index: true },
    entityType: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId },
    shop: { type: Schema.Types.ObjectId, ref: 'RepairShop' },
    details: { type: Schema.Types.Mixed },
    ip: { type: String }
  },
  { timestamps: true }
);

export type AuditLogDoc = InferSchemaType<typeof auditLogSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const AuditLog: Model<AuditLogDoc> =
  mongoose.models.AuditLog || mongoose.model<AuditLogDoc>('AuditLog', auditLogSchema);
