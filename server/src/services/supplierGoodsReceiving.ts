import mongoose from 'mongoose';
import {
  GoodsReceipt,
  Part,
  RepairShop,
  SupplierBusiness,
  SupplierPurchaseOrder,
  SupplierShipment
} from '../models/index.js';
import { AppError } from '../utils/errors.js';
import { writeAudit } from './audit.js';
import { withMongoTransaction } from '../utils/mongoTransaction.js';
import { stockIn } from './inventory.js';
import type { AuthUser } from '../middleware/auth.js';
import {
  assertShopReceivingAccess,
  notifyUsers,
  publicRef,
  shopReceivingUserIds,
  supplierOwnerId
} from './supplierNetworkShared.js';
import { postLedgerEntry } from './supplierLedger.js';
import { refreshPurchaseOrderFulfilmentStatus } from './supplierPurchaseOrders.js';

function roundMoney(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function serializeGrn(g: InstanceType<typeof GoodsReceipt>) {
  return {
    id: String(g._id),
    publicId: g.publicId,
    purchaseOrderId: String(g.purchaseOrder),
    shipmentId: g.shipment ? String(g.shipment) : null,
    shopId: String(g.shop),
    supplierBusinessId: String(g.supplierBusiness),
    status: g.status,
    receivedBy: String(g.receivedBy),
    receivedAt: g.receivedAt || null,
    notes: g.notes || '',
    totalAcceptedValue: g.totalAcceptedValue || 0,
    lines: (g.lines || []).map((l) => ({
      poLineId: l.poLineId,
      quantityReceived: l.quantityReceived,
      quantityAccepted: l.quantityAccepted,
      quantityRejected: l.quantityRejected || 0,
      quantityDamaged: l.quantityDamaged || 0,
      quantityShort: l.quantityShort || 0,
      rejectReason: l.rejectReason || '',
      damageReason: l.damageReason || '',
      shopPartId: l.shopPart ? String(l.shopPart) : null,
      unitCost: l.unitCost || 0,
      lineValueAccepted: l.lineValueAccepted || 0
    })),
    createdAt: g.createdAt || null
  };
}

async function resolveOrCreateShopPart(input: {
  shopId: string;
  name: string;
  sku: string;
  unitCost: number;
  supplierName: string;
  session: mongoose.ClientSession;
}) {
  const sku = (input.sku || input.name).toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 40) || 'PART';
  let part = await Part.findOne({ shop: input.shopId, sku }).session(input.session);
  if (part) return part;

  // Collision-safe unique SKU within shop
  let candidate = sku;
  for (let i = 0; i < 5; i++) {
    part = await Part.findOne({ shop: input.shopId, sku: candidate }).session(input.session);
    if (!part) break;
    candidate = `${sku}-${i + 1}`.slice(0, 40);
  }

  const [created] = await Part.create(
    [
      {
        shop: input.shopId,
        sku: candidate,
        name: input.name.slice(0, 160),
        description: 'Received via supplier GRN',
        quantityAvailable: 0,
        quantityReserved: 0,
        reorderLevel: 2,
        unitCost: input.unitCost,
        supplier: input.supplierName,
        supplierSku: input.sku,
        isActive: true
      }
    ],
    { session: input.session }
  );
  return created;
}

export async function postGoodsReceipt(input: {
  user: AuthUser;
  purchaseOrderId: string;
  shipmentId?: string;
  notes?: string;
  idempotencyKey?: string;
  lines: Array<{
    poLineId: string;
    quantityAccepted: number;
    quantityRejected?: number;
    quantityDamaged?: number;
    quantityShort?: number;
    rejectReason?: string;
    damageReason?: string;
    shopPartId?: string;
  }>;
}) {
  const key = String(input.purchaseOrderId || '').trim();
  const po = await SupplierPurchaseOrder.findOne({
    $or: [{ publicId: key }, ...(mongoose.isValidObjectId(key) ? [{ _id: key }] : [])]
  });
  if (!po) throw new AppError('Purchase order not found', 404, 'NOT_FOUND');
  assertShopReceivingAccess(input.user, String(po.shop));

  if (['draft', 'cancelled', 'closed'].includes(po.status)) {
    throw new AppError('Cannot receive against this PO status', 409, 'INVALID_STATE');
  }
  if (!['issued', 'acknowledged', 'partially_fulfilled', 'fulfilled'].includes(po.status)) {
    throw new AppError('PO is not receivable', 409, 'INVALID_STATE');
  }

  if (input.idempotencyKey) {
    const existing = await GoodsReceipt.findOne({
      shop: po.shop,
      idempotencyKey: input.idempotencyKey
    });
    if (existing) return serializeGrn(existing);
  }

  let shipment: InstanceType<typeof SupplierShipment> | null = null;
  if (input.shipmentId) {
    const sKey = String(input.shipmentId).trim();
    shipment = await SupplierShipment.findOne({
      $or: [{ publicId: sKey }, ...(mongoose.isValidObjectId(sKey) ? [{ _id: sKey }] : [])],
      purchaseOrder: po._id
    });
    if (!shipment) throw new AppError('Shipment not found for this PO', 404, 'NOT_FOUND');
  }

  if (!input.lines?.length) throw new AppError('Receipt lines required', 400, 'NO_LINES');

  const supplier = await SupplierBusiness.findById(po.supplierBusiness).select('businessName');
  const supplierName = supplier?.businessName || 'Supplier';

  const result = await withMongoTransaction(async (session) => {
    if (input.idempotencyKey) {
      const again = await GoodsReceipt.findOne({
        shop: po.shop,
        idempotencyKey: input.idempotencyKey
      }).session(session);
      if (again) {
        return {
          grn: again,
          hasDamageOrShort: false,
          lockedPo: po,
          idempotentHit: true as const
        };
      }
    }

    const lockedPo = await SupplierPurchaseOrder.findById(po._id).session(session);
    if (!lockedPo) throw new AppError('Purchase order not found', 404, 'NOT_FOUND');

    const byLine = new Map((lockedPo.lines || []).map((l) => [l.lineId, l]));
    const receiptLines: Array<Record<string, unknown>> = [];
    let totalAcceptedValue = 0;
    let hasDamageOrShort = false;

    for (const lineIn of input.lines) {
      const poLine = byLine.get(lineIn.poLineId);
      if (!poLine) throw new AppError(`Unknown PO line ${lineIn.poLineId}`, 400, 'INVALID_LINE');

      const accepted = Math.max(0, Math.floor(Number(lineIn.quantityAccepted) || 0));
      const rejected = Math.max(0, Math.floor(Number(lineIn.quantityRejected) || 0));
      const damaged = Math.max(0, Math.floor(Number(lineIn.quantityDamaged) || 0));
      const short = Math.max(0, Math.floor(Number(lineIn.quantityShort) || 0));
      const received = accepted + rejected + damaged;

      if (accepted + rejected + damaged + short <= 0) {
        throw new AppError('Each line must record at least one quantity', 400, 'INVALID_QUANTITY');
      }
      if (rejected > 0 && !String(lineIn.rejectReason || '').trim()) {
        throw new AppError('Reject reason required', 400, 'REASON_REQUIRED');
      }
      if (damaged > 0 && !String(lineIn.damageReason || '').trim()) {
        throw new AppError('Damage reason required', 400, 'REASON_REQUIRED');
      }

      const remaining = poLine.quantityOrdered - (poLine.quantityReceivedAccepted || 0);
      if (accepted > remaining) {
        throw new AppError(
          `Accepted qty ${accepted} exceeds remaining ${remaining} for ${poLine.name}`,
          409,
          'OVER_RECEIVE'
        );
      }

      // Only accepted qty enters stock
      let shopPartId = lineIn.shopPartId;
      let partDoc: InstanceType<typeof Part> | null = null;
      if (accepted > 0) {
        if (shopPartId) {
          partDoc = await Part.findOne({ _id: shopPartId, shop: lockedPo.shop }).session(session);
          if (!partDoc) throw new AppError('Shop part not found', 404, 'PART_NOT_FOUND');
        } else if (poLine.shopPart) {
          partDoc = await Part.findOne({ _id: poLine.shopPart, shop: lockedPo.shop }).session(session);
        }
        if (!partDoc) {
          partDoc = await resolveOrCreateShopPart({
            shopId: String(lockedPo.shop),
            name: poLine.name,
            sku: poLine.sku || poLine.manufacturerPartNumber || poLine.lineId,
            unitCost: poLine.unitPrice,
            supplierName,
            session
          });
          poLine.shopPart = partDoc._id;
        }

        await stockIn({
          partId: String(partDoc._id),
          quantity: accepted,
          userId: input.user.id,
          notes: `GRN against ${lockedPo.publicId}`,
          referenceType: 'GoodsReceipt',
          referenceId: undefined,
          session
        });
        shopPartId = String(partDoc._id);
      }

      poLine.quantityReceivedAccepted = (poLine.quantityReceivedAccepted || 0) + accepted;
      poLine.quantityRejected = (poLine.quantityRejected || 0) + rejected;
      poLine.quantityDamaged = (poLine.quantityDamaged || 0) + damaged;

      const lineValue = roundMoney(accepted * poLine.unitPrice);
      totalAcceptedValue += lineValue;
      if (damaged > 0 || short > 0 || rejected > 0) hasDamageOrShort = true;

      receiptLines.push({
        poLineId: lineIn.poLineId,
        quantityReceived: received,
        quantityAccepted: accepted,
        quantityRejected: rejected,
        quantityDamaged: damaged,
        quantityShort: short,
        rejectReason: String(lineIn.rejectReason || '').trim().slice(0, 500),
        damageReason: String(lineIn.damageReason || '').trim().slice(0, 500),
        shopPart: shopPartId,
        unitCost: poLine.unitPrice,
        lineValueAccepted: lineValue
      });
    }

    const [grn] = await GoodsReceipt.create(
      [
        {
          publicId: publicRef('GRN', 5),
          purchaseOrder: lockedPo._id,
          shipment: shipment?._id,
          shop: lockedPo.shop,
          supplierBusiness: lockedPo.supplierBusiness,
          receivedBy: input.user.id,
          status: 'posted',
          receivedAt: new Date(),
          notes: String(input.notes || '').trim().slice(0, 2000),
          lines: receiptLines,
          totalAcceptedValue: roundMoney(totalAcceptedValue),
          idempotencyKey: input.idempotencyKey
        }
      ],
      { session }
    );

    // Patch stock_in movements with GRN reference (best-effort inside txn via notes already set)
    await refreshPurchaseOrderFulfilmentStatus(lockedPo, session);

    if (totalAcceptedValue > 0) {
      await postLedgerEntry({
        user: input.user,
        shopId: String(lockedPo.shop),
        supplierBusinessId: String(lockedPo.supplierBusiness),
        purchaseOrderId: String(lockedPo._id),
        goodsReceiptId: String(grn._id),
        kind: 'goods_received',
        amount: totalAcceptedValue,
        currency: lockedPo.currency,
        notes: `GRN ${grn.publicId}`,
        idempotencyKey: `grn-value:${grn.publicId}`,
        session
      });
    }

    await writeAudit({
      actor: input.user.id,
      action: 'supplier_grn.post',
      entityType: 'GoodsReceipt',
      entityId: grn._id,
      shop: lockedPo.shop,
      details: {
        publicId: grn.publicId,
        poPublicId: lockedPo.publicId,
        totalAcceptedValue,
        hasDamageOrShort
      },
      session
    });

    return { grn, hasDamageOrShort, lockedPo, idempotentHit: false as const };
  });

  if (!result.idempotentHit) {
    const owner = await supplierOwnerId(String(result.lockedPo.supplierBusiness));
    const receivers = await shopReceivingUserIds(String(result.lockedPo.shop));
    await notifyUsers(
      [owner, ...receivers],
      'supplier_grn',
      'Goods received',
      `${result.grn.publicId} posted for ${result.lockedPo.publicId}`,
      {
        grnId: String(result.grn._id),
        purchaseOrderId: String(result.lockedPo._id),
        hrefHint: 'purchase_order'
      }
    );
    if (result.hasDamageOrShort) {
      await notifyUsers(
        [owner, ...receivers],
        'supplier_grn',
        'Damaged / short / rejected receipt',
        `${result.grn.publicId} includes damaged, short, or rejected quantities`,
        { grnId: String(result.grn._id), hrefHint: 'purchase_order' }
      );
    }
  }

  return serializeGrn(result.grn);
}

export async function listGoodsReceipts(user: AuthUser, purchaseOrderId: string) {
  const key = String(purchaseOrderId || '').trim();
  const po = await SupplierPurchaseOrder.findOne({
    $or: [{ publicId: key }, ...(mongoose.isValidObjectId(key) ? [{ _id: key }] : [])]
  });
  if (!po) throw new AppError('Purchase order not found', 404, 'NOT_FOUND');
  assertShopReceivingAccess(user, String(po.shop));
  const rows = await GoodsReceipt.find({ purchaseOrder: po._id }).sort({ receivedAt: -1 });
  return rows.map(serializeGrn);
}

export async function getGoodsReceipt(user: AuthUser, grnId: string) {
  const key = String(grnId || '').trim();
  const grn = await GoodsReceipt.findOne({
    $or: [{ publicId: key }, ...(mongoose.isValidObjectId(key) ? [{ _id: key }] : [])]
  });
  if (!grn) throw new AppError('GRN not found', 404, 'NOT_FOUND');
  assertShopReceivingAccess(user, String(grn.shop));
  return serializeGrn(grn);
}

export async function getGoodsReceiptPrintData(user: AuthUser, grnId: string) {
  const data = await getGoodsReceipt(user, grnId);
  const grn = await GoodsReceipt.findById(data.id);
  if (!grn) throw new AppError('GRN not found', 404, 'NOT_FOUND');
  const [shop, supplier, po] = await Promise.all([
    RepairShop.findById(grn.shop).select('name address city phone'),
    SupplierBusiness.findById(grn.supplierBusiness).select('businessName'),
    SupplierPurchaseOrder.findById(grn.purchaseOrder).select('publicId')
  ]);
  return {
    ...data,
    shop: shop ? { name: shop.name, address: shop.address, city: shop.city, phone: shop.phone } : null,
    supplier: supplier ? { businessName: supplier.businessName } : null,
    purchaseOrderPublicId: po?.publicId || null
  };
}

export async function receivedVersusOrderedReport(user: AuthUser, shopId: string) {
  assertShopReceivingAccess(user, shopId);
  const pos = await SupplierPurchaseOrder.find({
    shop: shopId,
    status: { $nin: ['draft', 'cancelled'] }
  }).select('publicId lines status supplierBusiness grandTotal');

  return pos.map((po) => {
    const ordered = (po.lines || []).reduce((s, l) => s + l.quantityOrdered, 0);
    const received = (po.lines || []).reduce((s, l) => s + (l.quantityReceivedAccepted || 0), 0);
    return {
      purchaseOrderId: String(po._id),
      publicId: po.publicId,
      status: po.status,
      supplierBusinessId: String(po.supplierBusiness),
      quantityOrdered: ordered,
      quantityReceivedAccepted: received,
      fillRate: ordered ? Math.round((received / ordered) * 1000) / 10 : 0
    };
  });
}
