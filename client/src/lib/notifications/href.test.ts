import { describe, it, expect } from 'vitest';
import { hrefForNotification, referenceLabel } from './href';

describe('hrefForNotification', () => {
  it('routes repair notifications to repair detail', () => {
    expect(
      hrefForNotification({ type: 'estimate_ready', repairRequest: 'abc123' }, 'customer')
    ).toBe('/app/repairs/abc123');
  });

  it('routes low stock to inventory for staff', () => {
    expect(
      hrefForNotification({ type: 'low_stock', meta: { hrefHint: 'inventory' } }, 'parts_coordinator')
    ).toBe('/app/parts/inventory');
  });

  it('routes PO notifications for shop admin', () => {
    expect(
      hrefForNotification(
        { type: 'supplier_po', meta: { purchaseOrderId: 'po1', hrefHint: 'purchase_order' } },
        'shop_admin'
      )
    ).toBe('/app/admin/purchase-orders/po1');
  });

  it('exposes reference labels without leaking private fields', () => {
    expect(referenceLabel({ meta: { referenceNumber: 'RC-1' } })).toBe('RC-1');
    expect(referenceLabel({ repairRequest: 'x' })).toBe('Repair');
  });
});
