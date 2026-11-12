import mongoose from 'mongoose';
import {
  GoodsReceipt,
  SupplierBusiness,
  SupplierCatalogItem,
  SupplierPurchaseOrder,
  SupplierQuotation,
  SupplierRfq,
  SupplierShipment,
  SupplierLedgerEntry
} from '../models/index.js';
import { AppError } from '../utils/errors.js';
import type { AuthUser } from '../middleware/auth.js';
import {
  assertShopAccess,
  requireApprovedSupplierBusiness
} from './supplierNetworkShared.js';
import { computeSupplierPerformance } from './supplierPerformance.js';
import { outstandingPayablesReport } from './supplierLedger.js';
import { monthKeyUtc, parseAnalyticsDateRange, rowsToCsv } from '../utils/csvExport.js';
import { metricOrInsufficient, SUPPLIER_PERFORMANCE_MIN_SAMPLES } from '../constants/supplierPerformance.js';

/**
 * Phase 5B purchasing analytics — server-side aggregations only.
 *
 * Money definitions (shop scope):
 * - orderedValue: Σ PO.grandTotal for non-draft, non-cancelled POs with issuedAt in range
 * - receivedValue: Σ GRN.totalAcceptedValue for status=posted GRNs with receivedAt in range
 * - outstandingPayables: AP from goods_received/invoices/payments/credits (excludes po_obligation memos;
 *   reversed originals + reversal rows both included so pairs net to zero)
 * - cashPayments / paidValue (period): Σ abs(amount) for posted payment ledger entries only
 * - creditNotes (period): Σ abs(amount) for posted credit_note entries — never classified as cash
 * Cancelled POs are excluded from ordered totals. Reversed ledger rows (status=reversed) are excluded.
 * Partial receipts reduce receivedValue naturally via GRN accepted lines only.
 */

export type PurchasingAnalyticsFilters = {
  shopId: string;
  from?: string;
  to?: string;
  supplierBusinessId?: string;
  status?: string;
  /** Product name/sku substring */
  productQ?: string;
  category?: string;
};

function money(n: number) {
  return Math.round(n * 100) / 100;
}

function resolveShopId(user: AuthUser, requested?: string) {
  const shopId = String(requested || user.shopIds[0] || '');
  if (!shopId) throw new AppError('shopId required', 400, 'SHOP_REQUIRED');
  assertShopAccess(user, shopId);
  // Never trust a shopId outside the caller's memberships
  if (!user.shopIds.includes(shopId)) {
    throw new AppError('Access denied for this shop', 403, 'SHOP_FORBIDDEN');
  }
  return shopId;
}

async function catalogIdsForCategory(category: string, supplierBusinessId?: string) {
  const filter: Record<string, unknown> = { category };
  if (supplierBusinessId) filter.supplierBusiness = supplierBusinessId;
  const items = await SupplierCatalogItem.find(filter).select('_id').limit(2000);
  return items.map((i) => i._id);
}

async function buildPoMatch(filters: PurchasingAnalyticsFilters) {
  const shopOid = new mongoose.Types.ObjectId(filters.shopId);
  const { fromDate, toDate } = parseAnalyticsDateRange(filters.from, filters.to);
  const match: Record<string, unknown> = {
    shop: shopOid,
    status: { $nin: ['draft'] }
  };
  if (filters.status) {
    match.status = filters.status;
  } else {
    // Default analytics exclude cancelled from value totals; status filter can include them
    match.status = { $nin: ['draft', 'cancelled'] };
  }
  if (filters.supplierBusinessId) {
    match.supplierBusiness = new mongoose.Types.ObjectId(filters.supplierBusinessId);
  }
  if (fromDate || toDate) {
    match.issuedAt = {};
    if (fromDate) (match.issuedAt as Record<string, Date>).$gte = fromDate;
    if (toDate) (match.issuedAt as Record<string, Date>).$lte = toDate;
  }
  if (filters.productQ) {
    const q = filters.productQ.trim();
    match.$or = [
      { 'lines.name': { $regex: q, $options: 'i' } },
      { 'lines.sku': { $regex: q, $options: 'i' } }
    ];
  }
  if (filters.category) {
    const ids = await catalogIdsForCategory(filters.category, filters.supplierBusinessId);
    match['lines.catalogItem'] = { $in: ids };
  }
  return { match, fromDate, toDate };
}

export async function shopPurchasingAnalytics(user: AuthUser, filters: PurchasingAnalyticsFilters) {
  if (user.role !== 'shop_admin') {
    throw new AppError('Only shop admins can view purchasing analytics', 403, 'FORBIDDEN');
  }
  const shopId = resolveShopId(user, filters.shopId);
  const { match, fromDate, toDate } = await buildPoMatch({ ...filters, shopId });

  const [
    poAgg,
    qtyAgg,
    monthlyAgg,
    bySupplierAgg,
    topProductsAgg,
    grnAgg,
    payables,
    pendingPos,
    overdueShipments,
    expenditure
  ] = await Promise.all([
    SupplierPurchaseOrder.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalPurchasingValue: { $sum: '$grandTotal' },
          totalPurchaseOrders: { $sum: 1 }
        }
      }
    ]),
    SupplierPurchaseOrder.aggregate([
      { $match: match },
      { $unwind: '$lines' },
      {
        $group: {
          _id: null,
          orderedQty: { $sum: '$lines.quantityOrdered' },
          receivedQty: { $sum: '$lines.quantityReceivedAccepted' }
        }
      }
    ]),
    SupplierPurchaseOrder.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            y: { $year: { date: '$issuedAt', timezone: 'UTC' } },
            m: { $month: { date: '$issuedAt', timezone: 'UTC' } }
          },
          value: { $sum: '$grandTotal' },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.y': 1, '_id.m': 1 } }
    ]),
    SupplierPurchaseOrder.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$supplierBusiness',
          purchasingValue: { $sum: '$grandTotal' },
          poCount: { $sum: 1 }
        }
      },
      { $sort: { purchasingValue: -1 } },
      { $limit: 50 }
    ]),
    SupplierPurchaseOrder.aggregate([
      { $match: match },
      { $unwind: '$lines' },
      {
        $group: {
          _id: {
            name: '$lines.name',
            sku: '$lines.sku'
          },
          orderedQty: { $sum: '$lines.quantityOrdered' },
          receivedQty: { $sum: '$lines.quantityReceivedAccepted' },
          orderedValue: { $sum: '$lines.lineSubtotal' }
        }
      },
      { $sort: { orderedValue: -1 } },
      { $limit: 25 }
    ]),
    GoodsReceipt.aggregate([
      {
        $match: {
          shop: new mongoose.Types.ObjectId(shopId),
          status: 'posted',
          ...(filters.supplierBusinessId
            ? { supplierBusiness: new mongoose.Types.ObjectId(filters.supplierBusinessId) }
            : {}),
          ...(fromDate || toDate
            ? {
                receivedAt: {
                  ...(fromDate ? { $gte: fromDate } : {}),
                  ...(toDate ? { $lte: toDate } : {})
                }
              }
            : {})
        }
      },
      { $group: { _id: null, goodsReceivedValue: { $sum: '$totalAcceptedValue' }, grnCount: { $sum: 1 } } }
    ]),
    outstandingPayablesReport(user, shopId),
    SupplierPurchaseOrder.countDocuments({
      shop: shopId,
      status: { $in: ['issued', 'acknowledged', 'partially_fulfilled'] },
      ...(filters.supplierBusinessId
        ? { supplierBusiness: filters.supplierBusinessId }
        : {})
    }),
    SupplierShipment.aggregate([
      {
        $match: {
          shop: new mongoose.Types.ObjectId(shopId),
          status: { $in: ['dispatched', 'in_transit', 'delayed'] },
          expectedArrivalDate: { $lt: new Date() },
          actualArrivalDate: { $exists: false },
          ...(filters.supplierBusinessId
            ? { supplierBusiness: new mongoose.Types.ObjectId(filters.supplierBusinessId) }
            : {})
        }
      },
      { $count: 'n' }
    ]),
    SupplierLedgerEntry.aggregate([
      {
        $match: {
          shop: new mongoose.Types.ObjectId(shopId),
          status: 'posted',
          entryType: { $in: ['posting', 'reversal'] },
          kind: { $in: ['payment', 'credit_note'] },
          ...(filters.supplierBusinessId
            ? { supplierBusiness: new mongoose.Types.ObjectId(filters.supplierBusinessId) }
            : {}),
          ...(fromDate || toDate
            ? {
                createdAt: {
                  ...(fromDate ? { $gte: fromDate } : {}),
                  ...(toDate ? { $lte: toDate } : {})
                }
              }
            : {})
        }
      },
      {
        $group: {
          _id: '$kind',
          total: { $sum: { $abs: '$amount' } }
        }
      }
    ])
  ]);

  const supplierIds = bySupplierAgg.map((r) => r._id as mongoose.Types.ObjectId);
  const businesses = await SupplierBusiness.find({ _id: { $in: supplierIds } }).select(
    'publicId businessName city verified'
  );
  const bizMap = new Map(businesses.map((b) => [String(b._id), b]));

  // Reuse Phase 5A performance formulas per supplier (shop relationship comparison)
  const performanceRows = await Promise.all(
    supplierIds.slice(0, 20).map(async (id) => {
      const perf = await computeSupplierPerformance(id);
      const biz = bizMap.get(String(id));
      return {
        supplierBusinessId: String(id),
        publicId: biz?.publicId || null,
        businessName: biz?.businessName || 'Unknown',
        verified: Boolean(biz?.verified),
        fulfilmentRate: perf.fulfilmentRate,
        onTimeDelivery: perf.onTimeDelivery,
        pendingOverdue: perf.pendingOverdue,
        quotationResponseTime: perf.quotationResponseTime,
        verifiedReviews: {
          overallAverage: perf.verifiedReviews.overallAverage,
          sampleCount: perf.verifiedReviews.sampleCount,
          enoughData: perf.verifiedReviews.enoughData,
          label: perf.verifiedReviews.label
        }
      };
    })
  );

  const avgFillEnough = performanceRows.filter((r) => r.fulfilmentRate.enoughData);
  const avgOnTimeEnough = performanceRows.filter((r) => r.onTimeDelivery.enoughData);
  const avgFill =
    avgFillEnough.length > 0
      ? avgFillEnough.reduce((s, r) => s + Number(r.fulfilmentRate.value), 0) / avgFillEnough.length
      : null;
  const avgOnTime =
    avgOnTimeEnough.length > 0
      ? avgOnTimeEnough.reduce((s, r) => s + Number(r.onTimeDelivery.value), 0) /
        avgOnTimeEnough.length
      : null;

  const payableFiltered = filters.supplierBusinessId
    ? payables.filter((p) => p.supplierBusinessId === filters.supplierBusinessId)
    : payables;
  const outstandingTotal = payableFiltered.reduce((s, p) => s + p.outstandingPayable, 0);

  const cashPaymentsInPeriod = money(
    expenditure.find((r) => r._id === 'payment')?.total || 0
  );
  const creditNotesInPeriod = money(
    expenditure.find((r) => r._id === 'credit_note')?.total || 0
  );

  const kpis = {
    totalPurchasingValue: money(poAgg[0]?.totalPurchasingValue || 0),
    totalPurchaseOrders: poAgg[0]?.totalPurchaseOrders || 0,
    goodsReceivedValue: money(grnAgg[0]?.goodsReceivedValue || 0),
    goodsReceiptCount: grnAgg[0]?.grnCount || 0,
    outstandingSupplierPayables: money(outstandingTotal),
    /** Cash/digital payments only — credit notes are NOT included. */
    paidValueInPeriod: cashPaymentsInPeriod,
    cashPaymentsInPeriod,
    creditNotesInPeriod,
    pendingPurchaseOrders: pendingPos,
    pendingOverdueShipments: overdueShipments[0]?.n || 0,
    orderedQuantity: qtyAgg[0]?.orderedQty || 0,
    receivedQuantity: qtyAgg[0]?.receivedQty || 0,
    averageSupplierFulfilmentRate: metricOrInsufficient(
      avgFill !== null ? money(avgFill) : null,
      avgFillEnough.length,
      1,
      (v) => `${v}%`
    ),
    averageSupplierOnTimeRate: metricOrInsufficient(
      avgOnTime !== null ? money(avgOnTime) : null,
      avgOnTimeEnough.length,
      1,
      (v) => `${v}%`
    )
  };

  return {
    definitions: {
      orderedValue:
        'Sum of PO grandTotal for non-draft, non-cancelled purchase orders with issuedAt in the selected range (unless status filter overrides).',
      receivedValue:
        'Sum of posted GRN totalAcceptedValue with receivedAt in range. Reflects accepted quantities only; rejects/damaged excluded from value.',
      outstandingPayables:
        'Current AP from goods_received + invoices − payments − credit notes (po_obligation commitments excluded). Reversal pairs net to zero. Not period-scoped.',
      paidValue:
        'Absolute sum of posted payment ledger amounts in the selected range (cash/digital). Credit notes are excluded.',
      cashPayments:
        'Same as paidValue — actual supplier payments only.',
      creditNotes:
        'Absolute sum of posted credit_note ledger amounts in range. Reduces payable but is never classified as a cash payment.',
      cancelledOrders: 'Excluded from default purchasing totals. Include via status=cancelled filter when investigating.',
      performance:
        'Fulfilment and on-time rates reuse Phase 5A computeSupplierPerformance (no duplicate formulas).'
    },
    filters: {
      shopId,
      from: filters.from || null,
      to: filters.to || null,
      supplierBusinessId: filters.supplierBusinessId || null,
      status: filters.status || null,
      productQ: filters.productQ || null,
      category: filters.category || null,
      dateBoundsUtc: {
        from: fromDate?.toISOString() || null,
        to: toDate?.toISOString() || null
      }
    },
    kpis,
    monthlyPurchasingTrends: monthlyAgg.map((r) => ({
      month: `${r._id.y}-${String(r._id.m).padStart(2, '0')}`,
      value: money(r.value),
      orderCount: r.count
    })),
    supplierComparison: bySupplierAgg.map((r) => {
      const biz = bizMap.get(String(r._id));
      const perf = performanceRows.find((p) => p.supplierBusinessId === String(r._id));
      return {
        supplierBusinessId: String(r._id),
        publicId: biz?.publicId || null,
        businessName: biz?.businessName || 'Unknown',
        verified: Boolean(biz?.verified),
        city: biz?.city || null,
        purchasingValue: money(r.purchasingValue),
        poCount: r.poCount,
        fulfilmentRate: perf?.fulfilmentRate || null,
        onTimeDelivery: perf?.onTimeDelivery || null,
        verifiedReviews: perf?.verifiedReviews || null
      };
    }),
    orderedVersusReceived: {
      orderedQuantity: qtyAgg[0]?.orderedQty || 0,
      receivedQuantity: qtyAgg[0]?.receivedQty || 0,
      fillRatio:
        qtyAgg[0]?.orderedQty > 0
          ? money(((qtyAgg[0]?.receivedQty || 0) / qtyAgg[0].orderedQty) * 100)
          : null
    },
    expenditureBreakdown: {
      orderedValue: money(poAgg[0]?.totalPurchasingValue || 0),
      receivedValue: money(grnAgg[0]?.goodsReceivedValue || 0),
      paidValue: cashPaymentsInPeriod,
      cashPayments: cashPaymentsInPeriod,
      creditNotes: creditNotesInPeriod,
      outstandingPayables: money(outstandingTotal)
    },
    topPurchasedProducts: topProductsAgg.map((r) => ({
      name: r._id.name,
      sku: r._id.sku || '',
      orderedQty: r.orderedQty,
      receivedQty: r.receivedQty,
      orderedValue: money(r.orderedValue)
    })),
    supplierPerformanceComparison: performanceRows,
    outstandingPayablesBySupplier: payableFiltered,
    thresholds: SUPPLIER_PERFORMANCE_MIN_SAMPLES
  };
}

export type AnalyticsExportKind =
  | 'supplier_purchasing'
  | 'purchase_order_summary'
  | 'goods_receiving'
  | 'supplier_payables'
  | 'supplier_performance'
  | 'product_purchasing_history';

export async function exportShopPurchasingAnalyticsCsv(
  user: AuthUser,
  kind: AnalyticsExportKind,
  filters: PurchasingAnalyticsFilters
) {
  const data = await shopPurchasingAnalytics(user, filters);
  let rows: Record<string, unknown>[] = [];

  switch (kind) {
    case 'supplier_purchasing':
      rows = data.supplierComparison.map((r) => ({
        supplier: r.businessName,
        publicId: r.publicId,
        verified: r.verified,
        purchasingValue: r.purchasingValue,
        poCount: r.poCount,
        fulfilmentLabel: r.fulfilmentRate?.label ?? '',
        fulfilmentSamples: r.fulfilmentRate?.sampleCount ?? 0,
        onTimeLabel: r.onTimeDelivery?.label ?? '',
        onTimeSamples: r.onTimeDelivery?.sampleCount ?? 0
      }));
      break;
    case 'purchase_order_summary': {
      const { match } = await buildPoMatch({ ...filters, shopId: data.filters.shopId });
      const pos = await SupplierPurchaseOrder.find(match)
        .sort({ issuedAt: -1 })
        .limit(2000)
        .select('publicId status grandTotal currency supplierBusiness issuedAt');
      const ids = [...new Set(pos.map((p) => String(p.supplierBusiness)))];
      const biz = await SupplierBusiness.find({ _id: { $in: ids } }).select('businessName');
      const names = new Map(biz.map((b) => [String(b._id), b.businessName]));
      rows = pos.map((p) => ({
        po: p.publicId,
        status: p.status,
        grandTotal: p.grandTotal,
        currency: p.currency,
        supplier: names.get(String(p.supplierBusiness)) || '',
        issuedAt: p.issuedAt?.toISOString() || ''
      }));
      break;
    }
    case 'goods_receiving': {
      const { fromDate, toDate } = parseAnalyticsDateRange(filters.from, filters.to);
      const grns = await GoodsReceipt.find({
        shop: data.filters.shopId,
        status: 'posted',
        ...(filters.supplierBusinessId ? { supplierBusiness: filters.supplierBusinessId } : {}),
        ...(fromDate || toDate
          ? {
              receivedAt: {
                ...(fromDate ? { $gte: fromDate } : {}),
                ...(toDate ? { $lte: toDate } : {})
              }
            }
          : {})
      })
        .sort({ receivedAt: -1 })
        .limit(2000)
        .select('publicId totalAcceptedValue receivedAt purchaseOrder supplierBusiness status');
      rows = grns.map((g) => ({
        grn: g.publicId,
        totalAcceptedValue: g.totalAcceptedValue,
        receivedAt: g.receivedAt?.toISOString() || '',
        status: g.status,
        supplierBusinessId: String(g.supplierBusiness),
        purchaseOrderId: String(g.purchaseOrder)
      }));
      break;
    }
    case 'supplier_payables':
      rows = data.outstandingPayablesBySupplier.map((p) => ({
        supplierBusinessId: p.supplierBusinessId,
        outstandingPayable: p.outstandingPayable,
        currency: p.currency
      }));
      break;
    case 'supplier_performance':
      rows = data.supplierPerformanceComparison.map((r) => ({
        supplier: r.businessName,
        verified: r.verified,
        fulfilment: r.fulfilmentRate.label,
        fulfilmentSamples: r.fulfilmentRate.sampleCount,
        onTime: r.onTimeDelivery.label,
        onTimeSamples: r.onTimeDelivery.sampleCount,
        pendingOverdue: r.pendingOverdue.count,
        quoteResponse: r.quotationResponseTime.label,
        reviews: r.verifiedReviews.label
      }));
      break;
    case 'product_purchasing_history':
      rows = data.topPurchasedProducts.map((p) => ({
        name: p.name,
        sku: p.sku,
        orderedQty: p.orderedQty,
        receivedQty: p.receivedQty,
        orderedValue: p.orderedValue
      }));
      break;
    default:
      throw new AppError('Unknown export kind', 400, 'INVALID_EXPORT');
  }

  return {
    filename: `repairconnect-${kind}-${data.filters.shopId}.csv`,
    csv: rowsToCsv(rows),
    rowCount: rows.length
  };
}

/** Supplier-scoped business analytics — never exposes other shops' private financials. */
export async function supplierBusinessAnalytics(user: AuthUser, opts?: { from?: string; to?: string }) {
  const business = await requireApprovedSupplierBusiness(user.id);
  const { fromDate, toDate } = parseAnalyticsDateRange(opts?.from, opts?.to);
  const issuedMatch: Record<string, unknown> = {
    supplierBusiness: business._id,
    status: { $nin: ['draft'] }
  };
  if (fromDate || toDate) {
    issuedMatch.issuedAt = {
      ...(fromDate ? { $gte: fromDate } : {}),
      ...(toDate ? { $lte: toDate } : {})
    };
  }

  const performance = await computeSupplierPerformance(business._id);

  const [poStats, quoteStats, rfqCount, monthly, topCatalog] = await Promise.all([
    SupplierPurchaseOrder.aggregate([
      { $match: issuedMatch },
      {
        $group: {
          _id: null,
          totalReceivedPos: { $sum: 1 },
          totalOrderValue: { $sum: '$grandTotal' },
          fulfilled: {
            $sum: { $cond: [{ $in: ['$status', ['fulfilled', 'closed']] }, 1, 0] }
          }
        }
      }
    ]),
    SupplierQuotation.aggregate([
      {
        $match: {
          supplierBusiness: business._id,
          status: { $ne: 'draft' },
          ...(fromDate || toDate
            ? {
                submittedAt: {
                  ...(fromDate ? { $gte: fromDate } : {}),
                  ...(toDate ? { $lte: toDate } : {})
                }
              }
            : {})
        }
      },
      {
        $group: {
          _id: null,
          quoted: { $sum: 1 },
          accepted: { $sum: { $cond: [{ $eq: ['$status', 'accepted'] }, 1, 0] } }
        }
      }
    ]),
    SupplierRfq.countDocuments({
      supplierBusinesses: business._id,
      sentAt: { $exists: true, $ne: null },
      status: { $nin: ['draft', 'cancelled'] }
    }),
    SupplierPurchaseOrder.aggregate([
      { $match: { ...issuedMatch, status: { $nin: ['draft', 'cancelled'] } } },
      {
        $group: {
          _id: {
            y: { $year: { date: '$issuedAt', timezone: 'UTC' } },
            m: { $month: { date: '$issuedAt', timezone: 'UTC' } }
          },
          orders: { $sum: 1 },
          salesValue: { $sum: '$grandTotal' }
        }
      },
      { $sort: { '_id.y': 1, '_id.m': 1 } }
    ]),
    SupplierPurchaseOrder.aggregate([
      { $match: { ...issuedMatch, status: { $nin: ['draft', 'cancelled'] } } },
      { $unwind: '$lines' },
      {
        $group: {
          _id: {
            catalogItem: '$lines.catalogItem',
            name: '$lines.name',
            sku: '$lines.sku'
          },
          qty: { $sum: '$lines.quantityOrdered' },
          value: { $sum: '$lines.lineSubtotal' }
        }
      },
      { $sort: { qty: -1 } },
      { $limit: 15 }
    ])
  ]);

  const quoted = quoteStats[0]?.quoted || 0;
  const accepted = quoteStats[0]?.accepted || 0;
  const acceptanceRate =
    quoted > 0 ? money((accepted / quoted) * 100) : null;

  return {
    supplierBusinessId: String(business._id),
    publicId: business.publicId,
    businessName: business.businessName,
    verified: Boolean(business.verified),
    definitions: {
      ...performance.definitions,
      orderValue:
        'Sum of PO grandTotal issued to this supplier (shop identity redacted). Does not expose shop names or ledger balances.',
      quotationAcceptanceRate: 'Accepted quotations ÷ non-draft quotations in range.'
    },
    performance,
    kpis: {
      totalReceivedPurchaseOrders: poStats[0]?.totalReceivedPos || 0,
      totalOrderValue: money(poStats[0]?.totalOrderValue || 0),
      totalQuotedRfqs: quoted,
      rfqsAddressed: rfqCount,
      quotationAcceptanceRate: metricOrInsufficient(
        acceptanceRate,
        quoted,
        SUPPLIER_PERFORMANCE_MIN_SAMPLES.quotationResponse,
        (v) => `${v}%`
      ),
      quotationResponseTime: performance.quotationResponseTime,
      totalFulfilledOrders: poStats[0]?.fulfilled || 0,
      fulfilmentRate: performance.fulfilmentRate,
      onTimeDelivery: performance.onTimeDelivery,
      pendingOverdueShipments: performance.pendingOverdue,
      verifiedReviews: performance.verifiedReviews
    },
    monthlyOrderTrends: monthly.map((r) => ({
      month: `${r._id.y}-${String(r._id.m).padStart(2, '0')}`,
      orders: r.orders,
      salesValue: money(r.salesValue)
    })),
    topSellingCatalogProducts: topCatalog.map((r) => ({
      name: r._id.name,
      sku: r._id.sku || '',
      catalogItemId: r._id.catalogItem ? String(r._id.catalogItem) : null,
      orderedQty: r.qty,
      orderedValue: money(r.value)
    })),
    dateBoundsUtc: {
      from: fromDate?.toISOString() || null,
      to: toDate?.toISOString() || null
    }
  };
}

/** Transparent supplier comparison for marketplace — no composite AI score. */
export async function compareMarketplaceSuppliers(
  user: AuthUser,
  supplierIds: string[],
  shopId?: string
) {
  if (user.role !== 'shop_admin') {
    throw new AppError('Only shop admins can compare suppliers', 403, 'FORBIDDEN');
  }
  const ids = [...new Set(supplierIds.map((s) => String(s).trim()).filter(Boolean))].slice(0, 5);
  if (ids.length < 2) {
    throw new AppError('Provide 2–5 supplier ids to compare', 400, 'COMPARE_MIN');
  }

  const resolvedShop = shopId ? resolveShopId(user, shopId) : resolveShopId(user, user.shopIds[0]);

  const businesses = await SupplierBusiness.find({
    $or: [
      { publicId: { $in: ids } },
      ...(ids.filter((id) => mongoose.isValidObjectId(id)).map((id) => ({ _id: id })) as object[])
    ],
    status: 'approved',
    isActive: true
  }).limit(5);

  if (businesses.length < 2) {
    throw new AppError('At least two approved suppliers required', 404, 'NOT_FOUND');
  }

  const items = await Promise.all(
    businesses.map(async (biz) => {
      const perf = await computeSupplierPerformance(biz._id);
      const spend = await SupplierPurchaseOrder.aggregate([
        {
          $match: {
            shop: new mongoose.Types.ObjectId(resolvedShop),
            supplierBusiness: biz._id,
            status: { $nin: ['draft', 'cancelled'] }
          }
        },
        {
          $group: {
            _id: null,
            historicalPurchasingValue: { $sum: '$grandTotal' },
            poCount: { $sum: 1 }
          }
        }
      ]);
      const catalog = await SupplierCatalogItem.find({
        supplierBusiness: biz._id,
        isActive: true,
        isArchived: { $ne: true },
        stockStatus: { $ne: 'discontinued' }
      })
        .sort({ updatedAt: -1 })
        .limit(8)
        .select('name sku category brand unitPrice currency stockStatus minOrderQuantity leadTimeDays');

      return {
        id: String(biz._id),
        publicId: biz.publicId,
        businessName: biz.businessName,
        verified: Boolean(biz.verified),
        city: biz.city,
        deliveryCities: biz.deliveryCities || [],
        partCategories: biz.partCategories || [],
        reviewSummary: {
          label: perf.verifiedReviews.label,
          enoughData: perf.verifiedReviews.enoughData,
          count: perf.verifiedReviews.sampleCount,
          overallAverage: perf.verifiedReviews.overallAverage,
          categoryAverages: perf.verifiedReviews.categoryAverages
        },
        fulfilmentPerformance: perf.fulfilmentRate,
        onTimeDeliveryPerformance: perf.onTimeDelivery,
        pendingOverdueShipments: perf.pendingOverdue,
        quotationResponseTime: perf.quotationResponseTime,
        historicalPurchasingRelationship: {
          shopId: resolvedShop,
          purchasingValue: money(spend[0]?.historicalPurchasingValue || 0),
          poCount: spend[0]?.poCount || 0
        },
        productAvailability: catalog.map((c) => ({
          name: c.name,
          sku: c.sku,
          category: c.category,
          brand: c.brand,
          unitPrice: c.unitPrice,
          currency: c.currency,
          stockStatus: c.stockStatus,
          minOrderQuantity: c.minOrderQuantity,
          leadTimeDays: c.leadTimeDays
        }))
      };
    })
  );

  return {
    note: 'Comparison uses transparent Phase 5A metrics only — no composite ranking score.',
    shopId: resolvedShop,
    items
  };
}

export { monthKeyUtc };
