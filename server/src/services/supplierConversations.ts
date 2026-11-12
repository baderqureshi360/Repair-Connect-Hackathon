import {
  SupplierConversation,
  SupplierConversationMessage,
  SupplierBusiness,
  RepairShop
} from '../models/index.js';
import { AppError } from '../utils/errors.js';
import { writeAudit } from './audit.js';
import type { AuthUser } from '../middleware/auth.js';
import {
  assertShopAccess,
  normalizeAttachments,
  notifyUsers,
  requireApprovedSupplierBusiness,
  requireApprovedSupplierById,
  shopAdminUserIds,
  supplierOwnerId,
  userName
} from './supplierNetworkShared.js';

function serializeConversation(
  c: InstanceType<typeof SupplierConversation>,
  extras?: Record<string, unknown>
) {
  return {
    id: String(c._id),
    shopId: String(c.shop),
    supplierBusinessId: String(c.supplierBusiness),
    subject: c.subject || '',
    lastMessageAt: c.lastMessageAt || c.updatedAt || null,
    shopUnreadCount: c.shopUnreadCount || 0,
    supplierUnreadCount: c.supplierUnreadCount || 0,
    isClosed: Boolean(c.isClosed),
    createdAt: c.createdAt || null,
    ...extras
  };
}

export async function startOrGetConversation(input: {
  user: AuthUser;
  shopId: string;
  supplierBusinessId: string;
  subject?: string;
}) {
  assertShopAccess(input.user, input.shopId);
  await requireApprovedSupplierById(input.supplierBusinessId);

  let conversation = await SupplierConversation.findOne({
    shop: input.shopId,
    supplierBusiness: input.supplierBusinessId
  });

  if (!conversation) {
    conversation = await SupplierConversation.create({
      shop: input.shopId,
      supplierBusiness: input.supplierBusinessId,
      subject: String(input.subject || '').trim().slice(0, 200),
      createdBy: input.user.id,
      lastMessageAt: new Date(),
      shopUnreadCount: 0,
      supplierUnreadCount: 0
    });
    await writeAudit({
      actor: input.user.id,
      action: 'supplier_conversation.create',
      entityType: 'SupplierConversation',
      entityId: conversation._id,
      shop: input.shopId,
      details: { supplierBusinessId: input.supplierBusinessId }
    });
  }

  return serializeConversation(conversation);
}

export async function listConversationsForShop(user: AuthUser, shopId: string) {
  assertShopAccess(user, shopId);
  const rows = await SupplierConversation.find({ shop: shopId }).sort({ lastMessageAt: -1 }).limit(100);
  const supplierIds = rows.map((r) => r.supplierBusiness);
  const businesses = await SupplierBusiness.find({ _id: { $in: supplierIds } }).select(
    'businessName publicId logoUrl verified'
  );
  const byId = new Map(businesses.map((b) => [String(b._id), b]));
  return rows.map((c) => {
    const biz = byId.get(String(c.supplierBusiness));
    return serializeConversation(c, {
      unread: c.shopUnreadCount || 0,
      supplier: biz
        ? {
            id: String(biz._id),
            publicId: biz.publicId,
            businessName: biz.businessName,
            logoUrl: biz.logoUrl || '',
            verified: Boolean(biz.verified)
          }
        : null
    });
  });
}

export async function listConversationsForSupplier(user: AuthUser) {
  const business = await requireApprovedSupplierBusiness(user.id);
  const rows = await SupplierConversation.find({ supplierBusiness: business._id })
    .sort({ lastMessageAt: -1 })
    .limit(100);
  const shopIds = rows.map((r) => r.shop);
  const shops = await RepairShop.find({ _id: { $in: shopIds } }).select('name code city');
  const byId = new Map(shops.map((s) => [String(s._id), s]));
  return rows.map((c) => {
    const shop = byId.get(String(c.shop));
    return serializeConversation(c, {
      unread: c.supplierUnreadCount || 0,
      shop: shop
        ? { id: String(shop._id), name: shop.name, code: shop.code, city: shop.city }
        : null
    });
  });
}

async function loadConversationForActor(user: AuthUser, conversationId: string) {
  const conversation = await SupplierConversation.findById(conversationId);
  if (!conversation) throw new AppError('Conversation not found', 404, 'NOT_FOUND');

  if (user.role === 'shop_admin') {
    assertShopAccess(user, String(conversation.shop));
    return { conversation, actor: 'shop' as const };
  }
  if (user.role === 'supplier') {
    const business = await requireApprovedSupplierBusiness(user.id);
    if (String(conversation.supplierBusiness) !== String(business._id)) {
      throw new AppError('Conversation not found', 404, 'NOT_FOUND');
    }
    return { conversation, actor: 'supplier' as const };
  }
  throw new AppError('Forbidden', 403, 'FORBIDDEN');
}

export async function listMessages(user: AuthUser, conversationId: string) {
  const { conversation, actor } = await loadConversationForActor(user, conversationId);
  const filter: Record<string, unknown> = { conversation: conversation._id };
  if (actor === 'supplier') {
    filter.visibility = 'participant_visible';
  }

  const messages = await SupplierConversationMessage.find(filter).sort({ createdAt: 1 }).limit(500);

  // Mark read
  const unread = messages.filter((m) => !(m.readBy || []).some((id) => String(id) === user.id));
  if (unread.length) {
    await SupplierConversationMessage.updateMany(
      { _id: { $in: unread.map((m) => m._id) } },
      { $addToSet: { readBy: user.id } }
    );
  }
  if (actor === 'shop' && (conversation.shopUnreadCount || 0) > 0) {
    conversation.shopUnreadCount = 0;
    await conversation.save();
  }
  if (actor === 'supplier' && (conversation.supplierUnreadCount || 0) > 0) {
    conversation.supplierUnreadCount = 0;
    await conversation.save();
  }

  return messages.map((m) => ({
    id: String(m._id),
    body: m.body,
    senderRole: m.senderRole,
    senderName: m.senderName,
    visibility: m.visibility,
    attachments: (m.attachments || []).map((a) => ({
      name: a.name,
      dataUrl: a.dataUrl,
      contentType: a.contentType,
      size: a.size
    })),
    createdAt: m.createdAt || null,
    isMine: String(m.sender) === user.id,
    readByMe: true
  }));
}

export async function postMessage(input: {
  user: AuthUser;
  conversationId: string;
  body: string;
  visibility?: 'participant_visible' | 'shop_internal';
  attachments?: Array<{ name?: string; dataUrl: string; contentType?: string }>;
}) {
  const { conversation, actor } = await loadConversationForActor(input.user, input.conversationId);
  if (conversation.isClosed) throw new AppError('Conversation is closed', 409, 'CLOSED');

  const body = String(input.body || '').trim();
  if (body.length < 1) throw new AppError('Message body is required', 400, 'BODY_REQUIRED');

  let visibility: 'participant_visible' | 'shop_internal' = 'participant_visible';
  if (input.visibility === 'shop_internal') {
    if (actor !== 'shop') {
      throw new AppError('Only shop staff can create internal notes', 403, 'FORBIDDEN');
    }
    visibility = 'shop_internal';
  }

  const attachments = normalizeAttachments(input.attachments);
  const name = await userName(input.user.id);

  const message = await SupplierConversationMessage.create({
    conversation: conversation._id,
    shop: conversation.shop,
    supplierBusiness: conversation.supplierBusiness,
    sender: input.user.id,
    senderRole: actor === 'shop' ? 'shop_admin' : 'supplier',
    senderName: name,
    body: body.slice(0, 4000),
    visibility,
    attachments,
    readBy: [input.user.id]
  });

  conversation.lastMessageAt = new Date();
  if (visibility === 'participant_visible') {
    if (actor === 'shop') conversation.supplierUnreadCount = (conversation.supplierUnreadCount || 0) + 1;
    else conversation.shopUnreadCount = (conversation.shopUnreadCount || 0) + 1;
  }
  await conversation.save();

  if (visibility === 'participant_visible') {
    if (actor === 'shop') {
      const owner = await supplierOwnerId(String(conversation.supplierBusiness));
      await notifyUsers(
        [owner],
        'supplier_message',
        'New message from a shop',
        body.slice(0, 160),
        { conversationId: String(conversation._id) }
      );
    } else {
      const admins = await shopAdminUserIds(String(conversation.shop));
      await notifyUsers(
        admins,
        'supplier_message',
        'New message from a supplier',
        body.slice(0, 160),
        { conversationId: String(conversation._id) }
      );
    }
  }

  await writeAudit({
    actor: input.user.id,
    action: 'supplier_conversation.message',
    entityType: 'SupplierConversationMessage',
    entityId: message._id,
    shop: conversation.shop,
    details: { conversationId: conversation._id, visibility }
  });

  return {
    id: String(message._id),
    body: message.body,
    senderRole: message.senderRole,
    senderName: message.senderName,
    visibility: message.visibility,
    attachments: message.attachments,
    createdAt: message.createdAt || null,
    isMine: true
  };
}
