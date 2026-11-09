import {
  Appointment,
  InventoryMovement,
  Part,
  PartsReservation,
  PaymentRecord,
  RepairRequest,
  RepairShop,
  ShopMembership,
  StockTransfer
} from '../models/index.js';
import type { AuthUser } from '../middleware/auth.js';
import { AppError } from '../utils/errors.js';
import { assertShopAccess, toObjectId } from './access.js';
import { writeAudit } from './audit.js';

export async function listManagedShops(user: AuthUser) {
  const ids = user.shopIds.map(toObjectId);
  return RepairShop.find({ _id: { $in: ids } }).sort({ name: 1 });
}

export async function createShopForAdmin(user: AuthUser, body: Record<string, unknown>) {
  const shop = await RepairShop.create(body);
  await ShopMembership.create({
    user: toObjectId(user.id),
    shop: shop._id,
    role: 'shop_admin',
    isActive: true
  });
  await writeAudit({
    actor: user.id,
    action: 'shop.create',
    entityType: 'RepairShop',
    entityId: shop._id,
    shop: shop._id
  });
  return shop;
}

export async function archiveBlockers(shopId: string) {
  const oid = toObjectId(shopId);
  const now = new Date();
  const [
    activeRepairs,
    pendingAppointments,
    outstandingEstimates,
    reservedParts,
    openTransfers,
    unpaidCompleted
  ] = await Promise.all([
    RepairRequest.countDocuments({
      shop: oid,
      status: { $nin: ['completed', 'cancelled'] }
    }),
    Appointment.countDocuments({
      shop: oid,
      status: 'booked',
      startsAt: { $gte: now }
    }),
    RepairRequest.countDocuments({ shop: oid, status: 'estimate_pending' }),
    Part.countDocuments({ shop: oid, isActive: true, quantityReserved: { $gt: 0 } }),
    StockTransfer.countDocuments({
      $or: [{ fromShop: oid }, { toShop: oid }],
      status: {
        $in: ['requested', 'approved', 'awaiting_transfer', 'dispatched', 'in_transit']
      }
    }),
    RepairRequest.aggregate([
      {
        $match: {
          shop: oid,
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
        $match: {
          $expr: { $gt: ['$finalCost', '$paid'] }
        }
      },
      { $count: 'count' }
    ])
  ]);

  return {
    activeRepairs,
    pendingAppointments,
    outstandingEstimates,
    reservedParts,
    openTransfers,
    outstandingBalances: unpaidCompleted[0]?.count || 0,
    blockers:
      activeRepairs +
      pendingAppointments +
      outstandingEstimates +
      reservedParts +
      openTransfers +
      (unpaidCompleted[0]?.count || 0)
  };
}

export async function archiveShop(user: AuthUser, shopId: string, reason = '') {
  assertShopAccess(user, shopId);
  if (user.role !== 'shop_admin') {
    throw new AppError('Only shop administrators may archive shops', 403, 'FORBIDDEN');
  }
  const blockers = await archiveBlockers(shopId);
  if (blockers.blockers > 0) {
    throw new AppError(
      'Shop cannot be archived while unresolved operational items remain',
      409,
      'SHOP_ARCHIVE_BLOCKED',
      blockers
    );
  }
  const shop = await RepairShop.findByIdAndUpdate(
    shopId,
    {
      isActive: false,
      archivedAt: new Date(),
      archiveReason: reason || 'Archived by administrator'
    },
    { new: true }
  );
  if (!shop) throw new AppError('Shop not found', 404, 'NOT_FOUND');
  await writeAudit({
    actor: user.id,
    action: 'shop.archive',
    entityType: 'RepairShop',
    entityId: shop._id,
    shop: shop._id,
    details: { reason }
  });
  return shop;
}

export async function shopHistorySummary(user: AuthUser, shopId: string) {
  assertShopAccess(user, shopId);
  const oid = toObjectId(shopId);
  const [repairs, movements, payments] = await Promise.all([
    RepairRequest.countDocuments({ shop: oid }),
    InventoryMovement.countDocuments({ shop: oid }),
    PaymentRecord.countDocuments({ shop: oid })
  ]);
  return { repairs, movements, payments };
}

export async function activeReservations(shopId: string) {
  return PartsReservation.countDocuments({
    shop: toObjectId(shopId),
    status: 'active'
  });
}
