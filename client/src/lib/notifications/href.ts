/**
 * Resolve deep-link for a notification based on type, repairRequest, and meta.
 * Safe defaults — never invent another customer's private data.
 */
export type NotificationLike = {
  type?: string;
  repairRequest?: string | { _id?: string } | null;
  meta?: Record<string, unknown> | null;
};

function repairId(n: NotificationLike): string | null {
  const r = n.repairRequest;
  if (!r) return null;
  if (typeof r === 'string') return r;
  if (typeof r === 'object' && r._id) return String(r._id);
  return null;
}

export function hrefForNotification(
  n: NotificationLike,
  role?: string | null
): string | null {
  const meta = (n.meta || {}) as Record<string, unknown>;
  const hint = String(meta.hrefHint || '');
  const type = String(n.type || '');
  const rid = repairId(n);

  if (hint === 'inventory' || type === 'low_stock') {
    return role === 'parts_coordinator' || role === 'shop_admin'
      ? '/app/parts/inventory'
      : '/app/notifications';
  }
  if (hint === 'parts_request' || type === 'parts_request') {
    return role === 'parts_coordinator' || role === 'shop_admin'
      ? '/app/parts/requests'
      : rid
        ? `/app/repairs/${rid}`
        : '/app/notifications';
  }
  if (
    hint === 'purchase_order' ||
    type === 'supplier_po' ||
    type === 'supplier_grn' ||
    type === 'supplier_shipment'
  ) {
    const poId = meta.purchaseOrderId ? String(meta.purchaseOrderId) : '';
    if (role === 'supplier') {
      return poId ? `/app/supplier/purchase-orders/${poId}` : '/app/supplier/purchase-orders';
    }
    return poId ? `/app/admin/purchase-orders/${poId}` : '/app/admin/purchase-orders';
  }
  if (type === 'supplier_rfq' || type === 'supplier_quotation') {
    if (role === 'supplier') return '/app/supplier/rfqs';
    const rfqId = meta.rfqId ? String(meta.rfqId) : '';
    return rfqId ? `/app/admin/rfqs/${rfqId}` : '/app/admin/rfqs';
  }
  if (type === 'supplier_finance') {
    return role === 'supplier' ? '/app/supplier' : '/app/admin/supplier-finance';
  }
  if (type === 'supplier_message') {
    return role === 'supplier' ? '/app/supplier/messages' : '/app/admin/messages';
  }
  if (type === 'appointment_booked' || type === 'appointment_reminder') {
    if (role === 'customer') return '/app/customer/appointments';
    if (role === 'shop_admin') return '/app/admin/appointments';
  }
  if (type === 'payment_received') {
    return role === 'customer'
      ? '/app/customer/receipts'
      : rid
        ? `/app/repairs/${rid}`
        : '/app/notifications';
  }
  if (rid) return `/app/repairs/${rid}`;
  return null;
}

export function formatNotificationTime(iso: string | Date | undefined, locale = 'en'): string {
  if (!iso) return '';
  const d = typeof iso === 'string' || iso instanceof Date ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return locale.startsWith('ur') ? 'ابھی' : 'Just now';
  if (mins < 60) return locale.startsWith('ur') ? `${mins} منٹ قبل` : `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return locale.startsWith('ur') ? `${hours} گھنٹے قبل` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return locale.startsWith('ur') ? `${days} دن قبل` : `${days}d ago`;
  return d.toLocaleDateString(locale.startsWith('ur') ? 'ur-PK' : 'en-GB', {
    day: 'numeric',
    month: 'short'
  });
}

export function referenceLabel(n: NotificationLike): string | null {
  const meta = (n.meta || {}) as Record<string, unknown>;
  if (meta.referenceNumber) return String(meta.referenceNumber);
  if (meta.poPublicId) return String(meta.poPublicId);
  if (meta.purchaseOrderId) return 'PO';
  if (repairId(n)) return 'Repair';
  return null;
}
