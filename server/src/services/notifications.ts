import type { ClientSession, Types } from 'mongoose';
import { ShopMembership, User } from '../models/index.js';
import { enqueueOutboxEvent, processOutboxBatch } from './outbox.js';

type UserPrefs = {
  repairUpdates?: boolean;
  estimateRequests?: boolean;
  partsAlerts?: boolean;
  appointmentReminders?: boolean;
};

const TYPE_PREF_MAP: Record<string, keyof UserPrefs> = {
  repair_completed: 'repairUpdates',
  repair_assigned: 'repairUpdates',
  diagnosis_ready: 'repairUpdates',
  estimate_pending: 'estimateRequests',
  estimate_approved: 'estimateRequests',
  estimate_rejected: 'estimateRequests',
  estimate_ready: 'estimateRequests',
  parts_shortage: 'partsAlerts',
  parts_reserved: 'partsAlerts',
  parts_available: 'partsAlerts',
  parts_request: 'partsAlerts',
  low_stock: 'partsAlerts',
  transfer_received: 'partsAlerts',
  appointment_booked: 'appointmentReminders',
  appointment_reminder: 'appointmentReminders',
  repair_message: 'repairUpdates',
  payment_received: 'repairUpdates',
  new_repair_request: 'repairUpdates',
  pending_approval: 'estimateRequests',
  staff_activity: 'repairUpdates',
  customer_update: 'repairUpdates',
  tracking_repair_received: 'repairUpdates',
  tracking_mechanic_assigned: 'repairUpdates',
  tracking_diagnosis_completed: 'repairUpdates',
  tracking_estimate_prepared: 'estimateRequests',
  tracking_estimate_awaiting_approval: 'estimateRequests',
  tracking_estimate_approved: 'estimateRequests',
  tracking_estimate_rejected: 'estimateRequests',
  tracking_estimate_revised: 'estimateRequests',
  tracking_parts_unavailable: 'partsAlerts',
  tracking_transfer_requested: 'partsAlerts',
  tracking_parts_in_transit: 'partsAlerts',
  tracking_parts_received: 'partsAlerts',
  tracking_parts_reserved: 'partsAlerts',
  tracking_arrival_unconfirmed: 'partsAlerts',
  tracking_ready_to_start: 'repairUpdates',
  tracking_repair_started: 'repairUpdates',
  tracking_ready_for_collection: 'repairUpdates',
  tracking_repair_collected: 'repairUpdates',
  tracking_message_received: 'repairUpdates',
  // Supplier network types — map to partsAlerts for shop staff who opted out of parts noise
  supplier_po: 'partsAlerts',
  supplier_grn: 'partsAlerts',
  supplier_shipment: 'partsAlerts',
  supplier_rfq: 'partsAlerts',
  supplier_quotation: 'partsAlerts',
  supplier_finance: 'partsAlerts',
  supplier_message: 'repairUpdates'
};

export type ShopStaffRole = 'shop_admin' | 'parts_coordinator' | 'mechanic';

/**
 * Enqueue a customer/staff notification through the transactional outbox.
 * Prefer calling inside the same MongoDB session as the business write.
 * Does not introduce a second notification store — delivery writes Notification docs.
 */
export async function notify(input: {
  user?: string | Types.ObjectId | null;
  type: string;
  title: string;
  message: string;
  repairRequest?: string | Types.ObjectId;
  meta?: unknown;
  dedupeKey?: string;
  session?: ClientSession;
}) {
  // Walk-in repairs may have no linked customer account.
  if (!input.user) return null;

  const userId = String(input.user);
  // Preference check before enqueue avoids useless retries for opted-out users.
  const user = await User.findById(userId).select('notificationPreferences').session(input.session || null);
  const prefs = (user?.notificationPreferences || {}) as UserPrefs;
  const prefKey = TYPE_PREF_MAP[input.type];
  if (prefKey && prefs[prefKey] === false) {
    return null;
  }

  const dedupeKey =
    input.dedupeKey ||
    `${input.type}:${userId}:${input.repairRequest || 'none'}:${input.title}:${input.message}`.slice(
      0,
      200
    );

  const event = await enqueueOutboxEvent({
    channel: 'notification',
    dedupeKey,
    orderingKey: input.repairRequest ? String(input.repairRequest) : userId,
    payload: {
      user: userId,
      type: input.type,
      title: input.title,
      message: input.message,
      repairRequest: input.repairRequest ? String(input.repairRequest) : undefined,
      meta: input.meta
    },
    session: input.session
  });

  // Outside a transaction, deliver promptly so callers/tests observe Notification rows.
  if (!input.session) {
    await processOutboxBatch(10);
  }
  return event;
}

/** Notify many users with per-user dedupe keys (skips null/duplicate ids). */
export async function notifyUsersViaOutbox(input: {
  userIds: Array<string | Types.ObjectId | null | undefined>;
  type: string;
  title: string;
  message: string;
  repairRequest?: string | Types.ObjectId;
  meta?: unknown;
  /** Prefix; each user gets `${prefix}:${userId}` (max 200 chars). */
  dedupeKeyPrefix: string;
  session?: ClientSession;
}) {
  const unique = [...new Set(input.userIds.filter(Boolean).map(String))];
  for (const userId of unique) {
    await notify({
      user: userId,
      type: input.type,
      title: input.title,
      message: input.message,
      repairRequest: input.repairRequest,
      meta: input.meta,
      dedupeKey: `${input.dedupeKeyPrefix}:${userId}`.slice(0, 200),
      session: input.session
    });
  }
}

/** Resolve active shop members by role and notify them (tenant-scoped by membership). */
export async function notifyShopMembers(input: {
  shopId: string | Types.ObjectId;
  roles: ShopStaffRole[];
  type: string;
  title: string;
  message: string;
  repairRequest?: string | Types.ObjectId;
  meta?: unknown;
  dedupeKeyPrefix: string;
  excludeUserIds?: Array<string | Types.ObjectId | null | undefined>;
  session?: ClientSession;
}) {
  const memberships = await ShopMembership.find({
    shop: input.shopId,
    role: { $in: input.roles },
    isActive: true
  })
    .select('user')
    .session(input.session || null);

  const exclude = new Set((input.excludeUserIds || []).filter(Boolean).map(String));
  const userIds = memberships.map((m) => String(m.user)).filter((id) => !exclude.has(id));

  await notifyUsersViaOutbox({
    userIds,
    type: input.type,
    title: input.title,
    message: input.message,
    repairRequest: input.repairRequest,
    meta: input.meta,
    dedupeKeyPrefix: input.dedupeKeyPrefix,
    session: input.session
  });
}
