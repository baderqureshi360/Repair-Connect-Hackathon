import { RepairMessage, RepairRequest, User } from '../models/index.js';
import type { AuthUser } from '../middleware/auth.js';
import { AppError } from '../utils/errors.js';
import { assertCanViewRepair } from './access.js';
import { notify } from './notifications.js';
import { recordTrackingEvent } from './trackingEvents.js';
import { writeAudit } from './audit.js';

const MAX_ATTACHMENTS = 3;
const MAX_ATTACHMENT_CHARS = 350_000;

function sanitizeAttachments(
  attachments?: { url: string; caption?: string; contentType?: string }[]
) {
  if (!attachments?.length) return [];
  return attachments.slice(0, MAX_ATTACHMENTS).map((a) => {
    const url = String(a.url || '');
    if (!url.startsWith('data:image/') || url.length > MAX_ATTACHMENT_CHARS) {
      throw new AppError('Invalid attachment', 400, 'INVALID_ATTACHMENT');
    }
    return {
      url,
      caption: String(a.caption || '').slice(0, 200),
      contentType: String(a.contentType || 'image/jpeg').slice(0, 80)
    };
  });
}

export async function listRepairMessages(repairId: string, user: AuthUser) {
  const repair = await RepairRequest.findById(repairId);
  if (!repair) throw new AppError('Repair not found', 404, 'NOT_FOUND');
  assertCanViewRepair(user, repair);

  const filter: Record<string, unknown> = { repairRequest: repair._id };
  if (user.role === 'customer') {
    filter.visibility = 'customer_visible';
  }

  const messages = await RepairMessage.find(filter).sort({ createdAt: 1 }).lean();

  // Mark as read for current user
  const ids = messages.map((m) => m._id);
  if (ids.length) {
    await RepairMessage.updateMany(
      { _id: { $in: ids }, readBy: { $ne: user.id } },
      { $addToSet: { readBy: user.id } }
    );
  }

  return messages.map((m) => ({
    id: m._id,
    body: m.body,
    visibility: m.visibility,
    messageType: (m as { messageType?: string }).messageType || 'general',
    senderRole: m.senderRole,
    senderName: m.senderName,
    senderId: m.sender,
    attachments: m.attachments || [],
    createdAt: (m as { createdAt?: Date }).createdAt,
    isRead: Array.isArray(m.readBy) && m.readBy.some((id) => String(id) === user.id),
    unread: !(Array.isArray(m.readBy) && m.readBy.some((id) => String(id) === user.id))
  }));
}

export async function postRepairMessage(input: {
  repairId: string;
  user: AuthUser;
  body: string;
  visibility?: 'customer_visible' | 'internal';
  messageType?: 'general' | 'status_update' | 'estimate' | 'payment' | 'system';
  attachments?: { url: string; caption?: string; contentType?: string }[];
}) {
  const repair = await RepairRequest.findById(input.repairId);
  if (!repair) throw new AppError('Repair not found', 404, 'NOT_FOUND');
  assertCanViewRepair(input.user, repair);

  let visibility = input.visibility || 'customer_visible';
  if (input.user.role === 'customer') {
    visibility = 'customer_visible';
  }
  if (visibility === 'internal' && input.user.role === 'customer') {
    throw new AppError('Customers cannot post internal messages', 403, 'FORBIDDEN');
  }

  const body = String(input.body || '').trim();
  if (body.length < 1 || body.length > 4000) {
    throw new AppError('Message body is required', 400, 'INVALID_BODY');
  }

  if (repair.status === 'completed' && input.user.role === 'customer') {
    // Customers may still message after closure for support; shop staff also allowed.
  }

  const sender = await User.findById(input.user.id).select('name');
  const messageType = input.messageType || 'general';
  const message = await RepairMessage.create({
    repairRequest: repair._id,
    shop: repair.shop,
    sender: input.user.id,
    senderRole: input.user.role === 'platform_operator' ? 'shop_admin' : input.user.role,
    senderName: sender?.name || 'User',
    body,
    visibility,
    messageType,
    attachments: sanitizeAttachments(input.attachments),
    readBy: [input.user.id]
  });

  await writeAudit({
    actor: input.user.id,
    action: 'repair.message',
    entityType: 'RepairMessage',
    entityId: message._id,
    shop: repair.shop,
    details: { visibility, messageType, repairId: repair._id }
  });

  if (visibility === 'customer_visible') {
    if (input.user.role === 'customer') {
      // Notify assigned mechanic and shop admins via assigned mechanic + skip broadcast complexity
      if (repair.assignedMechanic) {
        await notify({
          user: repair.assignedMechanic,
          type: 'repair_message',
          title: 'New customer message',
          message: `Customer messaged about ${repair.referenceNumber}`,
          repairRequest: repair._id
        });
      }
    } else {
      await notify({
        user: repair.customer,
        type: 'repair_message',
        title: 'New message from your repair shop',
        message: `You have a new message about ${repair.referenceNumber}`,
        repairRequest: repair._id
      });
      await recordTrackingEvent({
        repairId: repair._id,
        eventKey: 'message_received',
        customerId: repair.customer,
        dedupeKey: `message:${message._id}`,
        notifyCustomer: false
      });
    }
  }

  return {
    id: message._id,
    body: message.body,
    visibility: message.visibility,
    messageType: message.messageType || 'general',
    senderRole: message.senderRole,
    senderName: message.senderName,
    createdAt: message.createdAt
  };
}

/** System / staff helper used by payment and status services. */
export async function postSystemRepairMessage(input: {
  repairId: string;
  body: string;
  messageType?: 'general' | 'status_update' | 'estimate' | 'payment' | 'system';
  actorId: string;
}) {
  const repair = await RepairRequest.findById(input.repairId);
  if (!repair) throw new AppError('Repair not found', 404, 'NOT_FOUND');
  const sender = await User.findById(input.actorId).select('name role');
  const message = await RepairMessage.create({
    repairRequest: repair._id,
    shop: repair.shop,
    sender: input.actorId,
    senderRole: sender?.role === 'customer' ? 'shop_admin' : sender?.role || 'shop_admin',
    senderName: sender?.name || 'RepairConnect',
    body: input.body,
    visibility: 'customer_visible',
    messageType: input.messageType || 'system',
    readBy: [input.actorId]
  });
  return message;
}
