import type { Types } from 'mongoose';
import { RepairTrackingEvent } from '../models/index.js';
import { notify } from './notifications.js';

export type TrackingEventKey =
  | 'repair_received'
  | 'mechanic_assigned'
  | 'diagnosis_completed'
  | 'estimate_prepared'
  | 'estimate_awaiting_approval'
  | 'estimate_approved'
  | 'estimate_rejected'
  | 'estimate_revised'
  | 'parts_checking'
  | 'parts_unavailable'
  | 'transfer_requested'
  | 'parts_in_transit'
  | 'parts_received'
  | 'parts_reserved'
  | 'arrival_unconfirmed'
  | 'ready_to_start'
  | 'repair_started'
  | 'ready_for_collection'
  | 'repair_collected'
  | 'message_received';

const CUSTOMER_TITLES: Record<TrackingEventKey, { title: string; message: string; notify?: boolean }> = {
  repair_received: {
    title: 'Repair request received',
    message: 'Your repair request has been received.',
    notify: true
  },
  mechanic_assigned: {
    title: 'Assigned to mechanic',
    message: 'Your device has been assigned to a mechanic.',
    notify: true
  },
  diagnosis_completed: {
    title: 'Device diagnosis completed',
    message: 'Diagnosis of your device has been completed.',
    notify: true
  },
  estimate_prepared: {
    title: 'Estimate prepared',
    message: 'Your repair estimate is ready for review.',
    notify: true
  },
  estimate_awaiting_approval: {
    title: 'Awaiting customer approval',
    message: 'Your repair estimate is awaiting your approval.',
    notify: true
  },
  estimate_approved: {
    title: 'Estimate approved',
    message: 'Your estimate approval has been recorded.',
    notify: true
  },
  estimate_rejected: {
    title: 'Estimate rejected',
    message: 'The estimate was rejected. A revised estimate may follow.',
    notify: true
  },
  estimate_revised: {
    title: 'Revised estimate awaiting approval',
    message: 'A revised repair estimate is ready for your review.',
    notify: true
  },
  parts_checking: {
    title: 'Parts availability checked',
    message: 'Parts availability is being checked.',
    notify: false
  },
  parts_unavailable: {
    title: 'Part unavailable',
    message: 'The required part is currently unavailable.',
    notify: true
  },
  transfer_requested: {
    title: 'Part transfer requested',
    message: 'A part transfer has been requested.',
    notify: true
  },
  parts_in_transit: {
    title: 'Part in transit',
    message: 'The required part is on its way.',
    notify: true
  },
  parts_received: {
    title: 'Part received',
    message: 'The required part has arrived.',
    notify: true
  },
  parts_reserved: {
    title: 'Part reserved',
    message: 'The required part has arrived and is reserved.',
    notify: true
  },
  arrival_unconfirmed: {
    title: 'Arrival date unconfirmed',
    message: 'The delivery date is not yet confirmed.',
    notify: true
  },
  ready_to_start: {
    title: 'Repair ready to start',
    message: 'Your repair is ready to start.',
    notify: true
  },
  repair_started: {
    title: 'Repair in progress',
    message: 'Work on your repair has started.',
    notify: true
  },
  ready_for_collection: {
    title: 'Ready for collection',
    message: 'Your repair is ready for collection.',
    notify: true
  },
  repair_collected: {
    title: 'Collected and completed',
    message: 'Your repair has been collected and completed.',
    notify: true
  },
  message_received: {
    title: 'New message',
    message: 'You have a new message about your repair.',
    notify: true
  }
};

export async function recordTrackingEvent(input: {
  repairId: string | Types.ObjectId;
  eventKey: TrackingEventKey;
  dedupeKey?: string;
  visibility?: 'customer_visible' | 'internal';
  title?: string;
  message?: string;
  source?: string;
  meta?: unknown;
  customerId?: string | Types.ObjectId | null;
  notifyCustomer?: boolean;
}) {
  const defaults = CUSTOMER_TITLES[input.eventKey];
  const dedupeKey = input.dedupeKey || input.eventKey;
  try {
    const event = await RepairTrackingEvent.create({
      repairRequest: input.repairId,
      eventKey: input.eventKey,
      dedupeKey,
      visibility: input.visibility || 'customer_visible',
      occurredAt: new Date(),
      title: input.title || defaults.title,
      message: input.message || defaults.message,
      source: input.source || 'system',
      meta: input.meta
    });

    const shouldNotify =
      input.notifyCustomer !== false &&
      defaults.notify &&
      (input.visibility || 'customer_visible') === 'customer_visible' &&
      input.customerId;

    if (shouldNotify) {
      await notify({
        user: input.customerId!,
        type: `tracking_${input.eventKey}`,
        title: event.title,
        message: event.message,
        repairRequest: input.repairId,
        meta: { eventKey: input.eventKey }
      });
    }

    return event;
  } catch (err) {
    // Duplicate key = already recorded; ignore for idempotency
    if ((err as { code?: number }).code === 11000) return null;
    throw err;
  }
}

export async function listTrackingEventsForRepair(
  repairId: string | Types.ObjectId,
  opts: { customerVisibleOnly?: boolean } = {}
) {
  const filter: Record<string, unknown> = { repairRequest: repairId };
  if (opts.customerVisibleOnly) filter.visibility = 'customer_visible';
  return RepairTrackingEvent.find(filter).sort({ occurredAt: 1 }).lean();
}
