import mongoose from 'mongoose';
import {
  FinancialDocument,
  InventoryMovement,
  Part,
  PaymentRecord,
  RepairRequest
} from '../models/index.js';
import type { AuthUser } from '../middleware/auth.js';
import { AppError } from '../utils/errors.js';
import { assertShopAccess, repairStatsMatch, toObjectId } from './access.js';

export type ReportCategory = 'repairs' | 'financial' | 'inventory' | 'mechanics' | 'customers';

function resolveShops(user: AuthUser, shopId?: string) {
  if (shopId) {
    assertShopAccess(user, shopId);
    return [toObjectId(shopId)];
  }
  if (!user.shopIds.length) throw new AppError('No shop membership', 403, 'FORBIDDEN');
  return user.shopIds.map((id) => toObjectId(id));
}

function dateRange(from?: string, to?: string) {
  const start = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
  const end = to ? new Date(to) : new Date();
  if (!to) end.setHours(23, 59, 59, 999);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    throw new AppError('Invalid date range', 400, 'INVALID_DATE');
  }
  return { from: start, to: end };
}

export async function reportsCenter(
  user: AuthUser,
  input: { category: ReportCategory; from?: string; to?: string; shopId?: string }
) {
  const range = dateRange(input.from, input.to);

  if (user.role === 'customer') {
    if (input.category !== 'customers' && input.category !== 'repairs' && input.category !== 'financial') {
      throw new AppError('Report category not permitted', 403, 'FORBIDDEN');
    }
    return customerReports(user, input.category, range);
  }

  if (user.role === 'mechanic') {
    if (input.category !== 'mechanics' && input.category !== 'repairs') {
      throw new AppError('Report category not permitted', 403, 'FORBIDDEN');
    }
    return mechanicReports(user, input.category, range);
  }

  if (user.role === 'parts_coordinator') {
    if (input.category !== 'inventory') {
      throw new AppError('Report category not permitted', 403, 'FORBIDDEN');
    }
    const shops = resolveShops(user, input.shopId);
    return inventoryReports(shops, range);
  }

  // shop_admin
  const shops = resolveShops(user, input.shopId);
  if (input.category === 'repairs') return repairReports(shops, range);
  if (input.category === 'financial') return financialReports(shops, range);
  if (input.category === 'inventory') return inventoryReports(shops, range);
  if (input.category === 'mechanics') return mechanicAdminReports(shops, range);
  if (input.category === 'customers') return customerAdminReports(shops, range);
  throw new AppError('Unknown report category', 400, 'VALIDATION');
}

async function repairReports(shops: mongoose.Types.ObjectId[], range: { from: Date; to: Date }) {
  const match = { shop: { $in: shops }, createdAt: { $gte: range.from, $lte: range.to } };
  const [byStatus, overdue, turnaround, trend] = await Promise.all([
    RepairRequest.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    RepairRequest.countDocuments({
      shop: { $in: shops },
      status: { $nin: ['completed', 'cancelled'] },
      deadline: { $lt: new Date() }
    }),
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
          hours: { $divide: [{ $subtract: ['$completedAt', '$createdAt'] }, 3600000] }
        }
      },
      { $group: { _id: null, avg: { $avg: '$hours' } } }
    ]),
    RepairRequest.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } }
        }
      },
      { $sort: { _id: 1 } }
    ])
  ]);
  const status = Object.fromEntries(byStatus.map((r) => [r._id, r.count]));
  const total = byStatus.reduce((s, r) => s + r.count, 0);
  return {
    category: 'repairs',
    range,
    summary: {
      received: total,
      completed: status.completed || 0,
      active: total - (status.completed || 0) - (status.cancelled || 0),
      pending: (status.submitted || 0) + (status.assigned || 0),
      overdue,
      awaitingApproval: status.estimate_pending || 0,
      awaitingParts: status.awaiting_parts || 0,
      avgTurnaroundHours: Math.round((turnaround[0]?.avg || 0) * 10) / 10
    },
    byStatus: status,
    trend: trend.map((t) => ({ label: t._id, received: t.count, completed: t.completed })),
    rows: trend.map((t) => ({
      date: t._id,
      received: t.count,
      completed: t.completed
    }))
  };
}

async function financialReports(shops: mongoose.Types.ObjectId[], range: { from: Date; to: Date }) {
  const [payments, byMethod, invoices, completedValue] = await Promise.all([
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
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]),
    PaymentRecord.aggregate([
      {
        $match: {
          shop: { $in: shops },
          paidAt: { $gte: range.from, $lte: range.to }
        }
      },
      { $group: { _id: '$method', total: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]),
    FinancialDocument.aggregate([
      {
        $match: {
          shop: { $in: shops },
          issuedAt: { $gte: range.from, $lte: range.to },
          status: 'issued'
        }
      },
      { $group: { _id: '$docType', count: { $sum: 1 }, total: { $sum: '$totalAmount' } } }
    ]),
    RepairRequest.aggregate([
      {
        $match: {
          shop: { $in: shops },
          status: 'completed',
          completedAt: { $gte: range.from, $lte: range.to },
          finalCost: { $ne: null }
        }
      },
      { $group: { _id: null, total: { $sum: '$finalCost' } } }
    ])
  ]);

  const confirmedPayments = payments.reduce((s, p) => s + (p.total || 0), 0);
  const repairValue = completedValue[0]?.total || 0;

  // Outstanding across completed repairs with finalCost > paid
  const outstandingAgg = await RepairRequest.aggregate([
    {
      $match: {
        shop: { $in: shops },
        status: 'completed',
        finalCost: { $gt: 0 }
      }
    },
    {
      $lookup: {
        from: 'paymentrecords',
        localField: '_id',
        foreignField: 'repairRequest',
        as: 'payments'
      }
    },
    {
      $project: {
        finalCost: 1,
        paid: { $sum: '$payments.amount' }
      }
    },
    {
      $group: {
        _id: null,
        outstanding: {
          $sum: {
            $max: [{ $subtract: ['$finalCost', '$paid'] }, 0]
          }
        },
        partial: {
          $sum: {
            $cond: [
              {
                $and: [{ $gt: ['$paid', 0] }, { $lt: ['$paid', '$finalCost'] }]
              },
              1,
              0
            ]
          }
        }
      }
    }
  ]);

  return {
    category: 'financial',
    range,
    summary: {
      confirmedPayments,
      completedRepairValue: repairValue,
      outstandingBalances: Math.round((outstandingAgg[0]?.outstanding || 0) * 100) / 100,
      partialPaymentRepairs: outstandingAgg[0]?.partial || 0,
      issuedDocuments: invoices.reduce((s, i) => s + i.count, 0)
    },
    paymentMethods: byMethod.map((m) => ({ method: m._id || 'other', total: m.total, count: m.count })),
    documentsByType: invoices.map((i) => ({ type: i._id, count: i.count, total: i.total })),
    revenueTrend: payments.map((p) => ({ label: p._id, value: p.total })),
    rows: payments.map((p) => ({ date: p._id, payments: p.count, amount: p.total }))
  };
}

async function inventoryReports(shops: mongoose.Types.ObjectId[], range: { from: Date; to: Date }) {
  const [parts, movements, lowStock] = await Promise.all([
    Part.aggregate([
      { $match: { shop: { $in: shops }, isActive: true } },
      {
        $group: {
          _id: null,
          skus: { $sum: 1 },
          available: { $sum: '$quantityAvailable' },
          reserved: { $sum: '$quantityReserved' },
          valuation: { $sum: { $multiply: ['$quantityAvailable', '$unitCost'] } }
        }
      }
    ]),
    InventoryMovement.aggregate([
      {
        $match: {
          shop: { $in: shops },
          createdAt: { $gte: range.from, $lte: range.to }
        }
      },
      {
        $group: {
          _id: '$type',
          qty: { $sum: { $abs: '$quantityDelta' } },
          count: { $sum: 1 }
        }
      }
    ]),
    Part.find({
      shop: { $in: shops },
      isActive: true,
      $expr: { $lte: ['$quantityAvailable', '$reorderLevel'] }
    })
      .select('sku name quantityAvailable reorderLevel unitCost')
      .sort({ quantityAvailable: 1 })
      .limit(100)
  ]);

  const stock = parts[0] || { skus: 0, available: 0, reserved: 0, valuation: 0 };
  return {
    category: 'inventory',
    range,
    summary: {
      activeParts: stock.skus,
      available: stock.available,
      reserved: stock.reserved,
      stockValuation: Math.round((stock.valuation || 0) * 100) / 100,
      lowStock: lowStock.length,
      outOfStock: lowStock.filter((p) => p.quantityAvailable <= 0).length
    },
    movementsByType: movements.map((m) => ({ type: m._id, quantity: m.qty, events: m.count })),
    rows: lowStock.map((p) => ({
      sku: p.sku,
      name: p.name,
      available: p.quantityAvailable,
      reorderLevel: p.reorderLevel,
      unitCost: p.unitCost
    }))
  };
}

async function mechanicAdminReports(shops: mongoose.Types.ObjectId[], range: { from: Date; to: Date }) {
  const rows = await RepairRequest.aggregate([
    {
      $match: {
        shop: { $in: shops },
        assignedMechanic: { $ne: null },
        createdAt: { $gte: range.from, $lte: range.to }
      }
    },
    {
      $group: {
        _id: '$assignedMechanic',
        assigned: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        laborMinutes: { $sum: { $ifNull: ['$laborMinutes', 0] } },
        overdue: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $lt: ['$deadline', new Date()] },
                  { $not: { $in: ['$status', ['completed', 'cancelled']] } }
                ]
              },
              1,
              0
            ]
          }
        }
      }
    },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'mechanic'
      }
    },
    { $unwind: { path: '$mechanic', preserveNullAndEmptyArrays: true } },
    { $sort: { assigned: -1 } }
  ]);

  return {
    category: 'mechanics',
    range,
    summary: {
      mechanics: rows.length,
      assigned: rows.reduce((s, r) => s + r.assigned, 0),
      completed: rows.reduce((s, r) => s + r.completed, 0),
      laborHours: Math.round((rows.reduce((s, r) => s + (r.laborMinutes || 0), 0) / 60) * 10) / 10
    },
    rows: rows.map((r) => ({
      mechanicId: String(r._id),
      name: r.mechanic?.name || 'Mechanic',
      assigned: r.assigned,
      completed: r.completed,
      overdue: r.overdue,
      laborHours: Math.round(((r.laborMinutes || 0) / 60) * 10) / 10
    }))
  };
}

async function customerAdminReports(shops: mongoose.Types.ObjectId[], range: { from: Date; to: Date }) {
  const rows = await RepairRequest.aggregate([
    {
      $match: {
        shop: { $in: shops },
        createdAt: { $gte: range.from, $lte: range.to }
      }
    },
    {
      $group: {
        _id: '$customer',
        repairs: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } }
      }
    },
    { $sort: { repairs: -1 } },
    { $limit: 100 },
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
  ]);

  const repeat = rows.filter((r) => r.repairs > 1).length;
  return {
    category: 'customers',
    range,
    summary: {
      uniqueCustomers: rows.length,
      repeatCustomers: repeat,
      repairs: rows.reduce((s, r) => s + r.repairs, 0),
      recordedSpending: rows.reduce((s, r) => s + (r.payments?.[0]?.total || 0), 0)
    },
    rows: rows.map((r) => ({
      customerId: String(r._id),
      name: r.customer?.name || 'Customer',
      email: r.customer?.email || '',
      repairs: r.repairs,
      completed: r.completed,
      recordedSpend: r.payments?.[0]?.total || 0
    }))
  };
}

async function customerReports(
  user: AuthUser,
  category: ReportCategory,
  range: { from: Date; to: Date }
) {
  const customerId = toObjectId(user.id);
  if (category === 'financial') {
    const payments = await PaymentRecord.aggregate([
      {
        $match: {
          customer: customerId,
          paidAt: { $gte: range.from, $lte: range.to }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$paidAt' } },
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    return {
      category: 'financial',
      range,
      summary: {
        confirmedPayments: payments.reduce((s, p) => s + p.total, 0),
        paymentEvents: payments.reduce((s, p) => s + p.count, 0)
      },
      rows: payments.map((p) => ({ date: p._id, amount: p.total, count: p.count }))
    };
  }

  const repairs = await RepairRequest.find({
    customer: customerId,
    createdAt: { $gte: range.from, $lte: range.to }
  })
    .select('referenceNumber status brand model createdAt completedAt finalCost')
    .sort({ createdAt: -1 })
    .limit(200);

  return {
    category: 'repairs',
    range,
    summary: {
      total: repairs.length,
      completed: repairs.filter((r) => r.status === 'completed').length,
      active: repairs.filter((r) => !['completed', 'cancelled'].includes(r.status)).length
    },
    rows: repairs.map((r) => ({
      referenceNumber: r.referenceNumber,
      status: r.status,
      device: `${r.brand} ${r.model}`,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
      finalCost: r.finalCost
    }))
  };
}

async function mechanicReports(
  user: AuthUser,
  category: ReportCategory,
  range: { from: Date; to: Date }
) {
  const match = {
    ...repairStatsMatch(user),
    createdAt: { $gte: range.from, $lte: range.to }
  };
  const jobs = await RepairRequest.find(match)
    .select('referenceNumber status brand model deadline laborMinutes createdAt completedAt')
    .sort({ updatedAt: -1 })
    .limit(200);
  const overdue = jobs.filter(
    (j) => j.deadline && j.deadline < new Date() && !['completed', 'cancelled'].includes(j.status)
  ).length;
  return {
    category: category === 'mechanics' ? 'mechanics' : 'repairs',
    range,
    summary: {
      assigned: jobs.length,
      completed: jobs.filter((j) => j.status === 'completed').length,
      inProgress: jobs.filter((j) => j.status === 'in_progress').length,
      overdue,
      laborHours: Math.round((jobs.reduce((s, j) => s + (j.laborMinutes || 0), 0) / 60) * 10) / 10
    },
    rows: jobs.map((j) => ({
      referenceNumber: j.referenceNumber,
      status: j.status,
      device: `${j.brand} ${j.model}`,
      deadline: j.deadline,
      laborMinutes: j.laborMinutes || 0
    }))
  };
}
