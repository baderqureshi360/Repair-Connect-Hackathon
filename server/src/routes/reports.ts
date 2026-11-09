import { Router } from 'express';
import mongoose from 'mongoose';
import { Part, RepairRequest, ShopMembership } from '../models/index.js';
import { authenticate, requireRoles } from '../middleware/auth.js';
import { ok } from '../utils/response.js';
import { AppError } from '../utils/errors.js';
import { reportsCenter, type ReportCategory } from '../services/reportsCenter.js';
import { assertShopAccess } from '../services/access.js';

const router = Router();
router.use(authenticate);

router.get('/center', async (req, res, next) => {
  try {
    const category = String(req.query.category || 'repairs') as ReportCategory;
    const allowed: ReportCategory[] = ['repairs', 'financial', 'inventory', 'mechanics', 'customers'];
    if (!allowed.includes(category)) throw new AppError('Invalid category', 400, 'VALIDATION');
    if (req.query.shopId) assertShopAccess(req.user!, String(req.query.shopId));
    const data = await reportsCenter(req.user!, {
      category,
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
      shopId: req.query.shopId as string | undefined
    });
    return ok(res, data);
  } catch (err) {
    next(err);
  }
});

router.get('/center.csv', async (req, res, next) => {
  try {
    const category = String(req.query.category || 'repairs') as ReportCategory;
    const data = await reportsCenter(req.user!, {
      category,
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
      shopId: req.query.shopId as string | undefined
    });
    const rows = (data as { rows?: Record<string, unknown>[] }).rows || [];
    const keys = rows.length ? Object.keys(rows[0]) : ['empty'];
    const header = keys.join(',') + '\n';
    const body = rows
      .map((row) => keys.map((k) => JSON.stringify(row[k] ?? '')).join(','))
      .join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="repairconnect-${category}.csv"`);
    res.status(200).send(header + body);
  } catch (err) {
    next(err);
  }
});

router.use(requireRoles('shop_admin'));

function shopObjectIds(ids: string[]) {
  return ids.map((id) => new mongoose.Types.ObjectId(id));
}

router.get('/operations', async (req, res, next) => {
  try {
    const shopIds = req.user!.shopIds;
    if (!shopIds.length) throw new AppError('No shop membership', 403, 'FORBIDDEN');
    const shopOid = shopObjectIds(shopIds);

    const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 86400000);
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
    // Include end-of-day buffer so "to=today" and just-created records are counted.
    if (!req.query.to) to.setHours(23, 59, 59, 999);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new AppError('Invalid date range', 400, 'INVALID_DATE');
    }

    const match = {
      shop: { $in: shopOid },
      createdAt: { $gte: from, $lte: to }
    };

    const [byStatus, completed, overdue, pendingApprovals, lowStock, mechanics, activeJobs] =
      await Promise.all([
        RepairRequest.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
        RepairRequest.find({
          ...match,
          status: 'completed',
          completedAt: { $exists: true }
        }).select('createdAt completedAt assignedMechanic'),
        RepairRequest.countDocuments({
          shop: { $in: shopOid },
          status: { $nin: ['completed', 'cancelled'] },
          deadline: { $lt: new Date() }
        }),
        RepairRequest.countDocuments({
          shop: { $in: shopOid },
          status: 'estimate_pending'
        }),
        Part.find({
          shop: { $in: shopOid },
          isActive: true,
          $expr: { $lte: ['$quantityAvailable', '$reorderLevel'] }
        }).select('sku name quantityAvailable reorderLevel shop'),
        ShopMembership.find({
          shop: { $in: shopOid },
          role: 'mechanic',
          isActive: true
        }).populate('user', 'name email'),
        RepairRequest.find({
          shop: { $in: shopOid },
          status: { $nin: ['completed', 'cancelled'] },
          assignedMechanic: { $exists: true }
        }).select('assignedMechanic')
      ]);

    const turnaroundHours = completed
      .map((r) => {
        if (!r.completedAt || !r.createdAt) return null;
        return (new Date(r.completedAt).getTime() - new Date(r.createdAt).getTime()) / 3_600_000;
      })
      .filter((n): n is number => n != null);

    const avgTurnaroundHours =
      turnaroundHours.length === 0
        ? 0
        : Math.round((turnaroundHours.reduce((a, b) => a + b, 0) / turnaroundHours.length) * 10) / 10;

    const workloadMap = new Map<string, number>();
    for (const job of activeJobs) {
      const id = job.assignedMechanic?.toString();
      if (!id) continue;
      workloadMap.set(id, (workloadMap.get(id) || 0) + 1);
    }

    const mechanicWorkload = mechanics.map((m) => {
      const user = m.user as { _id?: { toString(): string }; name?: string; email?: string };
      const id = user?._id?.toString() || '';
      return {
        mechanicId: id,
        name: user?.name || '',
        email: user?.email || '',
        activeJobs: workloadMap.get(id) || 0
      };
    });

    const statusCounts = Object.fromEntries(byStatus.map((r) => [r._id, r.count]));
    const totalReceived = byStatus.reduce((s, r) => s + r.count, 0);

    return ok(res, {
      from: from.toISOString(),
      to: to.toISOString(),
      totalReceived,
      completed: statusCounts.completed || 0,
      pending: totalReceived - (statusCounts.completed || 0) - (statusCounts.cancelled || 0),
      overdue,
      pendingApprovals,
      avgTurnaroundHours,
      byStatus: statusCounts,
      lowStock,
      mechanicWorkload
    });
  } catch (err) {
    next(err);
  }
});

router.get('/operations.csv', async (req, res, next) => {
  try {
    const shopOid = shopObjectIds(req.user!.shopIds);
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 86400000);
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
    if (!req.query.to) to.setHours(23, 59, 59, 999);
    const repairs = await RepairRequest.find({
      shop: { $in: shopOid },
      createdAt: { $gte: from, $lte: to }
    }).select('referenceNumber status brand model createdAt completedAt finalCost');

    const header = 'reference,status,brand,model,createdAt,completedAt,finalCost\n';
    const rows = repairs
      .map((r) =>
        [
          r.referenceNumber,
          r.status,
          JSON.stringify(r.brand),
          JSON.stringify(r.model),
          r.createdAt?.toISOString?.() || '',
          r.completedAt?.toISOString?.() || '',
          r.finalCost ?? ''
        ].join(',')
      )
      .join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="repairconnect-operations.csv"');
    res.status(200).send(header + rows);
  } catch (err) {
    next(err);
  }
});

export default router;
