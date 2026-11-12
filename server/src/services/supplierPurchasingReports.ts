import mongoose from 'mongoose';
import { SupplierPurchaseOrder, SupplierShipment } from '../models/index.js';
import type { AuthUser } from '../middleware/auth.js';
import { assertShopAccess } from './supplierNetworkShared.js';
import {
  outstandingPayablesReport,
  purchasesBySupplierReport
} from './supplierLedger.js';
import { receivedVersusOrderedReport } from './supplierGoodsReceiving.js';

export async function pendingPurchaseOrdersReport(user: AuthUser, shopId: string) {
  assertShopAccess(user, shopId);
  const rows = await SupplierPurchaseOrder.find({
    shop: shopId,
    status: { $in: ['issued', 'acknowledged', 'partially_fulfilled'] }
  })
    .sort({ issuedAt: 1 })
    .limit(200)
    .select('publicId status grandTotal currency supplierBusiness expectedDeliveryDate issuedAt');
  return rows.map((po) => ({
    id: String(po._id),
    publicId: po.publicId,
    status: po.status,
    grandTotal: po.grandTotal,
    currency: po.currency,
    supplierBusinessId: String(po.supplierBusiness),
    expectedDeliveryDate: po.expectedDeliveryDate || null,
    issuedAt: po.issuedAt || null
  }));
}

export async function purchasesByDateRangeReport(
  user: AuthUser,
  shopId: string,
  from: string,
  to: string
) {
  assertShopAccess(user, shopId);
  const rows = await SupplierPurchaseOrder.find({
    shop: shopId,
    status: { $nin: ['draft', 'cancelled'] },
    issuedAt: { $gte: new Date(from), $lte: new Date(to) }
  })
    .sort({ issuedAt: -1 })
    .select('publicId status grandTotal currency supplierBusiness issuedAt');
  return {
    from,
    to,
    total: rows.reduce((s, r) => s + (r.grandTotal || 0), 0),
    count: rows.length,
    orders: rows.map((po) => ({
      id: String(po._id),
      publicId: po.publicId,
      status: po.status,
      grandTotal: po.grandTotal,
      currency: po.currency,
      supplierBusinessId: String(po.supplierBusiness),
      issuedAt: po.issuedAt
    }))
  };
}

export async function supplierFulfilmentPerformanceReport(user: AuthUser, shopId: string) {
  assertShopAccess(user, shopId);
  const pos = await SupplierPurchaseOrder.find({
    shop: shopId,
    status: { $nin: ['draft', 'cancelled'] }
  }).select('supplierBusiness lines status issuedAt fulfilledAt closedAt updatedAt');

  const bySupplier = new Map<
    string,
    { poCount: number; onTimeShipments: number; delayedShipments: number; fillRateSum: number }
  >();

  for (const po of pos) {
    const sid = String(po.supplierBusiness);
    const entry = bySupplier.get(sid) || {
      poCount: 0,
      onTimeShipments: 0,
      delayedShipments: 0,
      fillRateSum: 0
    };
    entry.poCount += 1;
    const ordered = (po.lines || []).reduce((s, l) => s + l.quantityOrdered, 0);
    const received = (po.lines || []).reduce((s, l) => s + (l.quantityReceivedAccepted || 0), 0);
    entry.fillRateSum += ordered ? received / ordered : 0;
    bySupplier.set(sid, entry);
  }

  const delayed = await SupplierShipment.aggregate([
    { $match: { shop: new mongoose.Types.ObjectId(shopId), status: 'delayed' } },
    { $group: { _id: '$supplierBusiness', count: { $sum: 1 } } }
  ]);
  const delayedMap = new Map(delayed.map((d) => [String(d._id), d.count as number]));

  return [...bySupplier.entries()].map(([supplierBusinessId, v]) => ({
    supplierBusinessId,
    poCount: v.poCount,
    averageFillRate: v.poCount ? Math.round((v.fillRateSum / v.poCount) * 1000) / 10 : 0,
    delayedShipments: delayedMap.get(supplierBusinessId) || 0
  }));
}

export async function purchasingReportsBundle(
  user: AuthUser,
  shopId: string,
  opts?: { from?: string; to?: string }
) {
  assertShopAccess(user, shopId);
  const [bySupplier, pending, payables, receivedVsOrdered, fulfilment] = await Promise.all([
    purchasesBySupplierReport(user, shopId, opts?.from, opts?.to),
    pendingPurchaseOrdersReport(user, shopId),
    outstandingPayablesReport(user, shopId),
    receivedVersusOrderedReport(user, shopId),
    supplierFulfilmentPerformanceReport(user, shopId)
  ]);
  const byDate =
    opts?.from && opts?.to
      ? await purchasesByDateRangeReport(user, shopId, opts.from, opts.to)
      : null;
  return {
    purchasesBySupplier: bySupplier,
    purchasesByDateRange: byDate,
    pendingPurchaseOrders: pending,
    outstandingPayables: payables,
    goodsReceivedVersusOrdered: receivedVsOrdered,
    supplierFulfilmentPerformance: fulfilment
  };
}
