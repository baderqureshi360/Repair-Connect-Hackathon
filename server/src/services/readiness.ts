import mongoose from 'mongoose';
import { PartsRequest, RepairEstimate, RepairRequest } from '../models/index.js';
import { AppError } from '../utils/errors.js';

export type PartsRequirementStatus = 'undetermined' | 'not_required' | 'required';

export type RepairReadiness = {
  canStartRepair: boolean;
  latestEstimateApproved: boolean;
  partsRequirementStatus: PartsRequirementStatus;
  partsRequirementDetermined: boolean;
  allRequiredPartsReserved: boolean;
  reservationsMatchRequirements: boolean;
  latestEstimateId: string | null;
  latestEstimateVersion: number | null;
  openPartsRequestIds: string[];
  mismatchedPartsRequestIds: string[];
  reasons: string[];
  workflowStage: string;
  customerMessage: string;
  staffMessage: string;
};

/**
 * Server-side dual-condition readiness with explicit parts requirement:
 * canStartRepair =
 *   latestEstimate.status === "approved"
 *   AND partsRequirement.status !== "undetermined"
 *   AND (not_required OR all required parts for that estimate version are reserved)
 */
export async function evaluateRepairReadiness(
  repairId: string | mongoose.Types.ObjectId,
  session?: mongoose.ClientSession
): Promise<RepairReadiness> {
  const repair = await RepairRequest.findById(repairId).session(session ?? null);
  if (!repair) {
    throw new AppError('Repair not found', 404, 'NOT_FOUND');
  }

  const latestEstimate = await RepairEstimate.findOne({ repairRequest: repair._id })
    .sort({ version: -1 })
    .session(session ?? null);

  const latestEstimateApproved = latestEstimate?.status === 'approved';
  const latestEstimateId = latestEstimate?._id?.toString() ?? null;
  const latestEstimateVersion = latestEstimate?.version ?? null;

  const partsRequirementStatus = (repair.partsRequirement?.status ||
    'undetermined') as PartsRequirementStatus;
  const partsRequirementDetermined = partsRequirementStatus !== 'undetermined';

  // Active requirements for the latest estimate version only.
  const requiredParts = latestEstimate
    ? await PartsRequest.find({
        repairRequest: repair._id,
        estimateVersion: latestEstimate.version,
        status: { $nin: ['rejected', 'superseded'] }
      }).session(session ?? null)
    : [];

  const openParts = requiredParts.filter((p) =>
    ['pending', 'approved', 'partially_fulfilled'].includes(p.status)
  );
  const openPartsRequestIds = openParts.map((p) => p._id.toString());

  const mismatched = await PartsRequest.find({
    repairRequest: repair._id,
    status: { $in: ['pending', 'approved', 'partially_fulfilled', 'fulfilled'] },
    $or: [
      { estimateVersion: { $ne: latestEstimateVersion } },
      { estimateVersion: { $exists: false } },
      { estimateVersion: null }
    ]
  })
    .select('_id')
    .session(session ?? null);
  const mismatchedPartsRequestIds = mismatched.map((p) => p._id.toString());

  let allRequiredPartsReserved = false;
  let reservationsMatchRequirements = mismatchedPartsRequestIds.length === 0;

  if (partsRequirementStatus === 'not_required') {
    allRequiredPartsReserved = true;
    // Confirm declaration is bound to the latest approved estimate when present
    if (
      latestEstimate &&
      repair.partsRequirement?.estimateVersion != null &&
      repair.partsRequirement.estimateVersion !== latestEstimate.version
    ) {
      reservationsMatchRequirements = false;
    }
  } else if (partsRequirementStatus === 'required') {
    allRequiredPartsReserved =
      requiredParts.length > 0 &&
      openPartsRequestIds.length === 0 &&
      requiredParts.every((p) => p.status === 'fulfilled');
  }

  const reasons: string[] = [];
  if (!latestEstimate) {
    reasons.push('No estimate submitted');
  } else if (!latestEstimateApproved) {
    reasons.push(
      latestEstimate.status === 'pending'
        ? 'Latest estimate awaits customer approval'
        : 'Latest estimate was rejected'
    );
  }
  if (partsRequirementStatus === 'undetermined') {
    reasons.push('Parts requirement is undetermined — confirm parts needed or not required');
  }
  if (partsRequirementStatus === 'required' && !allRequiredPartsReserved) {
    reasons.push('Required parts are not fully reserved for the latest estimate');
  }
  if (!reservationsMatchRequirements) {
    reasons.push('Parts reservations do not match the latest estimate requirements');
  }

  const canStartRepair =
    latestEstimateApproved &&
    partsRequirementDetermined &&
    allRequiredPartsReserved &&
    reservationsMatchRequirements;

  const { workflowStage, customerMessage, staffMessage } = deriveWorkflowMessages({
    status: repair.status,
    canStartRepair,
    latestEstimateApproved,
    partsRequirementStatus,
    allRequiredPartsReserved,
    hasOpenParts: openPartsRequestIds.length > 0,
    collectedAt: repair.collectedAt
  });

  return {
    canStartRepair,
    latestEstimateApproved,
    partsRequirementStatus,
    partsRequirementDetermined,
    allRequiredPartsReserved,
    reservationsMatchRequirements,
    latestEstimateId,
    latestEstimateVersion,
    openPartsRequestIds,
    mismatchedPartsRequestIds,
    reasons,
    workflowStage,
    customerMessage,
    staffMessage
  };
}

export async function assertCanStartRepair(
  repairId: string | mongoose.Types.ObjectId,
  session?: mongoose.ClientSession
) {
  const readiness = await evaluateRepairReadiness(repairId, session);
  if (!readiness.canStartRepair) {
    throw new AppError(
      'Repair cannot start until the latest estimate is approved, parts requirement is determined, and required parts are reserved',
      409,
      'NOT_READY',
      {
        latestEstimateApproved: readiness.latestEstimateApproved,
        partsRequirementStatus: readiness.partsRequirementStatus,
        allRequiredPartsReserved: readiness.allRequiredPartsReserved,
        reservationsMatchRequirements: readiness.reservationsMatchRequirements,
        latestEstimateId: readiness.latestEstimateId,
        openPartsRequestIds: readiness.openPartsRequestIds,
        reasons: readiness.reasons
      }
    );
  }
  return readiness;
}

function deriveWorkflowMessages(input: {
  status: string;
  canStartRepair: boolean;
  latestEstimateApproved: boolean;
  partsRequirementStatus: PartsRequirementStatus;
  allRequiredPartsReserved: boolean;
  hasOpenParts: boolean;
  collectedAt?: Date | null;
}) {
  const { status, canStartRepair, latestEstimateApproved, partsRequirementStatus, hasOpenParts } =
    input;

  if (status === 'estimate_pending') {
    return {
      workflowStage: 'awaiting_customer_approval',
      customerMessage: 'Awaiting your approval.',
      staffMessage: 'Awaiting customer approval of the latest estimate.'
    };
  }
  if (status === 'estimate_rejected') {
    return {
      workflowStage: 'estimate_rejected',
      customerMessage: 'Estimate rejected — waiting for a revised quote.',
      staffMessage: 'Customer rejected the estimate. Submit a revised version.'
    };
  }
  if (latestEstimateApproved && partsRequirementStatus === 'undetermined') {
    return {
      workflowStage: 'parts_requirement_undetermined',
      customerMessage: 'Quote approved — workshop is confirming parts needs.',
      staffMessage: 'Confirm whether replacement parts are required before starting.'
    };
  }
  // Prefer readiness over stale status — reservations can fulfill before status catches up.
  if (
    canStartRepair &&
    ['estimate_approved', 'awaiting_parts', 'parts_reserved', 'ready_to_start'].includes(status)
  ) {
    return {
      workflowStage: 'ready_to_start',
      customerMessage: 'Ready to start.',
      staffMessage: 'Ready to start — dual approval and parts requirement satisfied.'
    };
  }
  if (
    status === 'awaiting_parts' ||
    (latestEstimateApproved && partsRequirementStatus === 'required' && hasOpenParts)
  ) {
    return {
      workflowStage: 'awaiting_parts',
      customerMessage: 'Quote approved, awaiting part reservation.',
      staffMessage: 'Quote approved, awaiting part reservation.'
    };
  }
  if (status === 'in_progress') {
    return {
      workflowStage: 'in_repair',
      customerMessage: 'Repair in progress.',
      staffMessage: 'Repair in progress.'
    };
  }
  if (status === 'ready_for_collection') {
    if (input.collectedAt) {
      return {
        workflowStage: 'collected_pending_closure',
        customerMessage: 'Device collected — awaiting case closure.',
        staffMessage: 'Collection confirmed — settle payment if needed, then close the case.'
      };
    }
    return {
      workflowStage: 'ready_for_collection',
      customerMessage: 'Ready for collection.',
      staffMessage: 'Device ready for collection — confirm handover, then close the case after payment.'
    };
  }
  if (status === 'completed') {
    return {
      workflowStage: 'collected_closed',
      customerMessage: 'Collected / closed.',
      staffMessage: 'Repair collected and closed.'
    };
  }
  if (status === 'cancelled') {
    return {
      workflowStage: 'cancelled',
      customerMessage: 'Repair cancelled.',
      staffMessage: 'Repair cancelled.'
    };
  }

  return {
    workflowStage: status,
    customerMessage: status.replaceAll('_', ' '),
    staffMessage: status.replaceAll('_', ' ')
  };
}

/** Display helper — never present unverified dates as confirmed. */
export function formatExpectedArrival(input: {
  expectedArrivalDate?: Date | string | null;
  expectedArrivalConfirmed?: boolean | null;
}): { display: string; confirmed: boolean; iso: string | null } {
  const confirmed = Boolean(input.expectedArrivalConfirmed && input.expectedArrivalDate);
  if (!confirmed) {
    return { display: 'Unconfirmed', confirmed: false, iso: null };
  }
  const date = new Date(input.expectedArrivalDate as Date | string);
  return {
    display: date.toISOString().slice(0, 10),
    confirmed: true,
    iso: date.toISOString()
  };
}

/** Canonical transfer status mapping — preserves legacy aliases. */
export function canonicalizeTransferStatus(status: string): string {
  if (status === 'approved') return 'awaiting_transfer';
  if (status === 'dispatched') return 'in_transit';
  return status;
}

export function transferStatusAliases(canonicalOrLegacy: string): string[] {
  const canonical = canonicalizeTransferStatus(canonicalOrLegacy);
  if (canonical === 'awaiting_transfer') return ['awaiting_transfer', 'approved'];
  if (canonical === 'in_transit') return ['in_transit', 'dispatched'];
  return [canonical];
}
