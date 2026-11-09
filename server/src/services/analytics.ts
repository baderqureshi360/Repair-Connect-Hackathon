import {
  Appointment,
  AuditLog,
  InventoryMovement,
  Part,
  PartsRequest,
  PaymentRecord,
  RepairRequest,
  StockTransfer
} from '../models/index.js';
import type { AuthUser } from '../middleware/auth.js';
import { AppError } from '../utils/errors.js';
import { assertShopAccess, repairStatsMatch, toObjectId } from './access.js';

export type AnalyticsRange = '1d' | '7d' | '30d' | '90d' | 'custom';

export function resolveDateRange(input: {
  range?: AnalyticsRange;
  from?: string;
  to?: string;
}) {
  const to = input.to ? new Date(input.to) : new Date();
  let from: Date;
  if (input.range === 'custom') {
    if (!input.from) throw new AppError('from is required for custom range', 400, 'VALIDATION');
    from = new Date(input.from);
  } else if (input.range === '1d') {
    from = new Date(to);
    from.setHours(0, 0, 0, 0);
  } else {
    const days = input.range === '7d' ? 7 : input.range === '90d' ? 90 : 30;
    from = new Date(to.getTime() - days * 86400000);
  }
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    throw new AppError('Invalid date range', 400, 'VALIDATION');
  }
  return { from, to };
}

function previousEquivalentRange(range: { from: Date; to: Date }) {
  const span = Math.max(range.to.getTime() - range.from.getTime(), 86400000);
  const to = new Date(range.from.getTime());
  const from = new Date(range.from.getTime() - span);
  return { from, to };
}

/** Percentage change only when the previous period has a non-zero baseline. */
export function trendPct(current: number, previous: number): number | null {
  if (!previous || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function shopObjectIds(user: AuthUser, shopId?: string) {
  if (shopId) {
    assertShopAccess(user, shopId);
    return [toObjectId(shopId)];
  }
  return user.shopIds.map((id) => toObjectId(id));
}

export async function customerAnalytics(user: AuthUser, range: { from: Date; to: Date }) {
  const customerId = toObjectId(user.id);
  const match = {
    customer: customerId,
    createdAt: { $gte: range.from, $lte: range.to }
  };
  const [
    byStatus,
    timeline,
    completedValueByMonth,
    paymentsByMonth,
    completedWithCost,
    paymentsByRepair,
    upcomingAppointments,
    warranty
  ] = await Promise.all([
    RepairRequest.aggregate([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]),
    RepairRequest.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]),
    // Completed Repair Value — completed finalCost only
    RepairRequest.aggregate([
      {
        $match: {
          customer: customerId,
          status: 'completed',
          completedAt: { $gte: range.from, $lte: range.to },
          finalCost: { $ne: null }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$completedAt' } },
          total: { $sum: '$finalCost' },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]),
    // Actual Customer Spending — net PaymentRecord totals (payments − reversals)
    PaymentRecord.aggregate([
      {
        $match: {
          customer: customerId,
          paidAt: { $gte: range.from, $lte: range.to }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$paidAt' } },
          total: {
            $sum: {
              $cond: [
                { $eq: ['$entryType', 'reversal'] },
                { $multiply: ['$amount', -1] },
                '$amount'
              ]
            }
          },
          count: {
            $sum: { $cond: [{ $eq: ['$entryType', 'payment'] }, 1, 0] }
          }
        }
      },
      { $sort: { _id: 1 } }
    ]),
    RepairRequest.find({
      customer: customerId,
      status: 'completed',
      finalCost: { $ne: null }
    }).select('_id finalCost'),
    PaymentRecord.aggregate([
      { $match: { customer: customerId } },
      {
        $group: {
          _id: '$repairRequest',
          paid: {
            $sum: {
              $cond: [
                { $eq: ['$entryType', 'reversal'] },
                { $multiply: ['$amount', -1] },
                '$amount'
              ]
            }
          }
        }
      }
    ]),
    Appointment.countDocuments({
      customer: user.id,
      status: 'booked',
      startsAt: { $gte: new Date() }
    }),
    RepairRequest.find({
      customer: user.id,
      status: 'completed',
      warrantyExpiresAt: { $gte: new Date() }
    })
      .select('referenceNumber warrantyExpiresAt brand model finalCost')
      .limit(20)
  ]);

  const paidMap = new Map(paymentsByRepair.map((r) => [String(r._id), r.paid || 0]));
  const outstandingBalance = completedWithCost.reduce((sum, repair) => {
    const finalCost = Number(repair.finalCost) || 0;
    const paid = paidMap.get(String(repair._id)) || 0;
    return sum + Math.max(0, Math.round((finalCost - paid) * 100) / 100);
  }, 0);

  const completedRepairValue = completedValueByMonth.reduce((s, r) => s + (r.total || 0), 0);
  const actualCustomerSpending = paymentsByMonth.reduce((s, r) => s + (r.total || 0), 0);

  const statusMap = Object.fromEntries(byStatus.map((r) => [r._id, r.count]));
  const total = byStatus.reduce((s, r) => s + r.count, 0);
  return {
    summary: {
      total,
      active: total - (statusMap.completed || 0) - (statusMap.cancelled || 0),
      completed: statusMap.completed || 0,
      pendingApprovals: statusMap.estimate_pending || 0,
      upcomingAppointments,
      completedRepairValue,
      actualCustomerSpending,
      outstandingBalance,
      // Backward-compatible alias (Completed Repair Value)
      recordedSpending: completedRepairValue
    },
    charts: {
      statusDistribution: byStatus.map((r) => ({ label: r._id, value: r.count })),
      historyOverTime: timeline.map((r) => ({ label: r._id, value: r.count })),
      monthlyCompletedRepairValue: completedValueByMonth.map((r) => ({
        label: r._id,
        value: r.total
      })),
      monthlyActualSpending: paymentsByMonth.map((r) => ({ label: r._id, value: r.total }))
    },
    warranties: warranty,
    range
  };
}

export async function mechanicAnalytics(user: AuthUser, range: { from: Date; to: Date }) {
  const match = {
    ...repairStatsMatch(user),
    createdAt: { $gte: range.from, $lte: range.to }
  };
  const [byStatus, timeline, labor] = await Promise.all([
    RepairRequest.aggregate([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]),
    RepairRequest.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]),
    RepairRequest.aggregate([
      {
        $match: {
          assignedMechanic: toObjectId(user.id),
          laborMinutes: { $gt: 0 },
          updatedAt: { $gte: range.from, $lte: range.to }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$updatedAt' } },
          minutes: { $sum: '$laborMinutes' }
        }
      },
      { $sort: { _id: 1 } }
    ])
  ]);
  const statusMap = Object.fromEntries(byStatus.map((r) => [r._id, r.count]));
  const total = byStatus.reduce((s, r) => s + r.count, 0);
  const overdue = await RepairRequest.countDocuments({
    assignedMechanic: user.id,
    deadline: { $lt: new Date() },
    status: { $nin: ['completed', 'cancelled'] }
  });
  return {
    summary: {
      assigned: total,
      inProgress: statusMap.in_progress || 0,
      completed: statusMap.completed || 0,
      overdue,
      awaitingParts: statusMap.awaiting_parts || 0,
      laborMinutes: labor.reduce((s, r) => s + (r.minutes || 0), 0)
    },
    charts: {
      statusDistribution: byStatus.map((r) => ({ label: r._id, value: r.count })),
      workloadOverTime: timeline.map((r) => ({ label: r._id, value: r.count })),
      laborHours: labor.map((r) => ({ label: r._id, value: Math.round((r.minutes / 60) * 10) / 10 }))
    },
    range
  };
}

export async function partsAnalytics(user: AuthUser, range: { from: Date; to: Date }, shopId?: string) {
  const shops = shopObjectIds(user, shopId);
  const [parts, lowStock, movements, topRequested, pendingRequests, transfersPending] =
    await Promise.all([
      Part.aggregate([
        { $match: { shop: { $in: shops }, isActive: true } },
        {
          $group: {
            _id: null,
            skuCount: { $sum: 1 },
            available: { $sum: '$quantityAvailable' },
            reserved: { $sum: '$quantityReserved' }
          }
        }
      ]),
      Part.find({
        shop: { $in: shops },
        isActive: true,
        $expr: { $lte: ['$quantityAvailable', '$reorderLevel'] }
      })
        .select('sku name quantityAvailable reorderLevel shop')
        .limit(50),
      InventoryMovement.aggregate([
        {
          $match: {
            shop: { $in: shops },
            createdAt: { $gte: range.from, $lte: range.to }
          }
        },
        {
          $group: {
            _id: {
              day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
              type: '$type'
            },
            qty: { $sum: { $abs: '$quantityDelta' } }
          }
        },
        { $sort: { '_id.day': 1 } }
      ]),
      PartsRequest.aggregate([
        {
          $match: {
            shop: { $in: shops },
            createdAt: { $gte: range.from, $lte: range.to }
          }
        },
        { $group: { _id: '$part', qty: { $sum: '$quantityRequested' } } },
        { $sort: { qty: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: 'parts',
            localField: '_id',
            foreignField: '_id',
            as: 'part'
          }
        },
        { $unwind: { path: '$part', preserveNullAndEmptyArrays: true } }
      ]),
      PartsRequest.countDocuments({
        shop: { $in: shops },
        status: { $in: ['pending', 'partially_fulfilled'] }
      }),
      StockTransfer.countDocuments({
        $or: [{ fromShop: { $in: shops } }, { toShop: { $in: shops } }],
        status: { $in: ['requested', 'approved', 'in_transit'] }
      })
    ]);

  const stock = parts[0] || { skuCount: 0, available: 0, reserved: 0 };
  return {
    summary: {
      activeParts: stock.skuCount,
      available: stock.available,
      reserved: stock.reserved,
      lowStock: lowStock.length,
      pendingRequests,
      outstandingTransfers: transfersPending
    },
    charts: {
      stockAvailability: [
        { label: 'available', value: stock.available },
        { label: 'reserved', value: stock.reserved }
      ],
      lowStock: lowStock.slice(0, 12).map((p) => ({
        label: p.sku,
        value: p.quantityAvailable
      })),
      movements: movements.map((m) => ({
        label: `${m._id.day}:${m._id.type}`,
        value: m.qty
      })),
      topRequested: topRequested.map((r) => ({
        label: r.part?.sku || String(r._id),
        value: r.qty
      }))
    },
    lowStockItems: lowStock,
    range
  };
}

export async function adminAnalytics(user: AuthUser, range: { from: Date; to: Date }, shopId?: string) {
  const shops = shopObjectIds(user, shopId);
  const match = {
    shop: { $in: shops },
    createdAt: { $gte: range.from, $lte: range.to }
  };
  const prev = previousEquivalentRange(range);
  const prevMatch = {
    shop: { $in: shops },
    createdAt: { $gte: prev.from, $lte: prev.to }
  };
  const now = new Date();
  const soon = new Date(now.getTime() + 7 * 86400000);

  const [
    byStatus,
    volume,
    paymentRevenue,
    mechanicLoad,
    turnaround,
    pendingApprovals,
    appointments,
    overdue,
    totalCustomers,
    prevByStatus,
    prevCustomers,
    topCustomersAgg,
    lowStock,
    overdueList,
    pendingApprovalList,
    upcomingAppointments,
    recentAudit,
    consumption
  ] = await Promise.all([
    RepairRequest.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    RepairRequest.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]),
    // Recorded revenue — net PaymentRecord amounts (payments − reversals), not finalCost estimates.
    PaymentRecord.aggregate([
      {
        $match: {
          shop: { $in: shops },
          paidAt: { $gte: range.from, $lte: range.to }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$paidAt' } },
          total: {
            $sum: {
              $cond: [
                { $eq: ['$entryType', 'reversal'] },
                { $multiply: ['$amount', -1] },
                '$amount'
              ]
            }
          }
        }
      },
      { $sort: { _id: 1 } }
    ]),
    RepairRequest.aggregate([
      {
        $match: {
          shop: { $in: shops },
          assignedMechanic: { $ne: null },
          createdAt: { $gte: range.from, $lte: range.to }
        }
      },
      { $group: { _id: '$assignedMechanic', count: { $sum: 1 } } },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'mechanic'
        }
      },
      { $unwind: { path: '$mechanic', preserveNullAndEmptyArrays: true } },
      { $sort: { count: -1 } },
      { $limit: 12 }
    ]),
    RepairRequest.aggregate([
      {
        $match: {
          shop: { $in: shops },
          status: 'completed',
          completedAt: { $ne: null },
          createdAt: { $gte: range.from, $lte: range.to }
        }
      },
      {
        $project: {
          hours: {
            $divide: [{ $subtract: ['$completedAt', '$createdAt'] }, 1000 * 60 * 60]
          }
        }
      },
      { $group: { _id: null, avgHours: { $avg: '$hours' } } }
    ]),
    RepairRequest.countDocuments({
      shop: { $in: shops },
      status: 'estimate_pending'
    }),
    Appointment.aggregate([
      {
        $match: {
          shop: { $in: shops },
          startsAt: { $gte: range.from, $lte: range.to }
        }
      },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]),
    RepairRequest.countDocuments({
      shop: { $in: shops },
      deadline: { $lt: now },
      status: { $nin: ['completed', 'cancelled'] }
    }),
    RepairRequest.distinct('customer', { shop: { $in: shops } }),
    RepairRequest.aggregate([
      { $match: prevMatch },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]),
    RepairRequest.distinct('customer', {
      shop: { $in: shops },
      createdAt: { $gte: prev.from, $lte: prev.to }
    }),
    RepairRequest.aggregate([
      { $match: { shop: { $in: shops }, createdAt: { $gte: range.from, $lte: range.to } } },
      {
        $group: {
          _id: '$customer',
          repairCount: { $sum: 1 },
          completed: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          }
        }
      },
      { $sort: { repairCount: -1 } },
      { $limit: 8 },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'customer'
        }
      },
      { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'paymentrecords',
          let: { customerId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$customer', '$$customerId'] },
                    { $in: ['$shop', shops] },
                    { $gte: ['$paidAt', range.from] },
                    { $lte: ['$paidAt', range.to] }
                  ]
                }
              }
            },
            { $group: { _id: null, total: { $sum: '$amount' } } }
          ],
          as: 'payments'
        }
      }
    ]),
    Part.find({
      shop: { $in: shops },
      isActive: true,
      $expr: { $lte: ['$quantityAvailable', '$reorderLevel'] }
    })
      .select('sku name quantityAvailable reorderLevel shop')
      .sort({ quantityAvailable: 1 })
      .limit(12),
    RepairRequest.find({
      shop: { $in: shops },
      deadline: { $lt: now },
      status: { $nin: ['completed', 'cancelled'] }
    })
      .select('referenceNumber status deadline brand model')
      .sort({ deadline: 1 })
      .limit(5),
    RepairRequest.find({
      shop: { $in: shops },
      status: 'estimate_pending'
    })
      .select('referenceNumber status brand model updatedAt')
      .sort({ updatedAt: -1 })
      .limit(5),
    Appointment.find({
      shop: { $in: shops },
      status: 'booked',
      startsAt: { $gte: now, $lte: soon }
    })
      .populate('customer', 'name email')
      .sort({ startsAt: 1 })
      .limit(5),
    AuditLog.find({ shop: { $in: shops } })
      .sort({ createdAt: -1 })
      .limit(12)
      .populate('actor', 'name role')
      .select('action entityType entityId details createdAt actor'),
    InventoryMovement.aggregate([
      {
        $match: {
          shop: { $in: shops },
          createdAt: { $gte: range.from, $lte: range.to },
          type: { $in: ['reserve', 'stock_out', 'adjust', 'transfer_out'] }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          qty: { $sum: { $abs: '$quantityDelta' } }
        }
      },
      { $sort: { _id: 1 } }
    ])
  ]);

  const statusMap = Object.fromEntries(byStatus.map((r) => [r._id, r.count]));
  const total = byStatus.reduce((s, r) => s + r.count, 0);
  const completed = statusMap.completed || 0;
  const pending =
    (statusMap.submitted || 0) +
    (statusMap.estimate_pending || 0) +
    (statusMap.awaiting_parts || 0) +
    (statusMap.assigned || 0);
  const prevStatusMap = Object.fromEntries(prevByStatus.map((r) => [r._id, r.count]));
  const prevTotal = prevByStatus.reduce((s, r) => s + r.count, 0);
  const prevCompleted = prevStatusMap.completed || 0;
  const prevPending =
    (prevStatusMap.submitted || 0) +
    (prevStatusMap.estimate_pending || 0) +
    (prevStatusMap.awaiting_parts || 0) +
    (prevStatusMap.assigned || 0);
  const customerCount = totalCustomers.length;
  const recordedRevenue = paymentRevenue.reduce((s, r) => s + (r.total || 0), 0);

  const volumeMap = new Map(volume.map((r) => [r._id, r.count]));
  const revenueMap = new Map(paymentRevenue.map((r) => [r._id, r.total]));
  const overviewLabels = [...new Set([...volumeMap.keys(), ...revenueMap.keys()])].sort();
  const businessOverview = overviewLabels.map((label) => ({
    label,
    repairs: volumeMap.get(label) || 0,
    revenue: revenueMap.get(label) || 0
  }));

  return {
    summary: {
      totalRepairs: total,
      completed,
      pending,
      active: total - completed - (statusMap.cancelled || 0),
      overdue,
      pendingApprovals,
      awaitingParts: statusMap.awaiting_parts || 0,
      inProgress: statusMap.in_progress || 0,
      totalCustomers: customerCount,
      avgTurnaroundHours: Math.round((turnaround[0]?.avgHours || 0) * 10) / 10,
      recordedRevenue,
      appointmentBooked: appointments.find((a) => a._id === 'booked')?.count || 0
    },
    trends: {
      totalRepairs: trendPct(total, prevTotal),
      completed: trendPct(completed, prevCompleted),
      pending: trendPct(pending, prevPending),
      totalCustomers: trendPct(customerCount, prevCustomers.length)
    },
    sparklines: {
      totalRepairs: volume.map((r) => r.count),
      completed: volume.map((r) => r.count),
      revenue: paymentRevenue.map((r) => r.total)
    },
    charts: {
      statusDistribution: byStatus.map((r) => ({ label: r._id, value: r.count })),
      volumeOverTime: volume.map((r) => ({ label: r._id, value: r.count })),
      revenueOverTime: paymentRevenue.map((r) => ({ label: r._id, value: r.total })),
      mechanicWorkload: mechanicLoad.map((r) => ({
        label: r.mechanic?.name || String(r._id),
        value: r.count
      })),
      inventoryConsumption: consumption.map((r) => ({ label: r._id, value: r.qty }))
    },
    businessOverview,
    topCustomers: topCustomersAgg.map((row) => ({
      id: String(row._id),
      name: row.customer?.name || 'Customer',
      email: row.customer?.email || '',
      repairCount: row.repairCount,
      completed: row.completed,
      recordedSpend: row.payments?.[0]?.total || 0
    })),
    inventoryAlerts: lowStock.map((p) => ({
      id: String(p._id),
      sku: p.sku,
      name: p.name,
      quantityAvailable: p.quantityAvailable,
      reorderLevel: p.reorderLevel,
      severity: p.quantityAvailable <= 0 ? 'critical' : 'low'
    })),
    recentActivity: recentAudit.map((a) => ({
      id: String(a._id),
      action: a.action,
      entityType: a.entityType,
      entityId: a.entityId ? String(a.entityId) : null,
      actorName: (a.actor as { name?: string } | null)?.name || null,
      details: a.details,
      createdAt: a.createdAt
    })),
    priorities: {
      overdue: overdueList.map((r) => ({
        id: String(r._id),
        referenceNumber: r.referenceNumber,
        status: r.status,
        deadline: r.deadline,
        label: `${r.brand} ${r.model}`
      })),
      pendingApprovals: pendingApprovalList.map((r) => ({
        id: String(r._id),
        referenceNumber: r.referenceNumber,
        status: r.status,
        label: `${r.brand} ${r.model}`
      })),
      criticalInventory: lowStock
        .filter((p) => p.quantityAvailable <= 0 || p.quantityAvailable <= Math.max(1, p.reorderLevel / 2))
        .slice(0, 5)
        .map((p) => ({
          id: String(p._id),
          sku: p.sku,
          name: p.name,
          quantityAvailable: p.quantityAvailable,
          reorderLevel: p.reorderLevel
        })),
      upcomingAppointments: upcomingAppointments.map((a) => ({
        id: String(a._id),
        startsAt: a.startsAt,
        customerName: (a.customer as { name?: string } | null)?.name || 'Customer',
        status: a.status
      }))
    },
    range
  };
}
