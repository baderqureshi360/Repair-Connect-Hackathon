import {
  PartsRequest,
  PartsReservation,
  RepairEstimate,
  RepairRequest,
  RepairStatusHistory,
  StockTransfer
} from '../models/index.js';
import { AppError } from '../utils/errors.js';
import { writeAudit } from './audit.js';
import { listTrackingEventsForRepair } from './trackingEvents.js';
import {
  hashTrackingAccessCode,
  normalizeAccessCode,
  timingSafeEqualHex
} from './trackingCredentials.js';

export type PublicPartsState =
  | 'checking'
  | 'available'
  | 'reserved'
  | 'unavailable'
  | 'transfer_requested'
  | 'in_transit'
  | 'received'
  | 'not_required'
  | 'unconfirmed_arrival';

const PARTS_MESSAGES: Record<PublicPartsState, string> = {
  checking: 'Parts availability is being checked',
  available: 'Required part is available',
  reserved: 'Required part has been reserved for your repair',
  unavailable: 'Required part is currently unavailable',
  transfer_requested: 'A transfer has been requested',
  in_transit: 'Required part is on its way',
  received: 'Required part has arrived',
  not_required: 'No parts are required for this repair',
  unconfirmed_arrival: 'Expected arrival: Unconfirmed'
};

function isTrackingActive(repair: {
  trackingRevokedAt?: Date | null;
  trackingExpiresAt?: Date | null;
}): boolean {
  if (repair.trackingRevokedAt) return false;
  if (repair.trackingExpiresAt && repair.trackingExpiresAt.getTime() < Date.now()) return false;
  return true;
}

async function derivePartsPublicState(repairId: string, partsRequirementStatus: string) {
  if (partsRequirementStatus === 'not_required') {
    return {
      state: 'not_required' as PublicPartsState,
      message: PARTS_MESSAGES.not_required,
      expectedArrival: null as string | null,
      expectedArrivalLabel: null as string | null
    };
  }

  const activeReservation = await PartsReservation.findOne({
    repairRequest: repairId,
    status: 'active'
  }).lean();
  if (activeReservation) {
    return {
      state: 'reserved' as PublicPartsState,
      message: PARTS_MESSAGES.reserved,
      expectedArrival: null,
      expectedArrivalLabel: null
    };
  }

  const transfer = await StockTransfer.findOne({
    repairRequest: repairId,
    status: { $in: ['requested', 'awaiting_transfer', 'approved', 'in_transit', 'dispatched', 'received'] }
  })
    .sort({ updatedAt: -1 })
    .lean();

  if (transfer) {
    const st = String(transfer.status);
    if (st === 'received') {
      return {
        state: 'received' as PublicPartsState,
        message: PARTS_MESSAGES.received,
        expectedArrival: null,
        expectedArrivalLabel: 'Expected arrival: Unconfirmed'
      };
    }
    if (st === 'in_transit' || st === 'dispatched') {
      return {
        state: 'in_transit' as PublicPartsState,
        message: PARTS_MESSAGES.in_transit,
        expectedArrival: null,
        expectedArrivalLabel: 'Expected arrival: Unconfirmed'
      };
    }
    return {
      state: 'transfer_requested' as PublicPartsState,
      message: PARTS_MESSAGES.transfer_requested,
      expectedArrival: null,
      expectedArrivalLabel: 'Expected arrival: Unconfirmed'
    };
  }

  const partsReq = await PartsRequest.findOne({
    repairRequest: repairId,
    status: { $nin: ['superseded'] }
  })
    .sort({ createdAt: -1 })
    .lean();

  if (partsReq) {
    if (partsReq.status === 'rejected') {
      return {
        state: 'unavailable' as PublicPartsState,
        message: PARTS_MESSAGES.unavailable,
        expectedArrival: null,
        expectedArrivalLabel: 'Expected arrival: Unconfirmed'
      };
    }
    if (partsReq.status === 'fulfilled' || partsReq.status === 'approved') {
      // Approved without active reservation → still checking / pending reserve
      return {
        state: 'available' as PublicPartsState,
        message: PARTS_MESSAGES.available,
        expectedArrival: null,
        expectedArrivalLabel: null
      };
    }
    if (partsReq.status === 'pending' || partsReq.status === 'partially_fulfilled') {
      return {
        state: 'checking' as PublicPartsState,
        message: PARTS_MESSAGES.checking,
        expectedArrival: null,
        expectedArrivalLabel: 'Expected arrival: Unconfirmed'
      };
    }
  }

  if (partsRequirementStatus === 'required') {
    return {
      state: 'checking' as PublicPartsState,
      message: PARTS_MESSAGES.checking,
      expectedArrival: null,
      expectedArrivalLabel: 'Expected arrival: Unconfirmed'
    };
  }

  return {
    state: 'checking' as PublicPartsState,
    message: PARTS_MESSAGES.checking,
    expectedArrival: null,
    expectedArrivalLabel: null
  };
}

async function deriveEstimatePublicState(repairId: string, status: string) {
  const latest = await RepairEstimate.findOne({ repairRequest: repairId })
    .sort({ version: -1, createdAt: -1 })
    .lean();

  let estimateState:
    | 'none'
    | 'ready_for_review'
    | 'awaiting_approval'
    | 'approved'
    | 'rejected'
    | 'revised_awaiting_approval' = 'none';

  if (status === 'estimate_pending') {
    estimateState = latest && (latest.version || 1) > 1 ? 'revised_awaiting_approval' : 'awaiting_approval';
  } else if (status === 'estimate_approved' || ['awaiting_parts', 'parts_reserved', 'ready_to_start', 'in_progress', 'ready_for_collection', 'completed'].includes(status)) {
    if (latest) estimateState = 'approved';
  } else if (status === 'estimate_rejected') {
    estimateState = 'rejected';
  } else if (latest && status === 'diagnosing') {
    estimateState = 'ready_for_review';
  }

  return {
    estimateState,
    requiresCustomerSignIn: ['ready_for_review', 'awaiting_approval', 'revised_awaiting_approval'].includes(
      estimateState
    ),
    estimateVersion: latest?.version || null
  };
}

export async function buildPublicTrackingPayload(repairId: string) {
  const repair = await RepairRequest.findById(repairId)
    .populate('shop', 'name city')
    .lean();
  if (!repair) throw new AppError('Tracking unavailable', 404, 'TRACKING_DENIED');

  const history = await RepairStatusHistory.find({ repairRequest: repair._id })
    .sort({ changedAt: 1 })
    .select('fromStatus toStatus changedAt note')
    .lean();

  const events = await listTrackingEventsForRepair(repair._id, { customerVisibleOnly: true });
  const parts = await derivePartsPublicState(
    String(repair._id),
    repair.partsRequirement?.status || 'undetermined'
  );
  const estimate = await deriveEstimatePublicState(String(repair._id), repair.status);

  const customerPhotos = (repair.photos || []).filter(
    (p) => (p as { visibility?: string }).visibility !== 'internal'
  );

  return {
    referenceNumber: repair.referenceNumber,
    status: repair.status,
    deviceType: repair.deviceType,
    brand: repair.brand,
    model: repair.model,
    shop: repair.shop
      ? {
          name: (repair.shop as { name?: string }).name,
          city: (repair.shop as { city?: string }).city
        }
      : null,
    submittedAt: (repair as { createdAt?: Date }).createdAt || null,
    lastUpdatedAt: (repair as { updatedAt?: Date }).updatedAt || null,
    warrantyExpiresAt: repair.warrantyExpiresAt || null,
    photos: customerPhotos.map((p) => ({
      url: (p as { url: string }).url,
      caption: (p as { caption?: string }).caption || '',
      kind: (p as { kind?: string }).kind || 'device'
    })),
    timeline: history.map((h) => ({
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      at: h.changedAt,
      note: h.note && !String(h.note).toLowerCase().includes('internal') ? h.note : undefined
    })),
    milestones: events.map((e) => ({
      eventKey: e.eventKey,
      title: e.title,
      message: e.message,
      at: e.occurredAt
    })),
    parts,
    estimate,
    completedAt: repair.completedAt || null
  };
}

export async function getPublicTrackingByToken(token: string) {
  const clean = String(token || '');
  if (!clean || clean.length < 16) {
    throw new AppError('Tracking unavailable', 404, 'TRACKING_DENIED');
  }

  const repair = await RepairRequest.findOne({ trackingToken: clean }).select(
    '+trackingAccessCodeHash trackingRevokedAt trackingExpiresAt'
  );
  if (!repair || !isTrackingActive(repair)) {
    throw new AppError('Tracking unavailable', 404, 'TRACKING_DENIED');
  }

  return buildPublicTrackingPayload(String(repair._id));
}

export async function lookupPublicTracking(input: {
  referenceNumber: string;
  accessCode: string;
  ip?: string;
}) {
  const ref = String(input.referenceNumber || '').trim().toUpperCase();
  const code = normalizeAccessCode(input.accessCode);

  // Uniform denial path — always same error after comparable work
  const deny = async (reason: string) => {
    await writeAudit({
      action: 'tracking.lookup_denied',
      entityType: 'RepairRequest',
      details: { reason, referenceHint: ref.slice(0, 8), ip: input.ip }
    });
    throw new AppError('Tracking unavailable', 404, 'TRACKING_DENIED');
  };

  if (!ref || code.length < 6) {
    await deny('invalid_input');
  }

  const repair = await RepairRequest.findOne({ referenceNumber: ref }).select(
    '+trackingAccessCodeHash trackingRevokedAt trackingExpiresAt trackingToken'
  );

  if (!repair || !repair.trackingAccessCodeHash || !isTrackingActive(repair)) {
    // Burn comparable time
    hashTrackingAccessCode(code || 'INVALID00');
    await deny('not_found_or_inactive');
  }

  const expected = repair!.trackingAccessCodeHash!;
  const actual = hashTrackingAccessCode(code);
  if (!timingSafeEqualHex(expected, actual)) {
    await deny('bad_code');
  }

  await writeAudit({
    action: 'tracking.lookup_ok',
    entityType: 'RepairRequest',
    entityId: repair!._id,
    shop: repair!.shop,
    details: { ip: input.ip }
  });

  return buildPublicTrackingPayload(String(repair!._id));
}
