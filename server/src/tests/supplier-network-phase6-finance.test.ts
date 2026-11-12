import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app.js';
import {
  RepairShop,
  ShopMembership,
  SupplierBusiness,
  SupplierLedgerEntry,
  SupplierPurchaseOrder,
  User
} from '../models/index.js';

const app = createApp();

async function loginToken(email: string, password: string) {
  const login = await request(app).post('/api/v1/auth/login').send({ email, password });
  expect(login.status).toBe(200);
  return login.body.data as { token: string; user: { id: string } };
}

async function approveSupplier(suffix: string) {
  const email = `p6.sup.${suffix}@example.com`;
  const reg = await request(app)
    .post('/api/v1/public/supplier-applications/register')
    .send({
      contactPerson: 'P6 Supplier',
      email,
      phone: '+92-300-5550006',
      password: 'SecurePass1',
      confirmPassword: 'SecurePass1',
      businessName: `P6 Hub ${suffix}`,
      address: '60 Finance Street',
      city: 'Lahore',
      region: 'Punjab',
      description: 'Phase 6 supplier for financial integrity coverage of payments and credit notes.',
      partCategories: ['screens_displays'],
      supportedBrands: ['Samsung'],
      deliveryCities: ['Lahore'],
      termsAccepted: true
    });
  expect(reg.status).toBe(201);

  const opsEmail = `ops.p6.${suffix}@repairconnect.platform`;
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
  const email = `admin.p6.${suffix}@example.com`;
  const admin = await User.create({
    email,
    passwordHash: await bcrypt.hash('SecurePass1', 12),
    name: 'Admin',
    role: 'shop_admin',
    accountStatus: 'active',
    isActive: true
  });
  const shop = await RepairShop.create({
    name: `P6 Shop ${suffix}`,
    code: `P6${suffix}`.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 12),
    address: '1 A',
    city: 'Lahore',
    region: 'Punjab',
    phone: '+92-42-6',
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
      title: `P6 RFQ ${suffix}`,
      supplierBusinessIds: [String(s1.business._id)],
      items: [{ name: 'Finance OLED', quantity: qty, sku: 'FN-OLED' }],
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
      trackingNumber: `FN-${suffix}`,
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
      idempotencyKey: `p6-grn-${suffix}`,
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
  return { s1, shop, po: po!, poId, grn: grn.body.data, lineId };
}

describe('Phase 6 — financial integrity', () => {
  it('never classifies credit notes as cash payments in analytics or balance', async () => {
    const ctx = await fulfilFlow(`cn-${Date.now()}`, 4, 4);
    const shopId = String(ctx.shop.shop._id);
    const supplierBusinessId = String(ctx.s1.business._id);
    const receivedValue = Number(ctx.grn.totalAcceptedValue);

    const pay = await request(app)
      .post('/api/v1/supplier-network/ledger/payments')
      .set('Authorization', `Bearer ${ctx.shop.login.token}`)
      .send({
        shopId,
        supplierBusinessId,
        purchaseOrderId: String(ctx.po._id),
        amount: 1000,
        paymentMethod: 'bank_transfer',
        notes: 'Cash payment for integrity check',
        idempotencyKey: `p6-pay-${Date.now()}`
      });
    expect(pay.status).toBe(201);
    expect(pay.body.data.kind).toBe('payment');

    const credit = await request(app)
      .post('/api/v1/supplier-network/ledger/credit-notes')
      .set('Authorization', `Bearer ${ctx.shop.login.token}`)
      .send({
        shopId,
        supplierBusinessId,
        purchaseOrderId: String(ctx.po._id),
        amount: 500,
        notes: 'Supplier credit for damaged unit',
        idempotencyKey: `p6-cn-${Date.now()}`
      });
    expect(credit.status).toBe(201);
    expect(credit.body.data.kind).toBe('credit_note');
    expect(credit.body.data.amount).toBeLessThan(0);

    const analytics = await request(app)
      .get(`/api/v1/supplier-network/purchasing-analytics?shopId=${shopId}`)
      .set('Authorization', `Bearer ${ctx.shop.login.token}`);
    expect(analytics.status).toBe(200);
    const kpis = analytics.body.data.kpis;
    const breakdown = analytics.body.data.expenditureBreakdown;

    expect(kpis.cashPaymentsInPeriod).toBe(1000);
    expect(kpis.paidValueInPeriod).toBe(1000);
    expect(kpis.creditNotesInPeriod).toBe(500);
    // Critical: credit notes must not inflate cash paid value
    expect(kpis.paidValueInPeriod).not.toBe(1500);
    expect(breakdown.cashPayments).toBe(1000);
    expect(breakdown.creditNotes).toBe(500);
    expect(breakdown.paidValue).toBe(1000);
    expect(String(analytics.body.data.definitions.creditNotes)).toMatch(/never/i);

    const balance = await request(app)
      .get(
        `/api/v1/supplier-network/ledger/balance?shopId=${shopId}&supplierBusinessId=${supplierBusinessId}`
      )
      .set('Authorization', `Bearer ${ctx.shop.login.token}`);
    expect(balance.status).toBe(200);
    expect(balance.body.data.totalPayments).toBe(1000);
    expect(balance.body.data.totalCreditNotes).toBe(500);
    // outstanding = goods_received − payment − credit (po_obligation is commitment, not AP)
    expect(balance.body.data.outstandingPayable).toBeCloseTo(receivedValue - 1000 - 500, 1);
    expect(balance.body.data.totalObligations).toBeGreaterThanOrEqual(ctx.po.grandTotal);
  });

  it('reversal neutralizes original payment and drops cash paid KPI', async () => {
    const ctx = await fulfilFlow(`rev-${Date.now()}`, 2, 2);
    const shopId = String(ctx.shop.shop._id);
    const supplierBusinessId = String(ctx.s1.business._id);
    const receivedValue = Number(ctx.grn.totalAcceptedValue);

    const balPrePay = await request(app)
      .get(
        `/api/v1/supplier-network/ledger/balance?shopId=${shopId}&supplierBusinessId=${supplierBusinessId}`
      )
      .set('Authorization', `Bearer ${ctx.shop.login.token}`);
    expect(balPrePay.body.data.outstandingPayable).toBeCloseTo(receivedValue, 1);

    const pay = await request(app)
      .post('/api/v1/supplier-network/ledger/payments')
      .set('Authorization', `Bearer ${ctx.shop.login.token}`)
      .send({
        shopId,
        supplierBusinessId,
        purchaseOrderId: String(ctx.po._id),
        amount: 800,
        paymentMethod: 'cash',
        notes: 'Payment to reverse',
        idempotencyKey: `p6-rev-pay-${Date.now()}`
      });
    expect(pay.status).toBe(201);
    const entryId = pay.body.data.id;

    const before = await request(app)
      .get(`/api/v1/supplier-network/purchasing-analytics?shopId=${shopId}`)
      .set('Authorization', `Bearer ${ctx.shop.login.token}`);
    expect(before.body.data.kpis.cashPaymentsInPeriod).toBe(800);

    const balBefore = await request(app)
      .get(
        `/api/v1/supplier-network/ledger/balance?shopId=${shopId}&supplierBusinessId=${supplierBusinessId}`
      )
      .set('Authorization', `Bearer ${ctx.shop.login.token}`);
    expect(balBefore.body.data.outstandingPayable).toBeCloseTo(receivedValue - 800, 1);

    const rev = await request(app)
      .post(`/api/v1/supplier-network/ledger/${entryId}/reverse`)
      .set('Authorization', `Bearer ${ctx.shop.login.token}`)
      .send({ reason: 'Payment posted against wrong supplier' });
    expect(rev.status).toBe(200);
    expect(rev.body.data.entryType).toBe('reversal');

    const original = await SupplierLedgerEntry.findById(entryId);
    expect(original?.status).toBe('reversed');

    const after = await request(app)
      .get(`/api/v1/supplier-network/purchasing-analytics?shopId=${shopId}`)
      .set('Authorization', `Bearer ${ctx.shop.login.token}`);
    expect(after.body.data.kpis.cashPaymentsInPeriod).toBe(0);
    expect(after.body.data.kpis.paidValueInPeriod).toBe(0);

    const balAfter = await request(app)
      .get(
        `/api/v1/supplier-network/ledger/balance?shopId=${shopId}&supplierBusinessId=${supplierBusinessId}`
      )
      .set('Authorization', `Bearer ${ctx.shop.login.token}`);
    // Reversal + reversed original must net to pre-payment outstanding (not double-apply)
    expect(balAfter.body.data.outstandingPayable).toBeCloseTo(receivedValue, 1);
    expect(balAfter.body.data.totalPayments).toBe(0);
  });

  it('payment idempotency key returns same entry on retry', async () => {
    const ctx = await fulfilFlow(`idem-${Date.now()}`, 2, 2);
    const shopId = String(ctx.shop.shop._id);
    const supplierBusinessId = String(ctx.s1.business._id);
    const key = `p6-idem-${Date.now()}-unique`;

    const body = {
      shopId,
      supplierBusinessId,
      purchaseOrderId: String(ctx.po._id),
      amount: 250,
      paymentMethod: 'jazzcash' as const,
      notes: 'Idempotent payment',
      idempotencyKey: key
    };

    const a = await request(app)
      .post('/api/v1/supplier-network/ledger/payments')
      .set('Authorization', `Bearer ${ctx.shop.login.token}`)
      .send(body);
    const b = await request(app)
      .post('/api/v1/supplier-network/ledger/payments')
      .set('Authorization', `Bearer ${ctx.shop.login.token}`)
      .send(body);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.data.id).toBe(b.body.data.id);

    const concurrentKey = `p6-idem-conc-${Date.now()}`;
    const concurrentBody = { ...body, idempotencyKey: concurrentKey, amount: 100 };
    const [c1, c2] = await Promise.all([
      request(app)
        .post('/api/v1/supplier-network/ledger/payments')
        .set('Authorization', `Bearer ${ctx.shop.login.token}`)
        .send(concurrentBody),
      request(app)
        .post('/api/v1/supplier-network/ledger/payments')
        .set('Authorization', `Bearer ${ctx.shop.login.token}`)
        .send(concurrentBody)
    ]);
    const okStatuses = [c1, c2].filter((r) => r.status === 201);
    expect(okStatuses.length).toBeGreaterThanOrEqual(1);
    const count = await SupplierLedgerEntry.countDocuments({
      shop: ctx.shop.shop._id,
      idempotencyKey: concurrentKey
    });
    expect(count).toBe(1);
  });

  it('blocks cross-shop ledger payment and credit-note IDOR', async () => {
    const a = await fulfilFlow(`idor-a-${Date.now()}`, 2, 2);
    const b = await createShopAdmin(`idor-b-${Date.now()}`);

    const stealPay = await request(app)
      .post('/api/v1/supplier-network/ledger/payments')
      .set('Authorization', `Bearer ${b.login.token}`)
      .send({
        shopId: String(a.shop.shop._id),
        supplierBusinessId: String(a.s1.business._id),
        amount: 50,
        paymentMethod: 'cash',
        notes: 'Cross-shop payment attempt'
      });
    expect(stealPay.status).toBe(403);

    const stealCn = await request(app)
      .post('/api/v1/supplier-network/ledger/credit-notes')
      .set('Authorization', `Bearer ${b.login.token}`)
      .send({
        shopId: String(a.shop.shop._id),
        supplierBusinessId: String(a.s1.business._id),
        amount: 50,
        notes: 'Cross-shop credit attempt'
      });
    expect(stealCn.status).toBe(403);
  });
});
