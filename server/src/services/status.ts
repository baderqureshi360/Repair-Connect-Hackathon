import mongoose from 'mongoose';
import { RepairRequest } from '../models/RepairRequest.js';
import { RepairStatusHistory } from '../models/RepairStatusHistory.js';
import { STATUS_TRANSITIONS, type RepairStatus } from '../types/roles.js';
import { AppError } from '../utils/errors.js';

export async function transitionStatus(
  repairId: string | mongoose.Types.ObjectId,
  toStatus: RepairStatus,
  changedBy: string | mongoose.Types.ObjectId,
  note = '',
  session?: mongoose.ClientSession
) {
  const repair = await RepairRequest.findById(repairId).session(session ?? null);
  if (!repair) {
    throw new AppError('Repair request not found', 404, 'NOT_FOUND');
  }

  const fromStatus = repair.status as RepairStatus;
  const allowed = STATUS_TRANSITIONS[fromStatus] || [];
  if (!allowed.includes(toStatus)) {
    throw new AppError(
      `Invalid status transition from ${fromStatus} to ${toStatus}`,
      409,
      'INVALID_TRANSITION',
      { fromStatus, toStatus, allowed }
    );
  }

  repair.status = toStatus;
  if (toStatus === 'ready_for_collection' && !repair.workCompletedAt) {
    repair.workCompletedAt = new Date();
  }
  if (toStatus === 'completed') {
    if (!repair.collectedAt) repair.collectedAt = new Date();
    repair.completedAt = repair.collectedAt;
  }
  await repair.save({ session: session ?? undefined });

  await RepairStatusHistory.create(
    [
      {
        repairRequest: repair._id,
        fromStatus,
        toStatus,
        changedBy,
        note
      }
    ],
    session ? { session } : undefined
  );

  return repair;
}
