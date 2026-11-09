/**
 * Operational shop roles: customer | mechanic | parts_coordinator | shop_admin.
 * Platform authority (not shop-scoped): platform_operator — reviews shop applications only.
 * Ordinary shop admins never receive platform privileges.
 */
export const ROLES = [
  'customer',
  'mechanic',
  'parts_coordinator',
  'shop_admin',
  'platform_operator'
] as const;
export type Role = (typeof ROLES)[number];

export const OPERATIONAL_ROLES = [
  'customer',
  'mechanic',
  'parts_coordinator',
  'shop_admin'
] as const;

export const PLATFORM_ROLES = ['platform_operator'] as const;

/** Intake channel. Optional — historical records may be unset. */
export const REPAIR_SOURCES = ['online', 'walk_in'] as const;
export type RepairSource = (typeof REPAIR_SOURCES)[number];

export const REPAIR_STATUSES = [
  'submitted',
  'assigned',
  'diagnosing',
  'estimate_pending',
  'estimate_approved',
  'estimate_rejected',
  'awaiting_parts',
  'parts_reserved',
  'ready_to_start',
  'in_progress',
  'ready_for_collection',
  'completed',
  'cancelled'
] as const;
export type RepairStatus = (typeof REPAIR_STATUSES)[number];

/** Controlled transitions — invalid ones are rejected by the service layer */
export const STATUS_TRANSITIONS: Record<RepairStatus, RepairStatus[]> = {
  submitted: ['assigned', 'cancelled'],
  assigned: ['diagnosing', 'cancelled'],
  diagnosing: ['estimate_pending', 'cancelled'],
  estimate_pending: ['estimate_approved', 'estimate_rejected', 'cancelled'],
  estimate_approved: ['awaiting_parts', 'ready_to_start', 'parts_reserved', 'estimate_pending', 'cancelled'],
  estimate_rejected: ['estimate_pending', 'cancelled'],
  awaiting_parts: ['parts_reserved', 'ready_to_start', 'estimate_pending', 'cancelled'],
  parts_reserved: ['ready_to_start', 'in_progress', 'awaiting_parts', 'estimate_pending', 'cancelled'],
  ready_to_start: ['in_progress', 'awaiting_parts', 'estimate_pending', 'cancelled'],
  in_progress: ['ready_for_collection', 'awaiting_parts', 'cancelled'],
  ready_for_collection: ['completed', 'cancelled'],
  completed: [],
  cancelled: []
};

/** Transfer lifecycle statuses (aliases kept for backward compatibility). */
export const TRANSFER_STATUSES = [
  'requested',
  'awaiting_transfer',
  'approved', // alias of awaiting_transfer (legacy)
  'in_transit',
  'dispatched', // alias of in_transit (legacy)
  'received',
  'reserved',
  'rejected',
  'cancelled'
] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];
