import crypto from 'crypto';
import mongoose from 'mongoose';
import {
  Diagnosis,
  EstimateDecision,
  RepairAssignment,
  RepairEstimate,
  RepairRequest,
  RepairShop,
  RepairStatusHistory,
  ShopMembership
} from '../models/index.js';
import type { AuthUser } from '../middleware/auth.js';
import { AppError } from '../utils/errors.js';
import { writeAudit } from './audit.js';
import { notify } from './notifications.js';
import { transitionStatus } from './status.js';
import { consumeReservationsForRepair, releaseReservation } from './inventory.js';
import { assertCanMutateRepair, assertCanViewRepair, assertShopAccess } from './access.js';
import { assertCanStartRepair, evaluateRepairReadiness } from './readiness.js';
import { PartsReservation, PartsRequest, PaymentRecord, ShopSettings } from '../models/index.js';
import { issueTrackingCredentials } from './trackingCredentials.js';
import { recordTrackingEvent } from './trackingEvents.js';

export { assertShopAccess };
export { evaluateRepairReadiness };

function stripTrackingSecrets<T extends Record<string, unknown>>(doc: T): T {
  const copy = { ...doc };
  delete copy.trackingAccessCodeHash;
  return copy;
}

/** Release active reservations and supersede open parts requests after estimate revision. */
async function reconcilePartsAfterEstimateRevision(
  repairId: mongoose.Types.ObjectId,
  actorId: string,
  note: string
) {
  const active = await PartsReservation.find({
    repairRequest: repairId,
    status: 'active'
  });
  for (const reservation of active) {
    await releaseReservation({
      reservationId: reservation._id.toString(),
      userId: actorId
    });
  }

  await PartsRequest.updateMany(
    {
      repairRequest: repairId,
      status: { $in: ['pending', 'approved', 'partially_fulfilled', 'fulfilled'] }
    },
    {
      $set: {
        status: 'superseded',
        rejectionReason: note
      }
    }
  );
}

function refNumber(): string {
  const now = new Date();
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `RC-${stamp}-${rand}`;
}

export async function createRepairRequest(input: {
  customerId: string;
  shopId: string;
  deviceType: string;
  brand: string;
  model: string;
  problemDescription: string;
  serialNumber?: string;
  accessories?: string;
  photos?: { url: string; caption?: string; kind?: string; visibility?: string }[];
  appointmentAt?: string;
  idempotencyKey?: string;
}): Promise<Record<string, unknown> & { _id: mongoose.Types.ObjectId; trackingAccessCode?: string }> {
  const shop = await RepairShop.findOne({ _id: input.shopId, isActive: true });
  if (!shop) throw new AppError('Shop not found', 404, 'NOT_FOUND');

  if (input.idempotencyKey) {
    const existing = await RepairRequest.findOne({
      idempotencyKey: input.idempotencyKey,
      customer: input.customerId
    });
    if (existing) {
      const obj = stripTrackingSecrets(existing.toObject() as Record<string, unknown>);
      return { ...obj, _id: existing._id } as Record<string, unknown> & {
        _id: mongoose.Types.ObjectId;
        trackingAccessCode?: string;
      };
    }
  }

  // Soft duplicate guard: same customer/shop/device/problem within 5 minutes
  const recent = await RepairRequest.findOne({
    customer: input.customerId,
    shop: input.shopId,
    deviceType: input.deviceType,
    brand: input.brand,
    model: input.model,
    problemDescription: input.problemDescription,
    createdAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) }
  });
  if (recent) {
    throw new AppError(
      'A similar repair request was already submitted recently',
      409,
      'DUPLICATE_REQUEST',
      { existingId: recent._id, referenceNumber: recent.referenceNumber }
    );
  }

  const credentials = issueTrackingCredentials();
  let created;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      created = await RepairRequest.create({
        referenceNumber: refNumber(),
        customer: input.customerId,
        shop: input.shopId,
        source: 'online',
        deviceType: input.deviceType,
        brand: input.brand,
        model: input.model,
        serialNumber: input.serialNumber || '',
        accessories: input.accessories || '',
        photos: (input.photos || []).slice(0, 5),
        appointmentAt: input.appointmentAt ? new Date(input.appointmentAt) : undefined,
        problemDescription: input.problemDescription,
        status: 'submitted',
        trackingToken: credentials.trackingToken,
        trackingAccessCodeHash: credentials.trackingAccessCodeHash,
        trackingCodeUpdatedAt: credentials.trackingCodeUpdatedAt,
        trackingExpiresAt: credentials.trackingExpiresAt,
        idempotencyKey: input.idempotencyKey,
        partsRequirement: { status: 'undetermined', notes: '' }
      });
      break;
    } catch (err) {
      if ((err as { code?: number }).code === 11000 && attempt < 4) continue;
      throw err;
    }
  }
  if (!created) throw new AppError('Unable to create repair request', 500, 'CREATE_FAILED');

  const { RepairStatusHistory } = await import('../models/RepairStatusHistory.js');
  await RepairStatusHistory.create({
    repairRequest: created._id,
    fromStatus: null,
    toStatus: 'submitted',
    changedBy: input.customerId,
    note: 'Repair submitted'
  });

  await writeAudit({
    actor: input.customerId,
    action: 'repair.create',
    entityType: 'RepairRequest',
    entityId: created._id,
    shop: input.shopId
  });

  await recordTrackingEvent({
    repairId: created._id,
    eventKey: 'repair_received',
    customerId: input.customerId,
    dedupeKey: 'repair_received'
  });

  // Shop admins: new repair request (customer-safe message — no private notes).
  const { notifyShopMembers } = await import('./notifications.js');
  await notifyShopMembers({
    shopId: input.shopId,
    roles: ['shop_admin'],
    type: 'new_repair_request',
    title: 'New repair request',
    message: `${created.referenceNumber}: ${input.deviceType} ${input.brand} ${input.model}`,
    repairRequest: created._id,
    meta: { referenceNumber: created.referenceNumber, hrefHint: 'repair' },
    dedupeKeyPrefix: `new_repair:${created._id}`
  });

  const obj = stripTrackingSecrets(created.toObject() as Record<string, unknown>);
  return {
    ...obj,
    _id: created._id,
    trackingAccessCode: credentials.accessCode
  };
}

export async function regenerateTrackingCredentials(input: {
  repairId: string;
  user: AuthUser;
}) {
  const repair = await RepairRequest.findById(input.repairId).select('+trackingAccessCodeHash');
  if (!repair) throw new AppError('Repair not found', 404, 'NOT_FOUND');
  assertCanViewRepair(input.user, repair);
  if (
    input.user.role === 'customer' &&
    (!repair.customer || repair.customer.toString() !== input.user.id)
  ) {
    throw new AppError('Forbidden', 403, 'FORBIDDEN');
  }
  if (input.user.role !== 'customer') {
    assertCanMutateRepair(input.user, repair);
  }

  const credentials = issueTrackingCredentials();
  repair.trackingToken = credentials.trackingToken;
  repair.trackingAccessCodeHash = credentials.trackingAccessCodeHash;
  repair.trackingCodeUpdatedAt = credentials.trackingCodeUpdatedAt;
  repair.trackingExpiresAt = credentials.trackingExpiresAt;
  repair.trackingRevokedAt = undefined;
  await repair.save();

  await writeAudit({
    actor: input.user.id,
    action: 'tracking.regenerate',
    entityType: 'RepairRequest',
    entityId: repair._id,
    shop: repair.shop
  });

  return {
    referenceNumber: repair.referenceNumber,
    trackingToken: credentials.trackingToken,
    trackingAccessCode: credentials.accessCode,
    trackingExpiresAt: credentials.trackingExpiresAt
  };
}

export async function assignMechanic(input: {
  repairId: string;
  mechanicId: string;
  admin: AuthUser;
  notes?: string;
}) {
  const repair = await RepairRequest.findById(input.repairId);
  if (!repair) throw new AppError('Repair not found', 404, 'NOT_FOUND');
  assertShopAccess(input.admin, repair.shop.toString());

  const membership = await ShopMembership.findOne({
    user: input.mechanicId,
    shop: repair.shop,
    role: 'mechanic',
    isActive: true
  });
  if (!membership) {
    throw new AppError('Mechanic is not a member of this shop', 400, 'INVALID_MECHANIC');
  }

  if (!['submitted', 'assigned'].includes(repair.status)) {
    throw new AppError('Repair cannot be assigned in current status', 409, 'INVALID_STATE');
  }

  const assignment = await RepairAssignment.findOneAndUpdate(
    { repairRequest: repair._id },
    {
      repairRequest: repair._id,
      mechanic: input.mechanicId,
      assignedBy: input.admin.id,
      shop: repair.shop,
      notes: input.notes || '',
      assignedAt: new Date()
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  repair.assignedMechanic = new mongoose.Types.ObjectId(input.mechanicId);
  await repair.save();

  if (repair.status === 'submitted') {
    await transitionStatus(repair._id, 'assigned', input.admin.id, 'Mechanic assigned');
  }

  await notify({
    user: input.mechanicId,
    type: 'repair_assigned',
    title: 'New repair assigned',
    message: `You have been assigned repair ${repair.referenceNumber}`,
    repairRequest: repair._id
  });

  await writeAudit({
    actor: input.admin.id,
    action: 'repair.assign',
    entityType: 'RepairRequest',
    entityId: repair._id,
    shop: repair.shop,
    details: { mechanicId: input.mechanicId }
  });

  await recordTrackingEvent({
    repairId: repair._id,
    eventKey: 'mechanic_assigned',
    customerId: repair.customer || undefined,
    dedupeKey: `mechanic_assigned:${input.mechanicId}`
  });

  return assignment;
}

export async function addDiagnosis(input: {
  repairId: string;
  mechanic: AuthUser;
  findings: string;
  recommendedActions: string;
  notes?: string;
}) {
  const repair = await assertMechanicOwnsRepair(input.repairId, input.mechanic);

  if (!['assigned', 'diagnosing'].includes(repair.status)) {
    throw new AppError('Cannot diagnose in current status', 409, 'INVALID_STATE');
  }

  if (repair.status === 'assigned') {
    await transitionStatus(repair._id, 'diagnosing', input.mechanic.id, 'Diagnosis started');
  }

  const diagnosis = await Diagnosis.create({
    repairRequest: repair._id,
    mechanic: input.mechanic.id,
    findings: input.findings,
    recommendedActions: input.recommendedActions,
    notes: input.notes || ''
  });

  await recordTrackingEvent({
    repairId: repair._id,
    eventKey: 'diagnosis_completed',
    customerId: repair.customer || undefined,
    dedupeKey: `diagnosis:${diagnosis._id}`
  });

  return diagnosis;
}

const ESTIMATE_REVISABLE_STATUSES = [
  'diagnosing',
  'estimate_rejected',
  'estimate_approved',
  'awaiting_parts',
  'parts_reserved',
  'ready_to_start'
] as const;

export async function submitEstimate(input: {
  repairId: string;
  mechanic: AuthUser;
  laborCost: number;
  partsCost: number;
  lineItems?: { description: string; amount: number }[];
  notes?: string;
}) {
  const repair = await assertMechanicOwnsRepair(input.repairId, input.mechanic);

  if (!ESTIMATE_REVISABLE_STATUSES.includes(repair.status as (typeof ESTIMATE_REVISABLE_STATUSES)[number])) {
    throw new AppError(
      'Estimate can only be submitted or revised before repair work starts',
      409,
      'INVALID_STATE'
    );
  }

  const last = await RepairEstimate.findOne({ repairRequest: repair._id }).sort({ version: -1 });
  const version = (last?.version || 0) + 1;
  const totalCost = input.laborCost + input.partsCost;
  const revisesApproved = last?.status === 'approved';

  // Immutable versioning: never mutate prior estimates. A new version requires fresh approval.
  const estimate = await RepairEstimate.create({
    repairRequest: repair._id,
    mechanic: input.mechanic.id,
    laborCost: input.laborCost,
    partsCost: input.partsCost,
    totalCost,
    lineItems: input.lineItems || [],
    notes: input.notes || '',
    status: 'pending',
    version
  });

  // Revising invalidates prior approval AND resets explicit parts requirement.
  if (version > 1 || revisesApproved) {
    await reconcilePartsAfterEstimateRevision(
      repair._id,
      input.mechanic.id,
      `Superseded by estimate v${version}`
    );
  }
  repair.set('partsRequirement', {
    status: 'undetermined',
    notes: ''
  });
  await repair.save();

  if (repair.status !== 'estimate_pending') {
    await transitionStatus(
      repair._id,
      'estimate_pending',
      input.mechanic.id,
      revisesApproved
        ? `Revised estimate v${version} — prior approval no longer valid for this version`
        : `Estimate v${version}`
    );
  } else {
    const { RepairStatusHistory } = await import('../models/RepairStatusHistory.js');
    await RepairStatusHistory.create({
      repairRequest: repair._id,
      fromStatus: 'estimate_pending',
      toStatus: 'estimate_pending',
      changedBy: input.mechanic.id,
      note: `Estimate v${version} submitted`
    });
  }

  await notify({
    user: repair.customer,
    type: 'estimate_ready',
    title: revisesApproved ? 'Revised repair estimate ready' : 'Repair estimate ready',
    message: `Estimate v${version} for ${repair.referenceNumber}: ${totalCost} PKR`,
    repairRequest: repair._id,
    meta: { estimateId: estimate._id, totalCost, version, revisesApproved },
    dedupeKey: `estimate_ready:${estimate._id}`
  });

  // Tracking timeline kept; customer inbox already covered by estimate_ready (avoid duplicate).
  await recordTrackingEvent({
    repairId: repair._id,
    eventKey: version > 1 || revisesApproved ? 'estimate_revised' : 'estimate_prepared',
    customerId: repair.customer,
    dedupeKey: `estimate:${estimate._id}`,
    notifyCustomer: false
  });
  await recordTrackingEvent({
    repairId: repair._id,
    eventKey: 'estimate_awaiting_approval',
    customerId: repair.customer,
    dedupeKey: `estimate_awaiting:${estimate._id}`,
    notifyCustomer: false
  });

  const { notifyShopMembers } = await import('./notifications.js');
  await notifyShopMembers({
    shopId: repair.shop,
    roles: ['shop_admin'],
    type: 'pending_approval',
    title: 'Estimate awaiting customer approval',
    message: `${repair.referenceNumber}: estimate v${version} (${totalCost} PKR)`,
    repairRequest: repair._id,
    meta: { estimateId: String(estimate._id), version, totalCost },
    dedupeKeyPrefix: `pending_approval:${estimate._id}`,
    excludeUserIds: [input.mechanic.id]
  });

  return estimate;
}

export async function decideEstimate(input: {
  estimateId: string;
  customer: AuthUser;
  decision: 'approved' | 'rejected';
  reason?: string;
}) {
  const estimate = await RepairEstimate.findById(input.estimateId);
  if (!estimate) throw new AppError('Estimate not found', 404, 'NOT_FOUND');
  if (estimate.status !== 'pending') {
    throw new AppError('Estimate already decided', 409, 'ALREADY_DECIDED');
  }

  const repair = await RepairRequest.findById(estimate.repairRequest);
  if (!repair) throw new AppError('Repair not found', 404, 'NOT_FOUND');
  if (!repair.customer || repair.customer.toString() !== input.customer.id) {
    throw new AppError('Not your repair request', 403, 'FORBIDDEN');
  }
  if (repair.status !== 'estimate_pending') {
    throw new AppError('Repair is not awaiting estimate decision', 409, 'INVALID_STATE');
  }

  const decision = await EstimateDecision.create({
    repairRequest: repair._id,
    estimate: estimate._id,
    customer: input.customer.id,
    decision: input.decision,
    reason: input.reason || ''
  });

  estimate.status = input.decision;
  await estimate.save();

  if (input.decision === 'approved') {
    await transitionStatus(
      repair._id,
      'estimate_approved',
      input.customer.id,
      `Customer approved estimate v${estimate.version}`
    );

    // If all required parts are already reserved (or none required), advance to ready_to_start.
    const readiness = await evaluateRepairReadiness(repair._id);
    if (readiness.canStartRepair) {
      await transitionStatus(
        repair._id,
        'ready_to_start',
        input.customer.id,
        'Dual conditions satisfied — ready to start'
      );
    }

    if (repair.assignedMechanic) {
      await notify({
        user: repair.assignedMechanic,
        type: 'estimate_approved',
        title: 'Estimate approved',
        message: readiness.canStartRepair
          ? `Customer approved estimate v${estimate.version} for ${repair.referenceNumber} — ready to start`
          : `Customer approved estimate v${estimate.version} for ${repair.referenceNumber}`,
        repairRequest: repair._id,
        meta: { estimateId: estimate._id, version: estimate.version },
        dedupeKey: `estimate_approved:${estimate._id}:${repair.assignedMechanic}`
      });
    }
    const { notifyShopMembers } = await import('./notifications.js');
    await notifyShopMembers({
      shopId: repair.shop,
      roles: ['shop_admin'],
      type: 'customer_update',
      title: 'Customer approved estimate',
      message: `${repair.referenceNumber}: estimate v${estimate.version} approved`,
      repairRequest: repair._id,
      meta: { estimateId: String(estimate._id), decision: 'approved' },
      dedupeKeyPrefix: `customer_update:approved:${estimate._id}`,
      excludeUserIds: [repair.assignedMechanic]
    });
  } else {
    await transitionStatus(
      repair._id,
      'estimate_rejected',
      input.customer.id,
      input.reason || 'Customer rejected'
    );
    if (repair.assignedMechanic) {
      await notify({
        user: repair.assignedMechanic,
        type: 'estimate_rejected',
        title: 'Estimate rejected',
        message: `Customer rejected estimate for ${repair.referenceNumber}`,
        repairRequest: repair._id,
        dedupeKey: `estimate_rejected:${estimate._id}:${repair.assignedMechanic}`
      });
    }
    const { notifyShopMembers } = await import('./notifications.js');
    await notifyShopMembers({
      shopId: repair.shop,
      roles: ['shop_admin'],
      type: 'customer_update',
      title: 'Customer rejected estimate',
      message: `${repair.referenceNumber}: estimate rejected`,
      repairRequest: repair._id,
      meta: { estimateId: String(estimate._id), decision: 'rejected' },
      dedupeKeyPrefix: `customer_update:rejected:${estimate._id}`,
      excludeUserIds: [repair.assignedMechanic]
    });
  }

  await recordTrackingEvent({
    repairId: repair._id,
    eventKey: input.decision === 'approved' ? 'estimate_approved' : 'estimate_rejected',
    customerId: repair.customer,
    dedupeKey: `estimate_decision:${estimate._id}:${input.decision}`,
    notifyCustomer: false
  });
  if (input.decision === 'approved') {
    const readinessAfter = await evaluateRepairReadiness(repair._id);
    if (readinessAfter.canStartRepair) {
      await recordTrackingEvent({
        repairId: repair._id,
        eventKey: 'ready_to_start',
        customerId: repair.customer,
        dedupeKey: `ready_to_start:${estimate._id}`
      });
    }
  }

  return { estimate, decision };
}

export async function confirmPartsNotRequired(input: {
  repairId: string;
  mechanic: AuthUser;
  notes?: string;
}) {
  const repair = await assertMechanicOwnsRepair(input.repairId, input.mechanic);
  if (
    !['estimate_approved', 'awaiting_parts', 'parts_reserved', 'ready_to_start'].includes(repair.status)
  ) {
    throw new AppError(
      'Parts requirement can only be confirmed after estimate approval and before work starts',
      409,
      'INVALID_STATE'
    );
  }

  const latestEstimate = await RepairEstimate.findOne({ repairRequest: repair._id }).sort({
    version: -1
  });
  if (!latestEstimate || latestEstimate.status !== 'approved') {
    throw new AppError(
      'Parts requirement must be confirmed against the latest approved estimate',
      409,
      'NO_APPROVAL'
    );
  }

  // If parts were previously requested, supersede them and release reservations.
  await reconcilePartsAfterEstimateRevision(
    repair._id,
    input.mechanic.id,
    'Mechanic confirmed no replacement parts required'
  );

  repair.partsRequirement = {
    status: 'not_required',
    confirmedBy: new mongoose.Types.ObjectId(input.mechanic.id),
    confirmedAt: new Date(),
    estimate: latestEstimate._id,
    estimateVersion: latestEstimate.version,
    notes: input.notes || 'No replacement parts required'
  };
  await repair.save();

  if (['awaiting_parts', 'parts_reserved'].includes(repair.status)) {
    await transitionStatus(
      repair._id,
      'ready_to_start',
      input.mechanic.id,
      'No parts required — ready to start'
    );
  } else if (repair.status === 'estimate_approved') {
    const readiness = await evaluateRepairReadiness(repair._id);
    if (readiness.canStartRepair) {
      await transitionStatus(
        repair._id,
        'ready_to_start',
        input.mechanic.id,
        'No parts required — ready to start'
      );
    }
  }

  await writeAudit({
    actor: input.mechanic.id,
    action: 'repair.parts_not_required',
    entityType: 'RepairRequest',
    entityId: repair._id,
    shop: repair.shop,
    details: {
      estimateId: latestEstimate._id,
      estimateVersion: latestEstimate.version
    }
  });

  return RepairRequest.findById(repair._id);
}

export async function requestParts(input: {
  repairId: string;
  partId: string;
  quantity: number;
  mechanic: AuthUser;
  notes?: string;
}) {
  const repair = await assertMechanicOwnsRepair(input.repairId, input.mechanic);
  if (
    !['estimate_approved', 'awaiting_parts', 'parts_reserved', 'ready_to_start', 'in_progress'].includes(
      repair.status
    )
  ) {
    throw new AppError(
      'Parts can only be requested after estimate approval',
      409,
      'INVALID_STATE'
    );
  }

  const latestEstimate = await RepairEstimate.findOne({ repairRequest: repair._id }).sort({
    version: -1
  });
  if (!latestEstimate || latestEstimate.status !== 'approved') {
    throw new AppError(
      'Parts must be requested against the latest approved estimate',
      409,
      'NO_APPROVAL'
    );
  }

  const { Part } = await import('../models/index.js');
  const part = await Part.findOne({ _id: input.partId, shop: repair.shop, isActive: true });
  if (!part) throw new AppError('Part not found in this shop', 404, 'NOT_FOUND');

  const partsRequest = await PartsRequest.create({
    repairRequest: repair._id,
    shop: repair.shop,
    part: part._id,
    requestedBy: input.mechanic.id,
    estimate: latestEstimate._id,
    estimateVersion: latestEstimate.version,
    quantityRequested: input.quantity,
    quantityShortage: Math.max(0, input.quantity - part.quantityAvailable),
    status: 'pending',
    notes: input.notes || ''
  });

  repair.partsRequirement = {
    status: 'required',
    confirmedBy: new mongoose.Types.ObjectId(input.mechanic.id),
    confirmedAt: new Date(),
    estimate: latestEstimate._id,
    estimateVersion: latestEstimate.version,
    notes: input.notes || 'Parts required for repair'
  };
  await repair.save();

  if (['estimate_approved', 'in_progress', 'parts_reserved', 'ready_to_start'].includes(repair.status)) {
    await transitionStatus(repair._id, 'awaiting_parts', input.mechanic.id, 'Parts requested');
  }

  const { notifyShopMembers } = await import('./notifications.js');
  await notifyShopMembers({
    shopId: repair.shop,
    roles: ['shop_admin', 'parts_coordinator'],
    type: 'parts_request',
    title: 'Parts requested',
    message: `${repair.referenceNumber}: ${part.name || part.sku || 'part'} × ${input.quantity}`,
    repairRequest: repair._id,
    meta: {
      partsRequestId: String(partsRequest._id),
      partId: String(part._id),
      hrefHint: 'parts_request'
    },
    dedupeKeyPrefix: `parts_request:${partsRequest._id}`,
    excludeUserIds: [input.mechanic.id]
  });

  return partsRequest;
}

export async function startRepairWork(input: { repairId: string; mechanic: AuthUser }) {
  const repair = await assertMechanicOwnsRepair(input.repairId, input.mechanic);
  if (
    !['estimate_approved', 'awaiting_parts', 'parts_reserved', 'ready_to_start'].includes(repair.status)
  ) {
    throw new AppError('Cannot start work in current status', 409, 'INVALID_STATE');
  }

  // CRITICAL: dual-condition server check — never trust UI alone.
  // Runs even from awaiting_parts so premature starts get NOT_READY (not a vague INVALID_STATE).
  await assertCanStartRepair(repair._id);

  // Normalize to ready_to_start when coming from earlier dual-ready statuses.
  if (['estimate_approved', 'parts_reserved', 'awaiting_parts'].includes(repair.status)) {
    await transitionStatus(repair._id, 'ready_to_start', input.mechanic.id, 'Dual conditions verified');
  }

  const started = await transitionStatus(repair._id, 'in_progress', input.mechanic.id, 'Repair work started');
  await recordTrackingEvent({
    repairId: repair._id,
    eventKey: 'repair_started',
    customerId: repair.customer,
    dedupeKey: `repair_started:${repair._id}`
  });
  return started;
}

/**
 * Mechanic or shop admin marks work finished → ready_for_collection.
 * Does NOT close the job; collection and case closure are separate actions.
 * Does not bypass estimate approval / parts readiness checks.
 */
export async function completeRepair(input: {
  repairId: string;
  mechanic: AuthUser;
  workPerformed: string;
  finalCost: number;
  completionSummary?: string;
}) {
  const repair = await assertMechanicOwnsRepair(input.repairId, input.mechanic);
  if (repair.status !== 'in_progress') {
    throw new AppError('Cannot mark work complete unless repair is in progress', 409, 'INVALID_STATE');
  }

  // Latest estimate must still be the approved version — obsolete approvals cannot finish the job.
  const readiness = await evaluateRepairReadiness(repair._id);
  if (!readiness.latestEstimateApproved) {
    throw new AppError(
      'Cannot complete without approval of the latest estimate version',
      409,
      'NO_APPROVAL',
      { latestEstimateId: readiness.latestEstimateId, reasons: readiness.reasons }
    );
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    await consumeReservationsForRepair(repair._id.toString(), input.mechanic.id, session);

    // finalCost is set once at work completion and becomes the billed totalDue.
    // Bump financialRevision so concurrent payment recording cannot race a late cost write.
    if (repair.finalCost != null && Math.abs(Number(repair.finalCost) - input.finalCost) > 0.009) {
      throw new AppError(
        'Final cost is immutable after it has been set',
        409,
        'FINAL_COST_LOCKED'
      );
    }
    repair.workPerformed = input.workPerformed;
    repair.finalCost = input.finalCost;
    repair.completionSummary = input.completionSummary || input.workPerformed;
    repair.workCompletedAt = new Date();
    repair.workCompletedBy = new mongoose.Types.ObjectId(input.mechanic.id);
    repair.financialRevision = Number(repair.financialRevision || 0) + 1;
    const months = repair.warrantyMonths || 3;
    repair.warrantyMonths = months;
    repair.warrantyExpiresAt = new Date(Date.now() + months * 30 * 24 * 60 * 60 * 1000);
    if (!repair.trackingToken) {
      const creds = issueTrackingCredentials();
      repair.trackingToken = creds.trackingToken;
      repair.trackingAccessCodeHash = creds.trackingAccessCodeHash;
      repair.trackingCodeUpdatedAt = creds.trackingCodeUpdatedAt;
      repair.trackingExpiresAt = creds.trackingExpiresAt;
    }
    await repair.save({ session });

    await transitionStatus(
      repair._id,
      'ready_for_collection',
      input.mechanic.id,
      'Repair work finished — ready for collection',
      session
    );

    await notify({
      user: repair.customer,
      type: 'repair_completed',
      title: 'Repair completed — ready for collection',
      message: `Repair ${repair.referenceNumber} is ready for collection. Final cost: ${input.finalCost} PKR`,
      repairRequest: repair._id,
      meta: { finalCost: input.finalCost },
      dedupeKey: `repair_completed:${repair._id}`,
      session
    });

    const { enqueueOutboxEvent } = await import('./outbox.js');
    await enqueueOutboxEvent({
      channel: 'repair_message',
      dedupeKey: `repair_completed_message:${repair._id}`,
      orderingKey: String(repair._id),
      sequence: 1,
      payload: {
        repairId: String(repair._id),
        actorId: input.mechanic.id,
        body:
          input.completionSummary ||
          `Repair work is finished and your device is ready for payment and collection. Final cost: ${input.finalCost} PKR.`,
        messageType: 'status_update',
        visibility: 'customer_visible'
      },
      session
    });

    await session.commitTransaction();
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }

  const { kickOutboxProcessor, processOutboxBatch } = await import('./outbox.js');
  kickOutboxProcessor();
  await processOutboxBatch(10);

  // Customer already notified via repair_completed; keep timeline without duplicate inbox ping.
  await recordTrackingEvent({
    repairId: repair._id,
    eventKey: 'ready_for_collection',
    customerId: repair.customer,
    dedupeKey: `ready_for_collection:${repair._id}`,
    notifyCustomer: false
  });

  const { notifyShopMembers } = await import('./notifications.js');
  await notifyShopMembers({
    shopId: repair.shop,
    roles: ['shop_admin'],
    type: 'staff_activity',
    title: 'Repair ready for collection',
    message: `${repair.referenceNumber} is ready for collection`,
    repairRequest: repair._id,
    meta: { finalCost: input.finalCost },
    dedupeKeyPrefix: `staff_ready_collection:${repair._id}`,
    excludeUserIds: [input.mechanic.id]
  });

  return RepairRequest.findById(repair._id);
}

/**
 * Authorized staff confirms device collection.
 * Does NOT close the case — use closeRepairCase after payment is settled.
 */
export async function confirmCollection(input: {
  repairId: string;
  staff: AuthUser;
  notes?: string;
}) {
  const repair = await RepairRequest.findById(input.repairId);
  if (!repair) throw new AppError('Repair not found', 404, 'NOT_FOUND');
  assertShopAccess(input.staff, repair.shop.toString());

  if (!['shop_admin', 'parts_coordinator', 'mechanic'].includes(input.staff.role)) {
    throw new AppError('Not authorized to confirm collection', 403, 'FORBIDDEN');
  }
  if (repair.status !== 'ready_for_collection') {
    throw new AppError('Repair is not ready for collection', 409, 'INVALID_STATE');
  }
  if (repair.collectedAt) {
    throw new AppError('Collection already confirmed', 409, 'ALREADY_COLLECTED');
  }

  const { getRepairPaymentSummary } = await import('./documents.js');
  const settings = await ShopSettings.findOne({ shop: repair.shop });
  const requirePayment = settings?.paymentPolicy?.requirePaymentBeforeCollection === true;
  if (requirePayment) {
    const summary = await getRepairPaymentSummary(String(repair._id));
    const allowPartial = settings?.paymentPolicy?.allowPartialPayment !== false;
    if (allowPartial ? summary.amountPaid <= 0 : summary.outstanding > 0.009) {
      throw new AppError(
        'Shop payment policy requires payment before collection',
        409,
        'PAYMENT_REQUIRED',
        {
          paidTotal: summary.amountPaid,
          due: summary.totalDue,
          outstanding: summary.outstanding,
          allowPartial
        }
      );
    }
  }

  repair.collectedAt = new Date();
  repair.collectedBy = new mongoose.Types.ObjectId(input.staff.id);
  repair.collectionNotes = input.notes || '';
  await repair.save();

  await RepairStatusHistory.create({
    repairRequest: repair._id,
    fromStatus: repair.status,
    toStatus: repair.status,
    changedBy: input.staff.id,
    note: input.notes || 'Device collection confirmed (case not closed yet)'
  });

  await notify({
    user: repair.customer,
    type: 'repair_completed',
    title: 'Device collected',
    message: `Repair ${repair.referenceNumber} has been collected. Case closure follows once payment is settled.`,
    repairRequest: repair._id,
    dedupeKey: `repair_collected_notify:${repair._id}`
  });

  await writeAudit({
    actor: input.staff.id,
    action: 'repair.collect',
    entityType: 'RepairRequest',
    entityId: repair._id,
    shop: repair.shop,
    details: { notes: input.notes || '' }
  });

  await recordTrackingEvent({
    repairId: repair._id,
    eventKey: 'repair_collected',
    customerId: repair.customer,
    dedupeKey: `repair_collected:${repair._id}`
  });

  const { enqueueOutboxEvent, kickOutboxProcessor, processOutboxBatch } = await import('./outbox.js');
  await enqueueOutboxEvent({
    channel: 'repair_message',
    dedupeKey: `repair_collected_message:${repair._id}`,
    orderingKey: String(repair._id),
    sequence: 2,
    payload: {
      repairId: String(repair._id),
      actorId: input.staff.id,
      body: input.notes || 'Your device has been collected from the shop.',
      messageType: 'status_update',
      visibility: 'customer_visible'
    }
  });
  kickOutboxProcessor();
  await processOutboxBatch(10);

  return RepairRequest.findById(repair._id);
}

/**
 * Close case after work completion + collection + zero outstanding balance.
 * Optional audited waive requires shop_admin + reason (never silent).
 */
export async function closeRepairCase(input: {
  repairId: string;
  staff: AuthUser;
  notes?: string;
  caseSummary?: string;
  waiveOutstanding?: boolean;
  waiveReason?: string;
}) {
  const repair = await RepairRequest.findById(input.repairId);
  if (!repair) throw new AppError('Repair not found', 404, 'NOT_FOUND');
  assertShopAccess(input.staff, repair.shop.toString());
  if (input.staff.role !== 'shop_admin') {
    throw new AppError('Only shop admins can close cases', 403, 'FORBIDDEN');
  }
  if (repair.status !== 'ready_for_collection') {
    throw new AppError('Repair must be ready for collection before closure', 409, 'INVALID_STATE');
  }
  if (!repair.workCompletedAt) {
    throw new AppError('Repair work is not marked complete', 409, 'WORK_INCOMPLETE');
  }
  if (!repair.collectedAt) {
    throw new AppError('Confirm collection before closing the case', 409, 'COLLECTION_REQUIRED');
  }

  const { getRepairPaymentSummary } = await import('./documents.js');
  const summary = await getRepairPaymentSummary(String(repair._id));
  if (summary.outstanding > 0.009) {
    if (!input.waiveOutstanding) {
      throw new AppError(
        'Outstanding balance must be zero before closing the case',
        409,
        'PAYMENT_OUTSTANDING',
        { outstanding: summary.outstanding, amountPaid: summary.amountPaid, totalDue: summary.totalDue }
      );
    }
    const reason = String(input.waiveReason || '').trim();
    if (reason.length < 5) {
      throw new AppError('Waive reason required (min 5 characters)', 400, 'WAIVE_REASON_REQUIRED');
    }
    await writeAudit({
      actor: input.staff.id,
      action: 'repair.waive_balance',
      entityType: 'RepairRequest',
      entityId: repair._id,
      shop: repair.shop,
      details: { outstanding: summary.outstanding, reason }
    });
  }

  repair.closureNotes = input.notes || '';
  repair.caseSummary =
    input.caseSummary ||
    `Closed. Work: ${repair.workPerformed || 'n/a'}. Final cost: ${repair.finalCost ?? 0} PKR. Paid: ${summary.amountPaid} PKR.`;
  repair.closedBy = new mongoose.Types.ObjectId(input.staff.id);
  repair.completedAt = new Date();
  await repair.save();

  await transitionStatus(
    repair._id,
    'completed',
    input.staff.id,
    input.notes || 'Case closed'
  );

  await notify({
    user: repair.customer,
    type: 'repair_completed',
    title: 'Repair case closed',
    message: `Repair ${repair.referenceNumber} has been closed.`,
    repairRequest: repair._id,
    dedupeKey: `repair_closed_notify:${repair._id}`
  });

  const { enqueueOutboxEvent, kickOutboxProcessor, processOutboxBatch } = await import('./outbox.js');
  await enqueueOutboxEvent({
    channel: 'repair_message',
    dedupeKey: `repair_closed_message:${repair._id}`,
    orderingKey: String(repair._id),
    sequence: 3,
    payload: {
      repairId: String(repair._id),
      actorId: input.staff.id,
      body: input.notes || `Repair case ${repair.referenceNumber} has been closed.`,
      messageType: 'status_update',
      visibility: 'customer_visible'
    }
  });
  kickOutboxProcessor();
  await processOutboxBatch(10);

  await writeAudit({
    actor: input.staff.id,
    action: 'repair.close',
    entityType: 'RepairRequest',
    entityId: repair._id,
    shop: repair.shop,
    details: { caseSummary: repair.caseSummary }
  });

  const { postSystemRepairMessage } = await import('./repairMessages.js');
  await postSystemRepairMessage({
    repairId: String(repair._id),
    actorId: input.staff.id,
    messageType: 'status_update',
    body: repair.caseSummary
  });

  return RepairRequest.findById(repair._id);
}

/** Authorized reopen of a closed case with mandatory reason + audit. */
export async function reopenRepairCase(input: {
  repairId: string;
  staff: AuthUser;
  reason: string;
}) {
  const repair = await RepairRequest.findById(input.repairId);
  if (!repair) throw new AppError('Repair not found', 404, 'NOT_FOUND');
  assertShopAccess(input.staff, repair.shop.toString());
  if (input.staff.role !== 'shop_admin') {
    throw new AppError('Only shop admins can reopen cases', 403, 'FORBIDDEN');
  }
  if (repair.status !== 'completed') {
    throw new AppError('Only closed repairs can be reopened', 409, 'INVALID_STATE');
  }
  const reason = String(input.reason || '').trim();
  if (reason.length < 5) {
    throw new AppError('Reopen reason required (min 5 characters)', 400, 'REASON_REQUIRED');
  }

  repair.status = 'ready_for_collection';
  repair.reopenedAt = new Date();
  repair.reopenedBy = new mongoose.Types.ObjectId(input.staff.id);
  repair.reopenReason = reason;
  repair.completedAt = undefined;
  repair.closedBy = undefined;
  await repair.save();

  await RepairStatusHistory.create({
    repairRequest: repair._id,
    fromStatus: 'completed',
    toStatus: 'ready_for_collection',
    changedBy: input.staff.id,
    note: `Reopened: ${reason}`
  });

  await writeAudit({
    actor: input.staff.id,
    action: 'repair.reopen',
    entityType: 'RepairRequest',
    entityId: repair._id,
    shop: repair.shop,
    details: { reason }
  });

  return RepairRequest.findById(repair._id);
}

/** Shop staff posts a customer-visible progress update (with explanation). */
export async function postCustomerStatusUpdate(input: {
  repairId: string;
  staff: AuthUser;
  message: string;
  messageType?: 'general' | 'status_update' | 'estimate' | 'payment' | 'system';
}) {
  const repair = await RepairRequest.findById(input.repairId);
  if (!repair) throw new AppError('Repair not found', 404, 'NOT_FOUND');
  assertShopAccess(input.staff, repair.shop.toString());
  if (!['shop_admin', 'mechanic', 'parts_coordinator'].includes(input.staff.role)) {
    throw new AppError('Forbidden', 403, 'FORBIDDEN');
  }
  const body = String(input.message || '').trim();
  if (body.length < 1) throw new AppError('Message required', 400, 'INVALID_BODY');

  const { postRepairMessage } = await import('./repairMessages.js');
  const message = await postRepairMessage({
    repairId: String(repair._id),
    user: input.staff,
    body,
    visibility: 'customer_visible',
    messageType: input.messageType || 'status_update'
  });

  await writeAudit({
    actor: input.staff.id,
    action: 'repair.customer_status_update',
    entityType: 'RepairRequest',
    entityId: repair._id,
    shop: repair.shop,
    details: { messageType: input.messageType || 'status_update' }
  });

  return message;
}

async function assertMechanicOwnsRepair(repairId: string, mechanic: AuthUser) {
  const repair = await RepairRequest.findById(repairId);
  if (!repair) throw new AppError('Repair not found', 404, 'NOT_FOUND');
  assertShopAccess(mechanic, repair.shop.toString());
  if (mechanic.role === 'mechanic' && repair.assignedMechanic?.toString() !== mechanic.id) {
    throw new AppError('Not assigned to this repair', 403, 'FORBIDDEN');
  }
  return repair;
}
