import mongoose from 'mongoose';
import { Part } from '../models/Part.js';
import { PartsRequest } from '../models/PartsRequest.js';
import { PartsReservation } from '../models/PartsReservation.js';
import { InventoryMovement } from '../models/InventoryMovement.js';
import { RepairRequest } from '../models/RepairRequest.js';
import { AppError } from '../utils/errors.js';
import { transitionStatus } from './status.js';
import { writeAudit } from './audit.js';

export async function stockIn(input: {
  partId: string;
  quantity: number;
  userId: string;
  notes?: string;
  referenceType?: string;
  referenceId?: string;
  session?: mongoose.ClientSession;
}) {
  if (input.quantity <= 0) {
    throw new AppError('Quantity must be positive', 400, 'INVALID_QUANTITY');
  }

  const part = await Part.findByIdAndUpdate(
    input.partId,
    { $inc: { quantityAvailable: input.quantity } },
    { new: true, session: input.session }
  );
  if (!part) throw new AppError('Part not found', 404, 'NOT_FOUND');

  await InventoryMovement.create(
    [
      {
        part: part._id,
        shop: part.shop,
        type: 'stock_in',
        quantity: input.quantity,
        balanceAfterAvailable: part.quantityAvailable,
        balanceAfterReserved: part.quantityReserved,
        performedBy: input.userId,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        notes: input.notes || 'Stock arrival'
      }
    ],
    { session: input.session }
  );

  await writeAudit({
    actor: input.userId,
    action: 'inventory.stock_in',
    entityType: 'Part',
    entityId: part._id,
    shop: part.shop,
    details: { quantity: input.quantity, referenceType: input.referenceType },
    session: input.session
  });

  return part;
}

export async function adjustStock(input: {
  partId: string;
  quantityDelta: number;
  reason: string;
  userId: string;
}) {
  if (!input.reason || input.reason.trim().length < 3) {
    throw new AppError('Adjustment reason is required', 400, 'REASON_REQUIRED');
  }
  if (input.quantityDelta === 0) {
    throw new AppError('Quantity delta cannot be zero', 400, 'INVALID_QUANTITY');
  }

  const filter: Record<string, unknown> = { _id: input.partId };
  if (input.quantityDelta < 0) {
    filter.quantityAvailable = { $gte: Math.abs(input.quantityDelta) };
  }

  const part = await Part.findOneAndUpdate(
    filter,
    { $inc: { quantityAvailable: input.quantityDelta } },
    { new: true }
  );
  if (!part) {
    throw new AppError(
      input.quantityDelta < 0 ? 'Insufficient stock for adjustment' : 'Part not found',
      input.quantityDelta < 0 ? 409 : 404,
      input.quantityDelta < 0 ? 'INSUFFICIENT_STOCK' : 'NOT_FOUND'
    );
  }

  await InventoryMovement.create({
    part: part._id,
    shop: part.shop,
    type: 'adjust',
    quantity: input.quantityDelta,
    balanceAfterAvailable: part.quantityAvailable,
    balanceAfterReserved: part.quantityReserved,
    performedBy: input.userId,
    notes: input.reason
  });

  await writeAudit({
    actor: input.userId,
    action: 'inventory.adjust',
    entityType: 'Part',
    entityId: part._id,
    shop: part.shop,
    details: { quantityDelta: input.quantityDelta, reason: input.reason }
  });

  return part;
}

function isTransientTxnError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as {
    code?: number;
    codeName?: string;
    errorLabels?: string[];
    hasErrorLabel?: (l: string) => boolean;
  };
  if (e.code === 112 || e.codeName === 'WriteConflict') return true;
  if (typeof e.hasErrorLabel === 'function') {
    if (e.hasErrorLabel('TransientTransactionError') || e.hasErrorLabel('UnknownTransactionCommitResult')) {
      return true;
    }
  }
  return (
    Array.isArray(e.errorLabels) &&
    (e.errorLabels.includes('TransientTransactionError') ||
      e.errorLabels.includes('UnknownTransactionCommitResult'))
  );
}

/** Safe diagnostic snapshot — never includes credentials or URIs. */
export function describeReserveError(err: unknown): Record<string, unknown> {
  if (err instanceof AppError) {
    return {
      kind: 'AppError',
      statusCode: err.statusCode,
      code: err.code,
      message: err.message,
      details: err.details
    };
  }
  if (err && typeof err === 'object') {
    const e = err as {
      name?: string;
      message?: string;
      code?: number | string;
      codeName?: string;
      errorLabels?: string[];
      keyPattern?: unknown;
      keyValue?: unknown;
    };
    return {
      kind: e.name || 'Error',
      message: e.message,
      code: e.code,
      codeName: e.codeName,
      errorLabels: e.errorLabels,
      keyPattern: e.keyPattern,
      keyValue: e.keyValue
    };
  }
  return { kind: 'unknown', message: String(err) };
}

/**
 * Atomic conditional reservation — succeeds only when quantityAvailable >= qty.
 * Uses withTransaction + per-call session. Does not parallelize ops on one session.
 */
export async function reserveStock(input: {
  partsRequestId: string;
  quantity: number;
  userId: string;
}) {
  const maxAttempts = 8;
  let lastErr: unknown;

  type ReserveResult = {
    part: InstanceType<typeof Part>;
    partsRequest: InstanceType<typeof PartsRequest>;
    reservation: InstanceType<typeof PartsReservation>;
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const session = await mongoose.startSession();
    try {
      let result: ReserveResult | null = null;

      await session.withTransaction(async () => {
        const partsRequest = await PartsRequest.findById(input.partsRequestId).session(session);
        if (!partsRequest) {
          throw new AppError('Parts request not found', 404, 'NOT_FOUND');
        }
        if (!['pending', 'partially_fulfilled'].includes(partsRequest.status)) {
          throw new AppError('Parts request is not open for fulfillment', 409, 'INVALID_STATE');
        }

        const remainingNeeded =
          partsRequest.quantityRequested - partsRequest.quantityFulfilled;
        const qty = Math.min(input.quantity, remainingNeeded);
        if (qty <= 0) {
          throw new AppError('Nothing left to fulfill', 409, 'ALREADY_FULFILLED');
        }

        // Atomic conditional decrement — loser of the race gets null
        const part = await Part.findOneAndUpdate(
          {
            _id: partsRequest.part,
            quantityAvailable: { $gte: qty }
          },
          {
            $inc: { quantityAvailable: -qty, quantityReserved: qty }
          },
          { new: true, session }
        );

        if (!part) {
          const current = await Part.findById(partsRequest.part).session(session);
          const available = current?.quantityAvailable ?? 0;
          const shortage = Math.max(0, qty - available);
          // Do not write shortage inside this txn (it would roll back on throw).
          // Surface INSUFFICIENT_STOCK; caller/catch updates shortage outside.
          throw new AppError(
            `Insufficient stock. Available: ${available}, requested: ${qty}, shortage: ${shortage}`,
            409,
            'INSUFFICIENT_STOCK',
            { available, requested: qty, shortage, remainingNeeded }
          );
        }

        const [reservation] = await PartsReservation.create(
          [
            {
              partsRequest: partsRequest._id,
              repairRequest: partsRequest.repairRequest,
              part: part._id,
              shop: partsRequest.shop,
              quantity: qty,
              status: 'active',
              reservedBy: input.userId
            }
          ],
          { session }
        );

        partsRequest.quantityFulfilled += qty;
        partsRequest.quantityShortage = Math.max(
          0,
          partsRequest.quantityRequested - partsRequest.quantityFulfilled
        );
        if (partsRequest.quantityFulfilled >= partsRequest.quantityRequested) {
          partsRequest.status = 'fulfilled';
        } else {
          partsRequest.status = 'partially_fulfilled';
        }
        await partsRequest.save({ session });

        await InventoryMovement.create(
          [
            {
              part: part._id,
              shop: part.shop,
              type: 'reserve',
              quantity: qty,
              balanceAfterAvailable: part.quantityAvailable,
              balanceAfterReserved: part.quantityReserved,
              performedBy: input.userId,
              referenceType: 'PartsReservation',
              referenceId: reservation._id,
              notes: 'Stock reserved for repair'
            }
          ],
          { session }
        );

        // Advance repair status when reservations complete. Never fail a valid
        // reservation because the repair is already past this stage
        // (e.g. isolated concurrency fixtures attached to a completed repair).
        if (partsRequest.status === 'fulfilled') {
          const repair = await RepairRequest.findById(partsRequest.repairRequest).session(session);
          if (
            repair &&
            ['estimate_approved', 'awaiting_parts', 'parts_reserved'].includes(repair.status)
          ) {
            if (repair.status !== 'parts_reserved') {
              await transitionStatus(
                repair._id,
                'parts_reserved',
                input.userId,
                'All requested parts reserved',
                session
              );
            }

            // Dual-condition: if latest estimate is still approved, mark ready_to_start.
            const { evaluateRepairReadiness } = await import('./readiness.js');
            const readiness = await evaluateRepairReadiness(repair._id, session);
            if (readiness.canStartRepair) {
              await transitionStatus(
                repair._id,
                'ready_to_start',
                input.userId,
                'Dual conditions satisfied — ready to start',
                session
              );
            }
          }
        }

        result = { part, partsRequest, reservation };
      });

      if (!result) {
        throw new AppError('Reservation transaction produced no result', 500, 'RESERVE_FAILED');
      }
      const committed: ReserveResult = result;

      // Emit customer-visible tracking only after successful commit
      try {
        const { recordTrackingEvent } = await import('./trackingEvents.js');
        const repairId = committed.partsRequest.repairRequest;
        const reservationId = committed.reservation._id;
        const repair = await RepairRequest.findById(repairId);
        if (repair) {
          await recordTrackingEvent({
            repairId: repair._id,
            eventKey: 'parts_reserved',
            customerId: repair.customer,
            dedupeKey: `parts_reserved:${reservationId}`
          });
        }
      } catch {
        /* non-fatal for reservation success */
      }

      return committed;
    } catch (err) {
      lastErr = err;
      if (err instanceof AppError) {
        if (err.code === 'INSUFFICIENT_STOCK') {
          const details = (err.details || {}) as { shortage?: number };
          await PartsRequest.findByIdAndUpdate(input.partsRequestId, {
            $set: { quantityShortage: details.shortage ?? input.quantity }
          });
          try {
            const pr = await PartsRequest.findById(input.partsRequestId);
            if (pr) {
              const repair = await RepairRequest.findById(pr.repairRequest);
              if (repair) {
                const { recordTrackingEvent } = await import('./trackingEvents.js');
                await recordTrackingEvent({
                  repairId: repair._id,
                  eventKey: 'parts_unavailable',
                  customerId: repair.customer,
                  dedupeKey: `parts_unavailable:${pr._id}:${Date.now()}`
                });
              }
            }
          } catch {
            /* non-fatal */
          }
        }
        throw err;
      }
      if (isTransientTxnError(err) && attempt < maxAttempts) {
        // Brief backoff before retrying transient write conflicts
        await new Promise((r) => setTimeout(r, 20 * attempt));
        continue;
      }
      // Do NOT convert unexpected DB failures into INSUFFICIENT_STOCK
      throw err;
    } finally {
      session.endSession();
    }
  }

  throw (
    lastErr ||
    new AppError('Unable to reserve stock after retries', 500, 'RESERVE_FAILED')
  );
}

export async function releaseReservation(input: {
  reservationId: string;
  userId: string;
}) {
  const session = await mongoose.startSession();
  try {
    let outcome: {
      part: InstanceType<typeof Part>;
      reservation: InstanceType<typeof PartsReservation>;
    } | null = null;

    await session.withTransaction(async () => {
      const reservation = await PartsReservation.findById(input.reservationId).session(session);
      if (!reservation || reservation.status !== 'active') {
        throw new AppError('Active reservation not found', 404, 'NOT_FOUND');
      }

      const part = await Part.findOneAndUpdate(
        { _id: reservation.part, quantityReserved: { $gte: reservation.quantity } },
        {
          $inc: {
            quantityAvailable: reservation.quantity,
            quantityReserved: -reservation.quantity
          }
        },
        { new: true, session }
      );
      if (!part) {
        throw new AppError('Unable to release reservation — inventory mismatch', 409, 'INVENTORY_ERROR');
      }

      reservation.status = 'released';
      reservation.releasedAt = new Date();
      await reservation.save({ session });

      await InventoryMovement.create(
        [
          {
            part: part._id,
            shop: part.shop,
            type: 'release',
            quantity: reservation.quantity,
            balanceAfterAvailable: part.quantityAvailable,
            balanceAfterReserved: part.quantityReserved,
            performedBy: input.userId,
            referenceType: 'PartsReservation',
            referenceId: reservation._id
          }
        ],
        { session }
      );

      outcome = { part, reservation };
    });

    if (!outcome) throw new AppError('Release failed', 500, 'RELEASE_FAILED');
    return outcome;
  } finally {
    session.endSession();
  }
}

export async function consumeReservationsForRepair(
  repairRequestId: string,
  userId: string,
  session?: mongoose.ClientSession
) {
  const reservations = await PartsReservation.find({
    repairRequest: repairRequestId,
    status: 'active'
  }).session(session ?? null);

  for (const reservation of reservations) {
    const part = await Part.findOneAndUpdate(
      { _id: reservation.part, quantityReserved: { $gte: reservation.quantity } },
      { $inc: { quantityReserved: -reservation.quantity } },
      { new: true, session: session ?? undefined }
    );
    if (!part) {
      throw new AppError('Inventory inconsistency during consumption', 409, 'INVENTORY_ERROR');
    }
    reservation.status = 'consumed';
    reservation.consumedAt = new Date();
    await reservation.save({ session: session ?? undefined });

    await InventoryMovement.create(
      [
        {
          part: part._id,
          shop: part.shop,
          type: 'stock_out',
          quantity: reservation.quantity,
          balanceAfterAvailable: part.quantityAvailable,
          balanceAfterReserved: part.quantityReserved,
          performedBy: userId,
          referenceType: 'RepairRequest',
          referenceId: repairRequestId,
          notes: 'Parts consumed for completed repair'
        }
      ],
      session ? { session } : undefined
    );
  }
}
