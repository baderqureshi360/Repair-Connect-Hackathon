import type { RepairStatus } from '../types/roles.js';

/**
 * Customer-facing progress labels mapped over internal REPAIR_STATUSES.
 * Internal mechanic notes and shop-only statuses are never exposed as raw enums to customers.
 */
export const CUSTOMER_STATUS_KEYS = [
  'request_received',
  'awaiting_diagnosis',
  'diagnosis_completed',
  'awaiting_customer_approval',
  'awaiting_parts',
  'parts_received',
  'repair_in_progress',
  'repair_completed',
  'ready_for_collection',
  'closed',
  'cancelled'
] as const;

export type CustomerStatusKey = (typeof CUSTOMER_STATUS_KEYS)[number];

const LABELS_EN: Record<CustomerStatusKey, string> = {
  request_received: 'Request Received',
  awaiting_diagnosis: 'Awaiting Diagnosis',
  diagnosis_completed: 'Diagnosis Completed',
  awaiting_customer_approval: 'Awaiting Customer Approval',
  awaiting_parts: 'Awaiting Parts',
  parts_received: 'Parts Received',
  repair_in_progress: 'Repair In Progress',
  repair_completed: 'Repair Completed',
  ready_for_collection: 'Ready for Collection',
  closed: 'Closed',
  cancelled: 'Cancelled'
};

const LABELS_UR: Record<CustomerStatusKey, string> = {
  request_received: 'درخواست موصول ہوئی',
  awaiting_diagnosis: 'تشخیص کا انتظار',
  diagnosis_completed: 'تشخیص مکمل',
  awaiting_customer_approval: 'گاہک کی منظوری کا انتظار',
  awaiting_parts: 'پارٹس کا انتظار',
  parts_received: 'پارٹس موصول',
  repair_in_progress: 'مرمت جاری',
  repair_completed: 'مرمت مکمل',
  ready_for_collection: 'وصولی کے لیے تیار',
  closed: 'بند',
  cancelled: 'منسوخ'
};

export function mapCustomerStatus(
  status: string,
  opts?: { workCompletedAt?: Date | null; collectedAt?: Date | null }
): CustomerStatusKey {
  switch (status as RepairStatus) {
    case 'submitted':
      return 'request_received';
    case 'assigned':
    case 'diagnosing':
      return 'awaiting_diagnosis';
    case 'estimate_pending':
      return 'awaiting_customer_approval';
    case 'estimate_approved':
      return opts?.workCompletedAt ? 'repair_completed' : 'diagnosis_completed';
    case 'estimate_rejected':
      return 'awaiting_customer_approval';
    case 'awaiting_parts':
      return 'awaiting_parts';
    case 'parts_reserved':
      return 'parts_received';
    case 'ready_to_start':
    case 'in_progress':
      return 'repair_in_progress';
    case 'ready_for_collection':
      if (opts?.collectedAt) return 'ready_for_collection';
      return opts?.workCompletedAt ? 'repair_completed' : 'ready_for_collection';
    case 'completed':
      return 'closed';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'request_received';
  }
}

export function customerStatusLabel(key: CustomerStatusKey, lang: 'en' | 'ur' = 'en') {
  return (lang === 'ur' ? LABELS_UR : LABELS_EN)[key];
}

export function customerStatusPayload(
  repair: {
    status: string;
    workCompletedAt?: Date | null;
    collectedAt?: Date | null;
  },
  lang: 'en' | 'ur' = 'en'
) {
  const key = mapCustomerStatus(repair.status, {
    workCompletedAt: repair.workCompletedAt,
    collectedAt: repair.collectedAt
  });
  return {
    key,
    label: customerStatusLabel(key, lang),
    internalStatus: repair.status
  };
}
