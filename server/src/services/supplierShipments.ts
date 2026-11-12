import mongoose from 'mongoose';
import { SupplierPurchaseOrder, SupplierShipment } from '../models/index.js';
import { AppError } from '../utils/errors.js';
import { writeAudit } from './audit.js';
import type { AuthUser } from '../middleware/auth.js';
import {
  assertShopAccess,
  assertShopReceivingAccess,
  normalizeAttachments,
  notifyUsers,
  publicRef,
  requireApprovedSupplierBusiness,
  shopAdminUserIds,
  shopReceivingUserIds
} from './supplierNetworkShared.js';

function serializeShipment(s: InstanceType<typeof SupplierShipment>) {
  return {
    id: String(s._id),
    publicId: s.publicId,
    purchaseOrderId: String(s.purchaseOrder),
    shopId: String(s.shop),
    supplierBusinessId: String(s.supplierBusiness),
    status: s.status,
    carrier: s.carrier || '',
    trackingNumber: s.trackingNumber || '',
    dispatchDate: s.dispatchDate || null,
    expectedArrivalDate: s.expectedArrivalDate || null,
    actualArrivalDate: s.actualArrivalDate || null,
    notes: s.notes || '',
    delayReason: s.delayReason || '',
    lines: (s.lines || []).map((l) => ({ poLineId: l.poLineId, quantity: l.quantity })),
    attachments: (s.attachments || []).map((a) => ({
      name: a.name,
      dataUrl: a.dataUrl,
      contentType: a.contentType,
      size: a.size
    })),
    createdAt: s.createdAt || null,
    updatedAt: s.updatedAt || null
  };
}

async function loadPoForSupplierActor(user: AuthUser, poId: string) {
  const business = await requireApprovedSupplierBusiness(user.id);
  const key = String(poId || '').trim();
  const po = await SupplierPurchaseOrder.findOne({
    $or: [{ publicId: key }, ...(mongoose.isValidObjectId(key) ? [{ _id: key }] : [])],
    supplierBusiness: business._id
  });
  if (!po) throw new AppError('Purchase order not found', 404, 'NOT_FOUND');
  return { po, business };
}

export async function createShipment(input: {
  user: AuthUser;
  purchaseOrderId: string;
  carrier?: string;
  trackingNumber?: string;
  expectedArrivalDate?: string;
  notes?: string;
  lines: Array<{ poLineId: string; quantity: number }>;
  attachments?: Array<{ name?: string; dataUrl: string; contentType?: string }>;
  dispatch?: boolean;
}) {
  const { po } = await loadPoForSupplierActor(input.user, input.purchaseOrderId);
  if (!['acknowledged', 'partially_fulfilled', 'issued'].includes(po.status)) {
    throw new AppError('PO must be acknowledged (or open) before shipment', 409, 'INVALID_STATE');
  }

  const byLine = new Map((po.lines || []).map((l) => [l.lineId, l]));
  if (!input.lines?.length) throw new AppError('Shipment lines required', 400, 'NO_LINES');

  const lines = input.lines.map((l) => {
    const poLine = byLine.get(l.poLineId);
    if (!poLine) throw new AppError(`Unknown PO line ${l.poLineId}`, 400, 'INVALID_LINE');
    const qty = Math.floor(Number(l.quantity));
    if (qty < 1) throw new AppError('Shipment quantity must be at least 1', 400, 'INVALID_QUANTITY');
    const remaining = poLine.quantityOrdered - (poLine.quantityShipped || 0);
    if (qty > remaining) {
      throw new AppError(
        `Cannot ship ${qty} of ${poLine.name}; only ${remaining} remaining`,
        409,
        'OVERSHIP'
      );
    }
    return { poLineId: l.poLineId, quantity: qty };
  });

  const dispatch = Boolean(input.dispatch);
  const shipment = await SupplierShipment.create({
    publicId: publicRef('SHP', 5),
    purchaseOrder: po._id,
    shop: po.shop,
    supplierBusiness: po.supplierBusiness,
    createdBy: input.user.id,
    status: dispatch ? 'dispatched' : 'draft',
    carrier: String(input.carrier || '').trim().slice(0, 120),
    trackingNumber: String(input.trackingNumber || '').trim().slice(0, 120),
    expectedArrivalDate: input.expectedArrivalDate ? new Date(input.expectedArrivalDate) : undefined,
    dispatchDate: dispatch ? new Date() : undefined,
    notes: String(input.notes || '').trim().slice(0, 2000),
    lines,
    attachments: normalizeAttachments(input.attachments)
  });

  if (dispatch) {
    for (const l of lines) {
      const poLine = byLine.get(l.poLineId)!;
      poLine.quantityShipped = (poLine.quantityShipped || 0) + l.quantity;
    }
    await po.save();
  }

  await writeAudit({
    actor: input.user.id,
    action: dispatch ? 'supplier_shipment.dispatch' : 'supplier_shipment.create',
    entityType: 'SupplierShipment',
    entityId: shipment._id,
    shop: po.shop,
    details: { publicId: shipment.publicId, poPublicId: po.publicId }
  });

  if (dispatch) {
    await notifyUsers(
      [...(await shopAdminUserIds(String(po.shop))), ...(await shopReceivingUserIds(String(po.shop)))],
      'supplier_shipment',
      'Shipment dispatched',
      `${shipment.publicId} dispatched for ${po.publicId}`,
      { shipmentId: String(shipment._id), purchaseOrderId: String(po._id) }
    );
  }

  return serializeShipment(shipment);
}

export async function dispatchShipment(user: AuthUser, shipmentId: string) {
  const business = await requireApprovedSupplierBusiness(user.id);
  const key = String(shipmentId || '').trim();
  const shipment = await SupplierShipment.findOne({
    $or: [{ publicId: key }, ...(mongoose.isValidObjectId(key) ? [{ _id: key }] : [])],
    supplierBusiness: business._id
  });
  if (!shipment) throw new AppError('Shipment not found', 404, 'NOT_FOUND');
  if (shipment.status !== 'draft') throw new AppError('Only draft shipments can be dispatched', 409, 'INVALID_STATE');

  const po = await SupplierPurchaseOrder.findById(shipment.purchaseOrder);
  if (!po) throw new AppError('Purchase order not found', 404, 'NOT_FOUND');

  const byLine = new Map((po.lines || []).map((l) => [l.lineId, l]));
  for (const l of shipment.lines || []) {
    const poLine = byLine.get(l.poLineId);
    if (!poLine) throw new AppError(`Unknown PO line ${l.poLineId}`, 400, 'INVALID_LINE');
    const remaining = poLine.quantityOrdered - (poLine.quantityShipped || 0);
    if (l.quantity > remaining) throw new AppError('Overship detected', 409, 'OVERSHIP');
    poLine.quantityShipped = (poLine.quantityShipped || 0) + l.quantity;
  }

  shipment.status = 'dispatched';
  shipment.dispatchDate = new Date();
  await shipment.save();
  await po.save();

  await writeAudit({
    actor: user.id,
    action: 'supplier_shipment.dispatch',
    entityType: 'SupplierShipment',
    entityId: shipment._id,
    shop: shipment.shop,
    details: { publicId: shipment.publicId }
  });

  await notifyUsers(
    [...(await shopAdminUserIds(String(po.shop))), ...(await shopReceivingUserIds(String(po.shop)))],
    'supplier_shipment',
    'Shipment dispatched',
    `${shipment.publicId} dispatched for ${po.publicId}`,
    { shipmentId: String(shipment._id), purchaseOrderId: String(po._id) }
  );

  return serializeShipment(shipment);
}

export async function markShipmentDelayed(user: AuthUser, shipmentId: string, reason: string) {
  const business = await requireApprovedSupplierBusiness(user.id);
  const key = String(shipmentId || '').trim();
  const shipment = await SupplierShipment.findOne({
    $or: [{ publicId: key }, ...(mongoose.isValidObjectId(key) ? [{ _id: key }] : [])],
    supplierBusiness: business._id
  });
  if (!shipment) throw new AppError('Shipment not found', 404, 'NOT_FOUND');
  if (!['dispatched', 'in_transit', 'delayed'].includes(shipment.status)) {
    throw new AppError('Cannot mark this shipment delayed', 409, 'INVALID_STATE');
  }
  const trimmed = String(reason || '').trim();
  if (trimmed.length < 5) throw new AppError('Delay reason required', 400, 'REASON_REQUIRED');

  shipment.status = 'delayed';
  shipment.delayReason = trimmed.slice(0, 1000);
  await shipment.save();

  await writeAudit({
    actor: user.id,
    action: 'supplier_shipment.delay',
    entityType: 'SupplierShipment',
    entityId: shipment._id,
    shop: shipment.shop,
    details: { reason: trimmed }
  });

  await notifyUsers(
    await shopAdminUserIds(String(shipment.shop)),
    'supplier_shipment',
    'Shipment delayed',
    `${shipment.publicId}: ${trimmed}`,
    { shipmentId: String(shipment._id) }
  );

  return serializeShipment(shipment);
}

export async function updateShipmentArrival(
  user: AuthUser,
  shipmentId: string,
  input: { status?: 'in_transit' | 'delivered'; actualArrivalDate?: string; notes?: string }
) {
  const key = String(shipmentId || '').trim();
  const shipment = await SupplierShipment.findOne({
    $or: [{ publicId: key }, ...(mongoose.isValidObjectId(key) ? [{ _id: key }] : [])]
  });
  if (!shipment) throw new AppError('Shipment not found', 404, 'NOT_FOUND');

  if (user.role === 'supplier') {
    const business = await requireApprovedSupplierBusiness(user.id);
    if (String(shipment.supplierBusiness) !== String(business._id)) {
      throw new AppError('Shipment not found', 404, 'NOT_FOUND');
    }
  } else {
    assertShopAccess(user, String(shipment.shop));
  }

  if (input.status === 'in_transit') shipment.status = 'in_transit';
  if (input.status === 'delivered') {
    shipment.status = 'delivered';
    shipment.actualArrivalDate = input.actualArrivalDate ? new Date(input.actualArrivalDate) : new Date();
  }
  if (input.notes) shipment.notes = String(input.notes).trim().slice(0, 2000);
  await shipment.save();

  await writeAudit({
    actor: user.id,
    action: 'supplier_shipment.update',
    entityType: 'SupplierShipment',
    entityId: shipment._id,
    shop: shipment.shop,
    details: { status: shipment.status }
  });

  return serializeShipment(shipment);
}

export async function listShipmentsForPo(user: AuthUser, purchaseOrderId: string) {
  const key = String(purchaseOrderId || '').trim();
  const po = await SupplierPurchaseOrder.findOne({
    $or: [{ publicId: key }, ...(mongoose.isValidObjectId(key) ? [{ _id: key }] : [])]
  });
  if (!po) throw new AppError('Purchase order not found', 404, 'NOT_FOUND');

  if (user.role === 'supplier') {
    const business = await requireApprovedSupplierBusiness(user.id);
    if (String(po.supplierBusiness) !== String(business._id)) {
      throw new AppError('Purchase order not found', 404, 'NOT_FOUND');
    }
  } else {
    assertShopReceivingAccess(user, String(po.shop));
  }

  const rows = await SupplierShipment.find({ purchaseOrder: po._id }).sort({ createdAt: -1 });
  return rows.map(serializeShipment);
}
