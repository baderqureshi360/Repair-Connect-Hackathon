import type { ClientSession, Types } from 'mongoose';
import { OutboxEvent, Notification, RepairMessage, RepairRequest, User } from '../models/index.js';
import { env } from '../config/env.js';

type NotifyPayload = {
  user: string;
  type: string;
  title: string;
  message: string;
  repairRequest?: string;
  meta?: unknown;
};

type RepairMessagePayload = {
  repairId: string;
  actorId: string;
  body: string;
  messageType?: string;
  visibility?: 'customer_visible' | 'internal';
};

const TYPE_PREF_MAP: Record<string, string> = {
  repair_completed: 'repairUpdates',
  payment_received: 'repairUpdates',
  repair_message: 'repairUpdates',
  estimate_ready: 'estimateRequests',
  estimate_approved: 'estimateRequests',
  estimate_rejected: 'estimateRequests',
  estimate_pending: 'estimateRequests'
};

let processing = false;
let timer: NodeJS.Timeout | null = null;

export async function enqueueOutboxEvent(input: {
  channel: 'notification' | 'repair_message';
  dedupeKey: string;
  payload: NotifyPayload | RepairMessagePayload;
  orderingKey?: string;
  sequence?: number;
  session?: ClientSession;
}) {
  const doc = {
    channel: input.channel,
    dedupeKey: input.dedupeKey,
    payload: input.payload,
    orderingKey: input.orderingKey,
    sequence: input.sequence || 0,
    status: 'pending' as const,
    nextAttemptAt: new Date()
  };
  try {
    if (input.session) {
      const docs = await OutboxEvent.create([doc], { session: input.session });
      return docs[0];
    }
    return await OutboxEvent.create(doc);
  } catch (err) {
    // Duplicate dedupeKey → already queued/delivered; treat as success (idempotent).
    if (err && typeof err === 'object' && (err as { code?: number }).code === 11000) {
      return OutboxEvent.findOne({ dedupeKey: input.dedupeKey }).session(input.session || null);
    }
    throw err;
  }
}

async function deliverNotification(payload: NotifyPayload) {
  if (!payload.user) return;
  const user = await User.findById(payload.user).select('notificationPreferences');
  const prefs = (user?.notificationPreferences || {}) as Record<string, boolean>;
  const prefKey = TYPE_PREF_MAP[payload.type];
  if (prefKey && prefs[prefKey] === false) return;

  // Prefer existing notification if identical dedupe was stored in meta previously.
  await Notification.create({
    user: payload.user,
    type: payload.type,
    title: payload.title,
    message: payload.message,
    repairRequest: payload.repairRequest,
    meta: payload.meta
  });
}

async function deliverRepairMessage(payload: RepairMessagePayload) {
  const repair = await RepairRequest.findById(payload.repairId);
  if (!repair) return;
  const sender = await User.findById(payload.actorId).select('name role');
  await RepairMessage.create({
    repairRequest: repair._id,
    shop: repair.shop,
    sender: payload.actorId,
    senderRole: sender?.role === 'customer' ? 'shop_admin' : sender?.role || 'shop_admin',
    senderName: sender?.name || 'RepairConnect',
    body: payload.body,
    visibility: payload.visibility || 'customer_visible',
    messageType: payload.messageType || 'system',
    readBy: [payload.actorId]
  });
}

async function deliver(event: {
  channel: string;
  payload: unknown;
}) {
  if (event.channel === 'notification') {
    await deliverNotification(event.payload as NotifyPayload);
  } else if (event.channel === 'repair_message') {
    await deliverRepairMessage(event.payload as RepairMessagePayload);
  }
}

function backoffMs(attempts: number) {
  return Math.min(60_000, 500 * 2 ** Math.min(attempts, 6));
}

/** Process a batch of pending outbox events. Safe to call concurrently (claim via status). */
export async function processOutboxBatch(limit = 25): Promise<number> {
  if (processing) return 0;
  processing = true;
  let delivered = 0;
  try {
    const now = new Date();
    const pending = await OutboxEvent.find({
      status: { $in: ['pending', 'failed'] },
      nextAttemptAt: { $lte: now }
    })
      .sort({ orderingKey: 1, sequence: 1, createdAt: 1 })
      .limit(limit);

    for (const event of pending) {
      const claimed = await OutboxEvent.findOneAndUpdate(
        {
          _id: event._id,
          status: { $in: ['pending', 'failed'] }
        },
        { $set: { status: 'processing' }, $inc: { attempts: 1 } },
        { new: true }
      );
      if (!claimed) continue;

      try {
        await deliver(claimed);
        claimed.status = 'delivered';
        claimed.deliveredAt = new Date();
        claimed.lastError = '';
        await claimed.save();
        delivered += 1;
      } catch (err) {
        const attempts = claimed.attempts || 1;
        claimed.status = attempts >= 8 ? 'dead' : 'failed';
        claimed.lastError = String((err as Error)?.message || err).slice(0, 500);
        claimed.nextAttemptAt = new Date(Date.now() + backoffMs(attempts));
        await claimed.save();
      }
    }
  } finally {
    processing = false;
  }
  return delivered;
}

/** Fire-and-forget kick after a commit (non-blocking). */
export function kickOutboxProcessor() {
  if (env.isTest) return;
  void processOutboxBatch().catch(() => undefined);
}

export function startOutboxProcessor(intervalMs = 4000) {
  if (env.isTest || timer) return;
  timer = setInterval(() => {
    void processOutboxBatch().catch(() => undefined);
  }, intervalMs);
  // Don't keep the process alive solely for the timer in some environments.
  timer.unref?.();
}

export function stopOutboxProcessor() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export type { NotifyPayload, RepairMessagePayload, Types };
