import mongoose from 'mongoose';
import { InventoryMovement, Part, PartsRequest, StockTransfer } from '../models/index.js';
import type { AuthUser } from '../middleware/auth.js';
import { AppError } from '../utils/errors.js';
import { assertShopAccess } from './repairs.js';
import { writeAudit } from './audit.js';
import { notify } from './notifications.js';
import {
  canonicalizeTransferStatus,
  formatExpectedArrival,
  transferStatusAliases
} from './readiness.js';
import { reserveStock } from './inventory.js';
import type { TransferStatus } from '../types/roles.js';

export { canonicalizeTransferStatus, transferStatusAliases };

function pushHistory(
  transfer: InstanceType<typeof StockTransfer>,
  status: TransferStatus,
  userId: string,
  note = ''
) {
  transfer.history = transfer.history || [];
  transfer.history.push({
    status,
    at: new Date(),
    by: userId as unknown as mongoose.Types.ObjectId,
    note
  });
}

export function serializeTransfer(transfer: InstanceType<typeof StockTransfer>) {
  const arrival = formatExpectedArrival({
    expectedArrivalDate: transfer.expectedArrivalDate,
    expectedArrivalConfirmed: transfer.expectedArrivalConfirmed
  });
  const obj = transfer.toObject({ virtuals: true });
  return {
    ...obj,
    status: transfer.status,
    canonicalStatus: canonicalizeTransferStatus(transfer.status),
    statusAliases: transferStatusAliases(transfer.status),
    expectedArrivalDisplay: arrival.display,
    expectedArrivalConfirmed: arrival.confirmed,
    expectedArrivalIso: arrival.iso
  };
}

export async function requestTransfer(input: {
  user: AuthUser;
  fromPartId: string;
  toShopId: string;
  quantity: number;
  reason?: string;
  repairRequestId?: string;
  partsRequestId?: string;
  expectedArrivalDate?: string;
  expectedArrivalConfirmed?: boolean;
  reserveOnReceive?: boolean;
}) {
  const fromPart = await Part.findById(input.fromPartId);
  if (!fromPart || !fromPart.isActive) throw new AppError('Part not found', 404, 'NOT_FOUND');
  assertShopAccess(input.user, fromPart.shop.toString());
  if (fromPart.shop.toString() === input.toShopId) {
    throw new AppError('Cannot transfer to the same shop', 400, 'INVALID_TRANSFER');
  }
  if (fromPart.quantityAvailable < input.quantity) {
    throw new AppError('Insufficient available stock', 409, 'INSUFFICIENT_STOCK');
  }

  if (input.partsRequestId) {
    const pr = await PartsRequest.findById(input.partsRequestId);
    if (!pr) throw new AppError('Parts request not found', 404, 'NOT_FOUND');
    if (pr.shop.toString() !== input.toShopId) {
      throw new AppError('Parts request shop must match destination shop', 400, 'INVALID_TRANSFER');
    }
  }

  const confirmed = Boolean(input.expectedArrivalConfirmed && input.expectedArrivalDate);

  const transfer = await StockTransfer.create({
    partSku: fromPart.sku,
    partName: fromPart.name,
    fromShop: fromPart.shop,
    toShop: input.toShopId,
    fromPart: fromPart._id,
    quantity: input.quantity,
    status: 'requested',
    requestedBy: input.user.id,
    reason: input.reason || '',
    repairRequest: input.repairRequestId || undefined,
    partsRequest: input.partsRequestId || undefined,
    expectedArrivalDate: confirmed ? new Date(input.expectedArrivalDate!) : undefined,
    expectedArrivalConfirmed: confirmed,
    reserveOnReceive: Boolean(input.reserveOnReceive || input.partsRequestId),
    history: [
      {
        status: 'requested',
        at: new Date(),
        by: input.user.id,
        note: input.reason || 'Transfer requested'
      }
    ]
  });

  await writeAudit({
    actor: input.user.id,
    action: 'transfer.request',
    entityType: 'StockTransfer',
    entityId: transfer._id,
    shop: fromPart.shop,
    details: {
      quantity: input.quantity,
      toShop: input.toShopId,
      repairRequestId: input.repairRequestId,
      expectedArrivalDisplay: formatExpectedArrival({
        expectedArrivalDate: transfer.expectedArrivalDate,
        expectedArrivalConfirmed: transfer.expectedArrivalConfirmed
      }).display
    }
  });

  if (input.repairRequestId) {
    try {
      const { recordTrackingEvent } = await import('./trackingEvents.js');
      const { RepairRequest } = await import('../models/index.js');
      const repair = await RepairRequest.findById(input.repairRequestId);
      if (repair) {
        await recordTrackingEvent({
          repairId: repair._id,
          eventKey: 'transfer_requested',
          customerId: repair.customer,
          dedupeKey: `transfer_requested:${transfer._id}`
        });
        if (!confirmed) {
          await recordTrackingEvent({
            repairId: repair._id,
            eventKey: 'arrival_unconfirmed',
            customerId: repair.customer,
            dedupeKey: `arrival_unconfirmed:${transfer._id}`
          });
        }
      }
    } catch {
      /* non-fatal */
    }
  }

  return serializeTransfer(transfer);
}

export async function approveTransfer(transferId: string, user: AuthUser) {
  const transfer = await StockTransfer.findById(transferId);
  if (!transfer) throw new AppError('Transfer not found', 404, 'NOT_FOUND');
  assertShopAccess(user, transfer.fromShop.toString());
  if (transfer.status !== 'requested') {
    throw new AppError('Transfer is not awaiting approval', 409, 'INVALID_STATE');
  }
  // Explicit workflow status: awaiting supplier/shop transfer
  transfer.status = 'awaiting_transfer';
  transfer.approvedBy = user.id as unknown as typeof transfer.approvedBy;
  pushHistory(transfer, 'awaiting_transfer', user.id, 'Awaiting supplier or shop transfer');
  await transfer.save();
  return serializeTransfer(transfer);
}

export async function rejectTransfer(transferId: string, user: AuthUser, notes?: string) {
  const transfer = await StockTransfer.findById(transferId);
  if (!transfer) throw new AppError('Transfer not found', 404, 'NOT_FOUND');
  assertShopAccess(user, transfer.fromShop.toString());
  if (!['requested', 'awaiting_transfer', 'approved'].includes(transfer.status)) {
    throw new AppError('Transfer cannot be rejected in current status', 409, 'INVALID_STATE');
  }
  transfer.status = 'rejected';
  transfer.notes = notes || transfer.notes;
  transfer.approvedBy = user.id as unknown as typeof transfer.approvedBy;
  pushHistory(transfer, 'rejected', user.id, notes || 'Rejected');
  await transfer.save();
  return serializeTransfer(transfer);
}

export async function cancelTransfer(transferId: string, user: AuthUser, notes?: string) {
  const transfer = await StockTransfer.findById(transferId);
  if (!transfer) throw new AppError('Transfer not found', 404, 'NOT_FOUND');
  assertShopAccess(user, transfer.fromShop.toString());
  if (['received', 'reserved', 'rejected', 'cancelled', 'in_transit', 'dispatched'].includes(transfer.status)) {
    throw new AppError('Transfer cannot be cancelled in current status', 409, 'INVALID_STATE');
  }
  transfer.status = 'cancelled';
  transfer.notes = notes || transfer.notes;
  pushHistory(transfer, 'cancelled', user.id, notes || 'Cancelled');
  await transfer.save();
  return serializeTransfer(transfer);
}

export async function dispatchTransfer(transferId: string, user: AuthUser) {
  const transfer = await StockTransfer.findById(transferId);
  if (!transfer) throw new AppError('Transfer not found', 404, 'NOT_FOUND');
  assertShopAccess(user, transfer.fromShop.toString());
  if (!['awaiting_transfer', 'approved'].includes(transfer.status)) {
    throw new AppError('Transfer must be awaiting transfer before dispatch', 409, 'INVALID_STATE');
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const fromPart = await Part.findOneAndUpdate(
      {
        _id: transfer.fromPart,
        quantityAvailable: { $gte: transfer.quantity }
      },
      { $inc: { quantityAvailable: -transfer.quantity } },
      { new: true, session }
    );
    if (!fromPart) {
      throw new AppError('Insufficient stock to dispatch', 409, 'INSUFFICIENT_STOCK');
    }

    await InventoryMovement.create(
      [
        {
          part: fromPart._id,
          shop: fromPart.shop,
          type: 'transfer_out',
          quantity: -transfer.quantity,
          balanceAfterAvailable: fromPart.quantityAvailable,
          balanceAfterReserved: fromPart.quantityReserved,
          performedBy: user.id,
          referenceType: 'StockTransfer',
          referenceId: transfer._id,
          notes: `Transfer to shop ${transfer.toShop}`
        }
      ],
      { session }
    );

    transfer.status = 'in_transit';
    transfer.dispatchedBy = user.id as unknown as typeof transfer.dispatchedBy;
    pushHistory(transfer, 'in_transit', user.id, 'In transit');
    await transfer.save({ session });
    await session.commitTransaction();
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }

  const updated = await StockTransfer.findById(transferId);
  if (updated?.repairRequest) {
    try {
      const { recordTrackingEvent } = await import('./trackingEvents.js');
      const { RepairRequest } = await import('../models/index.js');
      const repair = await RepairRequest.findById(updated.repairRequest);
      if (repair) {
        await recordTrackingEvent({
          repairId: repair._id,
          eventKey: 'parts_in_transit',
          customerId: repair.customer,
          dedupeKey: `parts_in_transit:${updated._id}`
        });
      }
    } catch {
      /* non-fatal */
    }
  }
  return updated ? serializeTransfer(updated) : null;
}

/**
 * Physical receive confirmation only. Never marks stock received without this call.
 * Duplicate receive is rejected. Optional atomic reserve against linked parts request.
 */
export async function receiveTransfer(transferId: string, user: AuthUser) {
  const transfer = await StockTransfer.findById(transferId);
  if (!transfer) throw new AppError('Transfer not found', 404, 'NOT_FOUND');
  assertShopAccess(user, transfer.toShop.toString());

  if (['received', 'reserved'].includes(transfer.status)) {
    throw new AppError('Transfer already received', 409, 'ALREADY_RECEIVED');
  }
  if (!['in_transit', 'dispatched'].includes(transfer.status)) {
    throw new AppError('Transfer must be in transit before receiving', 409, 'INVALID_STATE');
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    // Re-load inside txn to prevent concurrent double-receive
    const locked = await StockTransfer.findById(transferId).session(session);
    if (!locked) throw new AppError('Transfer not found', 404, 'NOT_FOUND');
    if (['received', 'reserved'].includes(locked.status)) {
      throw new AppError('Transfer already received', 409, 'ALREADY_RECEIVED');
    }
    if (!['in_transit', 'dispatched'].includes(locked.status)) {
      throw new AppError('Transfer must be in transit before receiving', 409, 'INVALID_STATE');
    }

    let toPart = await Part.findOne({ shop: locked.toShop, sku: locked.partSku }).session(session);
    if (!toPart) {
      const fromPart = await Part.findById(locked.fromPart).session(session);
      const created = await Part.create(
        [
          {
            shop: locked.toShop,
            sku: locked.partSku,
            name: locked.partName,
            description: fromPart?.description || '',
            category: fromPart?.category || 'general',
            quantityAvailable: 0,
            quantityReserved: 0,
            reorderLevel: fromPart?.reorderLevel || 2,
            unitCost: fromPart?.unitCost || 0,
            supplier: fromPart?.supplier || '',
            supplierSku: fromPart?.supplierSku || ''
          }
        ],
        { session }
      );
      toPart = created[0];
    }
    if (!toPart) throw new AppError('Unable to resolve destination part', 500, 'TRANSFER_ERROR');

    toPart.quantityAvailable += locked.quantity;
    await toPart.save({ session });

    await InventoryMovement.create(
      [
        {
          part: toPart._id,
          shop: toPart.shop,
          type: 'transfer_in',
          quantity: locked.quantity,
          balanceAfterAvailable: toPart.quantityAvailable,
          balanceAfterReserved: toPart.quantityReserved,
          performedBy: user.id,
          referenceType: 'StockTransfer',
          referenceId: locked._id,
          notes: `Transfer from shop ${locked.fromShop}`
        }
      ],
      { session }
    );

    locked.toPart = toPart._id;
    locked.status = 'received';
    locked.receivedBy = user.id as unknown as typeof locked.receivedBy;
    locked.receivedAt = new Date();
    pushHistory(locked, 'received', user.id, 'Physically received');
    await locked.save({ session });
    await session.commitTransaction();
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }

  let updated = await StockTransfer.findById(transferId);
  if (!updated) throw new AppError('Transfer not found', 404, 'NOT_FOUND');

  // After confirmed receipt, optionally reserve against the linked repair parts request.
  if (updated.reserveOnReceive && updated.partsRequest) {
    try {
      await reserveStock({
        partsRequestId: updated.partsRequest.toString(),
        quantity: updated.quantity,
        userId: user.id
      });
      updated.status = 'reserved';
      updated.reservedAt = new Date();
      pushHistory(updated, 'reserved', user.id, 'Reserved for linked repair');
      await updated.save();
    } catch (err) {
      // Stock is received; reservation may fail if qty already fulfilled — leave as received.
      if (!(err instanceof AppError && err.code === 'ALREADY_FULFILLED')) {
        // Keep received; caller can reserve manually.
      }
    }
  }

  updated = await StockTransfer.findById(transferId);
  await notify({
    user: transfer.requestedBy,
    type: 'transfer_received',
    title: 'Stock transfer received',
    message: `${transfer.quantity} × ${transfer.partSku} received at destination shop`
  });

  if (updated?.repairRequest) {
    try {
      const { recordTrackingEvent } = await import('./trackingEvents.js');
      const { RepairRequest } = await import('../models/index.js');
      const repair = await RepairRequest.findById(updated.repairRequest);
      if (repair) {
        await recordTrackingEvent({
          repairId: repair._id,
          eventKey: 'parts_received',
          customerId: repair.customer,
          dedupeKey: `parts_received:${updated._id}`
        });
      }
    } catch {
      /* non-fatal */
    }
  }

  return updated ? serializeTransfer(updated) : null;
}
