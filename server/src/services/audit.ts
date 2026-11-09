import { AuditLog } from '../models/AuditLog.js';
import type { Types } from 'mongoose';

export async function writeAudit(input: {
  actor?: string | Types.ObjectId;
  action: string;
  entityType: string;
  entityId?: string | Types.ObjectId;
  shop?: string | Types.ObjectId;
  details?: unknown;
  ip?: string;
  session?: import('mongoose').ClientSession;
}) {
  const doc = {
    actor: input.actor,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    shop: input.shop,
    details: input.details,
    ip: input.ip
  };
  if (input.session) {
    await AuditLog.create([doc], { session: input.session });
  } else {
    await AuditLog.create(doc);
  }
}
