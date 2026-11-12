import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app.js';
import {
  RepairShop,
  ShopMembership,
  SupplierBusiness,
  SupplierPurchaseOrder,
  User
} from '../models/index.js';
import { rowsToCsv, csvEscapeCell } from '../utils/csvExport.js';

const app = createApp();

async function loginToken(email: string, password: string) {
  const login = await request(app).post('/api/v1/auth/login').send({ email, password });
  expect(login.status).toBe(200);
  return login.body.data as { token: string; user: { id: string } };
}

async function approveSupplier(suffix: string) {
  const email = `p5b.sup.${suffix}@example.com`;
  const reg = await request(app)
    .post('/api/v1/public/supplier-applications/register')
    .send({
      contactPerson: 'P5B Supplier',
      email,
      phone: '+92-300-5550001',
      password: 'SecurePass1',
      confirmPassword: 'SecurePass1',
      businessName: `P5B Hub ${suffix}`,
      address: '40 Analytics Street',
      city: 'Lahore',
      region: 'Punjab',
      description: 'Phase 5B supplier for purchasing analytics and marketplace comparison coverage.',
      partCategories: ['screens_displays'],
      supportedBrands: ['Samsung'],
      deliveryCities: ['Lahore'],
      termsAccepted: true
    });
  expect(reg.status).toBe(201);

  const opsEmail = `ops.p5b.${suffix}@repairconnect.platform`;
  await User.create({
    email: opsEmail,
    passwordHash: await bcrypt.hash('OperatorPass1', 12),
    name: 'Ops',
    role: 'platform_operator',
    accountStatus: 'active',
    isActive: true
  });
  const ops = await loginToken(opsEmail, 'OperatorPass1');
  await request(app)
    .post(`/api/v1/platform/supplier-applications/${reg.body.data.id}/approve`)
    .set('Authorization', `Bearer ${ops.token}`)
    .send({});
  const supplier = await loginToken(email, 'SecurePass1');
  const business = await SupplierBusiness.findOne({ businessEmail: email });
  return { supplier, business: business! };
}

async function createShopAdmin(suffix: string) {
  const email = `admin.p5b.${suffix}@example.com`;
  const admin = await User.create({
    email,
    passwordHash: await bcrypt.hash('SecurePass1', 12),
    name: 'Admin',
    role: 'shop_admin',
    accountStatus: 'active',
    isActive: true
  });
  const shop = await RepairShop.create({
    name: `P5B Shop ${suffix}`,
    code: `P5B${suffix}`.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 12),
    address: '1 A',
    city: 'Lahore',
    region: 'Punjab',
    phone: '+92-42-1',
    email,
    isActive: true
  });
  await ShopMembership.create({
    user: admin._id,
    shop: shop._id,
    role: 'shop_admin',
    isActive: true
  });
  return { shop, login: await loginToken(email, 'SecurePass1'), admin };
}

async function fulfilFlow(suffix: string, qty = 4, acceptQty = 4) {
  const s1 = await approveSupplier(suffix);
  const shop = await createShopAdmin(suffix);
  const rfq = await request(app)
    .post('/api/v1/supplier-network/rfqs')
    .set('Authorization', `Bearer ${shop.login.token}`)
    .send({
      shopId: String(shop.shop._id),
      title: `P5B RFQ ${suffix}`,
      supplierBusinessIds: [String(s1.business._id)],
      items: [{ name: 'Analytics OLED', quantity: qty, sku: 'AN-OLED' }],
      send: true
    });
  expect(rfq.status).toBe(201);
  const quote = await request(app)
    .post(`/api/v1/supplier-network/rfqs/${rfq.body.data.publicId}/quotations`)
    .set('Authorization', `Bearer ${s1.supplier.token}`)
    .send({
      lines: [
        {
          rfqLineId: rfq.body.data.items[0].lineId,
          unitPrice: 2500,
          availableQuantity: 50,
          quotedQuantity: qty
        }
      ],
      estimatedDeliveryDate: new Date(Date.now() + 5 * 86400000).toISOString()
    });
  expect(quote.status).toBe(201);
  await request(app)
    .post(`/api/v1/supplier-network/rfqs/${rfq.body.data.publicId}/accept`)
    .set('Authorization', `Bearer ${shop.login.token}`)
    .send({ quotationId: quote.body.data.id });
  const expectedArrival = new Date(Date.now() + 3 * 86400000);
  const poRes = await request(app)
    .post('/api/v1/supplier-network/purchase-orders')
    .set('Authorization', `Bearer ${shop.login.token}`)
    .send({
      rfqId: rfq.body.data.publicId,
      issue: true,
      expectedDeliveryDate: expectedArrival.toISOString()
    });
  expect(poRes.status).toBe(201);
  const poId = poRes.body.data.publicId;
  const lineId = poRes.body.data.lines[0].lineId;
  await request(app)
    .post(`/api/v1/supplier-network/purchase-orders/${poId}/acknowledge`)
    .set('Authorization', `Bearer ${s1.supplier.token}`)
    .send({ expectedDeliveryDate: expectedArrival.toISOString() });
  const ship = await request(app)
    .post('/api/v1/supplier-network/shipments')
    .set('Authorization', `Bearer ${s1.supplier.token}`)
    .send({
      purchaseOrderId: poId,
      carrier: 'TCS',
      trackingNumber: `AN-${suffix}`,
      expectedArrivalDate: expectedArrival.toISOString(),
      dispatch: true,
      lines: [{ poLineId: lineId, quantity: acceptQty }]
    });
  expect(ship.status).toBe(201);
  await request(app)
    .patch(`/api/v1/supplier-network/shipments/${ship.body.data.publicId}`)
    .set('Authorization', `Bearer ${s1.supplier.token}`)
    .send({
      status: 'delivered',
      actualArrivalDate: new Date(expectedArrival.getTime() - 86400000).toISOString()
    });
  const grn = await request(app)
    .post('/api/v1/supplier-network/goods-receipts')
    .set('Authorization', `Bearer ${shop.login.token}`)
    .send({
      purchaseOrderId: poId,
      idempotencyKey: `p5b-grn-${suffix}`,
      lines: [
        {
          poLineId: lineId,
          quantityAccepted: acceptQty,
          quantityRejected: Math.max(0, qty - acceptQty),
          quantityDamaged: 0,
          rejectReason: qty > acceptQty ? 'Short shipment' : undefined
        }
      ]
    });
  expect(grn.status).toBe(201);
  const po = await SupplierPurchaseOrder.findOne({ publicId: poId });
  return { s1, shop, po: po!, poId, grn: grn.body.data };
}

describe('Supplier network Phase 5B — purchasing analytics', () => {
  it('guards CSV formula injection', () => {
    expect(csvEscapeCell('=CMD()')).toBe('"\'=CMD()"');
    expect(csvEscapeCell('+1')).toBe('"\'+1"');
    const csv = rowsToCsv([{ name: '=1+1', amount: 10 }]);
    expect(csv).toContain("'=1+1");
  });

  it('isolates shop analytics and matches PO/GRN/ledger totals', async () => {
    const full = await fulfilFlow(`full-${Date.now()}`, 4, 4);
    const partial = await fulfilFlow(`part-${Date.now()}`, 10, 4);
    const otherShop = await createShopAdmin(`iso-${Date.now()}`);

    const analytics = await request(app)
      .get(
        `/api/v1/supplier-network/purchasing-analytics?shopId=${full.shop.shop._id}`
      )
      .set('Authorization', `Bearer ${full.shop.login.token}`);
    expect(analytics.status).toBe(200);
    expect(analytics.body.data.kpis.totalPurchaseOrders).toBeGreaterThanOrEqual(1);
    expect(analytics.body.data.kpis.totalPurchasingValue).toBe(full.po!.grandTotal);
    expect(analytics.body.data.kpis.goodsReceivedValue).toBeCloseTo(
      Number(full.grn.totalAcceptedValue),
      1
    );
    expect(analytics.body.data.kpis.receivedQuantity).toBe(4);
    expect(analytics.body.data.definitions.orderedValue).toBeTruthy();

    // Partial receive reflected in that shop's analytics
    const partAnalytics = await request(app)
      .get(
        `/api/v1/supplier-network/purchasing-analytics?shopId=${partial.shop.shop._id}`
      )
      .set('Authorization', `Bearer ${partial.shop.login.token}`);
    expect(partAnalytics.status).toBe(200);
    expect(partAnalytics.body.data.kpis.receivedQuantity).toBe(4);
    expect(partAnalytics.body.data.kpis.orderedQuantity).toBe(10);

    // Cross-shop forbidden
    const cross = await request(app)
      .get(
        `/api/v1/supplier-network/purchasing-analytics?shopId=${full.shop.shop._id}`
      )
      .set('Authorization', `Bearer ${otherShop.login.token}`);
    expect(cross.status).toBe(403);

    // Supplier cannot access shop purchasing analytics
    const asSupplier = await request(app)
      .get(
        `/api/v1/supplier-network/purchasing-analytics?shopId=${full.shop.shop._id}`
      )
      .set('Authorization', `Bearer ${full.s1.supplier.token}`);
    expect(asSupplier.status).toBe(403);
  });

  it('exports CSV with auth and includes payables after payment/reversal handling', async () => {
    const ctx = await fulfilFlow(`pay-${Date.now()}`, 2, 2);
    const shopId = String(ctx.shop.shop._id);

    // Ledger should already have goods_received from GRN; record a partial payment
    const pay = await request(app)
      .post('/api/v1/supplier-network/ledger/payments')
      .set('Authorization', `Bearer ${ctx.shop.login.token}`)
      .send({
        shopId,
        supplierBusinessId: String(ctx.s1.business._id),
        purchaseOrderId: String(ctx.po._id),
        amount: 1000,
        paymentMethod: 'bank_transfer',
        notes: 'Partial analytics payment'
      });
    expect(pay.status).toBe(201);

    const analytics = await request(app)
      .get(`/api/v1/supplier-network/purchasing-analytics?shopId=${shopId}`)
      .set('Authorization', `Bearer ${ctx.shop.login.token}`);
    expect(analytics.status).toBe(200);
    expect(analytics.body.data.kpis.paidValueInPeriod).toBeGreaterThanOrEqual(1000);
    expect(analytics.body.data.kpis.cashPaymentsInPeriod).toBeGreaterThanOrEqual(1000);
    expect(analytics.body.data.kpis.creditNotesInPeriod).toBe(0);

    const csv = await request(app)
      .get(
        `/api/v1/supplier-network/purchasing-analytics/export.csv?shopId=${shopId}&report=purchase_order_summary`
      )
      .set('Authorization', `Bearer ${ctx.shop.login.token}`);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/csv/);
    expect(csv.text).toContain(ctx.poId);

    const forbiddenCsv = await request(app)
      .get(
        `/api/v1/supplier-network/purchasing-analytics/export.csv?shopId=${shopId}&report=supplier_payables`
      )
      .set('Authorization', `Bearer ${ctx.s1.supplier.token}`);
    expect(forbiddenCsv.status).toBe(403);
  });

  it('isolates supplier analytics and supports marketplace compare without composite score', async () => {
    const a = await fulfilFlow(`cmp-a-${Date.now()}`, 3, 3);
    const b = await fulfilFlow(`cmp-b-${Date.now()}`, 3, 3);

    const mine = await request(app)
      .get('/api/v1/supplier/analytics')
      .set('Authorization', `Bearer ${a.s1.supplier.token}`);
    expect(mine.status).toBe(200);
    expect(mine.body.data.kpis.totalReceivedPurchaseOrders).toBeGreaterThanOrEqual(1);
    expect(mine.body.data.supplierBusinessId).toBe(String(a.s1.business._id));
    // Must not leak other shop IDs in supplier analytics payload
    expect(JSON.stringify(mine.body.data)).not.toContain(String(b.shop.shop._id));

    const otherSupplier = await request(app)
      .get('/api/v1/supplier/analytics')
      .set('Authorization', `Bearer ${b.s1.supplier.token}`);
    expect(otherSupplier.status).toBe(200);
    expect(otherSupplier.body.data.supplierBusinessId).toBe(String(b.s1.business._id));

    // Shop A cannot use supplier analytics
    const shopAsSupplier = await request(app)
      .get('/api/v1/supplier/analytics')
      .set('Authorization', `Bearer ${a.shop.login.token}`);
    expect(shopAsSupplier.status).toBe(403);

    const compare = await request(app)
      .get(
        `/api/v1/marketplace/suppliers/compare?ids=${a.s1.business!.publicId},${b.s1.business!.publicId}&shopId=${a.shop.shop._id}`
      )
      .set('Authorization', `Bearer ${a.shop.login.token}`);
    expect(compare.status).toBe(200);
    expect(compare.body.data.items.length).toBe(2);
    expect(compare.body.data.note).toMatch(/no composite/i);
    expect(compare.body.data.items[0].historicalPurchasingRelationship).toBeTruthy();
    expect(compare.body.data.items[0].fulfilmentPerformance).toBeTruthy();
  });

  it('excludes cancelled POs from default purchasing totals', async () => {
    const ctx = await fulfilFlow(`can-${Date.now()}`, 2, 2);
    // Create a second issued then cancelled PO on same shop/supplier via RFQ path would be heavy;
    // mark an extra synthetic cancelled PO document for the shop.
    await SupplierPurchaseOrder.create({
      publicId: `PO-CAN-${Date.now()}`,
      shop: ctx.shop.shop._id,
      supplierBusiness: ctx.s1.business!._id,
      createdBy: ctx.shop.admin._id,
      status: 'cancelled',
      issuedAt: new Date(),
      cancelledAt: new Date(),
      cancelReason: 'Shop cancelled unused order',
      lines: [
        {
          lineId: 'L1',
          name: 'Cancelled Panel',
          sku: 'CAN-1',
          quantityOrdered: 5,
          unitPrice: 1000,
          lineSubtotal: 5000
        }
      ],
      grandTotal: 5000,
      currency: 'PKR'
    });

    const analytics = await request(app)
      .get(`/api/v1/supplier-network/purchasing-analytics?shopId=${ctx.shop.shop._id}`)
      .set('Authorization', `Bearer ${ctx.shop.login.token}`);
    expect(analytics.status).toBe(200);
    // Default totals exclude cancelled — only the fulfilled PO value
    expect(analytics.body.data.kpis.totalPurchasingValue).toBe(ctx.po!.grandTotal);

    const cancelledOnly = await request(app)
      .get(
        `/api/v1/supplier-network/purchasing-analytics?shopId=${ctx.shop.shop._id}&status=cancelled`
      )
      .set('Authorization', `Bearer ${ctx.shop.login.token}`);
    expect(cancelledOnly.status).toBe(200);
    expect(cancelledOnly.body.data.kpis.totalPurchasingValue).toBe(5000);
  });
});
