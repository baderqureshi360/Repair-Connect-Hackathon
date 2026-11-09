import type { ClientSession, Types } from 'mongoose';
import { User } from '../models/index.js';
import { enqueueOutboxEvent, processOutboxBatch } from './outbox.js';

const TYPE_PREF_MAP: Record<string, keyof NonNullable<UserPrefs>> = {
  repair_completed: 'repairUpdates',
  repair_assigned: 'repairUpdates',
  diagnosis_ready: 'repairUpdates',
  estimate_pending: 'estimateRequests',
  estimate_approved: 'estimateRequests',
  estimate_rejected: 'estimateRequests',
  estimate_ready: 'estimateRequests',
  parts_shortage: 'partsAlerts',
  parts_reserved: 'partsAlerts',
  transfer_received: 'partsAlerts',
  appointment_booked: 'appointmentReminders',
  appointment_reminder: 'appointmentReminders',
  repair_message: 'repairUpdates',
  payment_received: 'repairUpdates',
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
  tracking_message_received: 'repairUpdates'
};

type UserPrefs = {
  repairUpdates?: boolean;
  estimateRequests?: boolean;
  partsAlerts?: boolean;
  appointmentReminders?: boolean;
};

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
