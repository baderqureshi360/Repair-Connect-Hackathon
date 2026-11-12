import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app.js';
import {
  GoodsReceipt,
  Part,
  RepairShop,
  ShopMembership,
  SupplierBusiness,
  SupplierLedgerEntry,
  SupplierPurchaseOrder,
  SupplierQuotation,
  SupplierRfq,
  User
} from '../models/index.js';

const app = createApp();

async function loginToken(email: string, password: string) {
  const login = await request(app).post('/api/v1/auth/login').send({ email, password });
  expect(login.status).toBe(200);
  return login.body.data as { token: string; user: { id: string } };
}

async function approveSupplier(suffix: string) {
  let email = `p4.sup.${suffix}@example.com`;
  const basePayload = {
    contactPerson: 'P4 Supplier',
    phone: '+92-300-5550001',
    password: 'SecurePass1',
    confirmPassword: 'SecurePass1',
    address: '40 Fulfil Street',
    city: 'Lahore',
    region: 'Punjab',
    description: 'Phase 4 supplier for PO receiving and ledger tests covering fulfilment.',
    partCategories: ['screens_displays'],
    supportedBrands: ['Samsung'],
    deliveryCities: ['Lahore'],
    termsAccepted: true
  };
  let businessName = `P4 Hub ${suffix}`;
  let reg = await request(app)
    .post('/api/v1/public/supplier-applications/register')
    .send({ ...basePayload, email, businessName });
  // Memory replica-set can transiently LockTimeout under parallel suite pressure
  for (let attempt = 0; attempt < 3 && reg.status >= 500; attempt++) {
    await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
    email = `p4.sup.${suffix}.r${attempt}@example.com`;
    businessName = `P4 Hub ${suffix} r${attempt}`;
    reg = await request(app)
      .post('/api/v1/public/supplier-applications/register')
      .send({ ...basePayload, email, businessName });
  }
  expect(reg.status).toBe(201);

  const opsEmail = `ops.p4.${suffix}@repairconnect.platform`;
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
  const email = `admin.p4.${suffix}@example.com`;
  const admin = await User.create({
    email,
    passwordHash: await bcrypt.hash('SecurePass1', 12),
    name: 'Admin',
    role: 'shop_admin',
    accountStatus: 'active',
    isActive: true
  });
  const shop = await RepairShop.create({
    name: `P4 Shop ${suffix}`,
    code: `P4${suffix}`.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 12),
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

async function acceptRfqFlow(suffix: string, partialLine = false) {
  const s1 = await approveSupplier(`1-${suffix}`);
  const shop = await createShopAdmin(suffix);

  const rfq = await request(app)
    .post('/api/v1/supplier-network/rfqs')
    .set('Authorization', `Bearer ${shop.login.token}`)
    .send({
      shopId: String(shop.shop._id),
      title: 'Phase 4 RFQ',
      supplierBusinessIds: [String(s1.business._id)],
      items: [
        { name: 'OLED Panel', quantity: 10, sku: 'OLED-S21' },
        { name: 'Battery Pack', quantity: 5, sku: 'BAT-S21' }
      ],
      send: true
    });
  expect(rfq.status).toBe(201);
  const lines = rfq.body.data.items;
  const quote = await request(app)
    .post(`/api/v1/supplier-network/rfqs/${rfq.body.data.publicId}/quotations`)
    .set('Authorization', `Bearer ${s1.supplier.token}`)
    .send({
      lines: lines.map((l: { lineId: string; name: string }) => ({
        rfqLineId: l.lineId,
        unitPrice: l.name.includes('Battery') ? 2000 : 10000,
        availableQuantity: 50,
        quotedQuantity: l.name.includes('Battery') ? 5 : 10,
        warranty: '90 days'
      })),
      deliveryCharges: 500,
      taxPercent: 0
    });
  expect(quote.status).toBe(201);

  const acceptedLineIds = partialLine ? [quote.body.data.lines[0].lineId] : [];
  const accept = await request(app)
    .post(`/api/v1/supplier-network/rfqs/${rfq.body.data.publicId}/accept`)
    .set('Authorization', `Bearer ${shop.login.token}`)
    .send({ quotationId: quote.body.data.id, acceptedLineIds });
  expect(accept.status).toBe(200);

  return { s1, shop, rfq: rfq.body.data, quote: quote.body.data, acceptedLineIds };
}

describe('Supplier network Phase 4 — PO, receiving, ledger', () => {
  it('creates PO from full and partial quotation acceptance', async () => {
    const full = await acceptRfqFlow(`full-${Date.now()}`);
    const poFull = await request(app)
      .post('/api/v1/supplier-network/purchase-orders')
      .set('Authorization', `Bearer ${full.shop.login.token}`)
      .send({ rfqId: full.rfq.publicId, issue: true });
    expect(poFull.status).toBe(201);
    expect(poFull.body.data.status).toBe('issued');
    expect(poFull.body.data.lines.length).toBe(2);
    expect(poFull.body.data.grandTotal).toBeGreaterThan(0);

    const partial = await acceptRfqFlow(`part-${Date.now()}`, true);
    const poPartial = await request(app)
      .post('/api/v1/supplier-network/purchase-orders')
      .set('Authorization', `Bearer ${partial.shop.login.token}`)
      .send({
        rfqId: partial.rfq.publicId,
        acceptedLineIds: partial.acceptedLineIds,
        issue: true
      });
    expect(poPartial.status).toBe(201);
    expect(poPartial.body.data.lines.length).toBe(1);
  });

  it('handles acknowledge, reject, shipments, partial GRN, inventory, and payables', async () => {
    const ctx = await acceptRfqFlow(`flow-${Date.now()}`);
    const poRes = await request(app)
      .post('/api/v1/supplier-network/purchase-orders')
      .set('Authorization', `Bearer ${ctx.shop.login.token}`)
      .send({ rfqId: ctx.rfq.publicId, issue: true });
    expect(poRes.status).toBe(201);
    const poId = poRes.body.data.publicId;
    const lineA = poRes.body.data.lines[0];
    const lineB = poRes.body.data.lines[1];

    // Stock must not change on issue
    expect(await Part.countDocuments({ shop: ctx.shop.shop._id })).toBe(0);

    // Outsider supplier cannot see PO
    const outsider = await approveSupplier(`out-${Date.now()}`);
    const denied = await request(app)
      .get(`/api/v1/supplier-network/purchase-orders/${poId}`)
      .set('Authorization', `Bearer ${outsider.supplier.token}`);
    expect(denied.status).toBe(404);

    const ack = await request(app)
      .post(`/api/v1/supplier-network/purchase-orders/${poId}/acknowledge`)
      .set('Authorization', `Bearer ${ctx.s1.supplier.token}`)
      .send({});
    expect(ack.status).toBe(200);
    expect(ack.body.data.status).toBe('acknowledged');

    // Silent price change blocked — must use amend with reason; after ack amend works with audit
    const amend = await request(app)
      .post(`/api/v1/supplier-network/purchase-orders/${poId}/amend`)
      .set('Authorization', `Bearer ${ctx.shop.login.token}`)
      .send({
        reason: 'Agreed price correction after call',
        lines: [{ lineId: lineA.lineId, unitPrice: lineA.unitPrice }]
      });
    expect(amend.status).toBe(200);
    expect(amend.body.data.revision).toBeGreaterThan(1);
    expect(amend.body.data.amendments.length).toBeGreaterThan(0);

    // Partial shipment — does NOT fulfil PO
    const ship = await request(app)
      .post('/api/v1/supplier-network/shipments')
      .set('Authorization', `Bearer ${ctx.s1.supplier.token}`)
      .send({
        purchaseOrderId: poId,
        carrier: 'TCS',
        trackingNumber: 'TCS123',
        dispatch: true,
        lines: [{ poLineId: lineA.lineId, quantity: 4 }]
      });
    expect(ship.status).toBe(201);
    expect(ship.body.data.status).toBe('dispatched');

    const afterShip = await SupplierPurchaseOrder.findOne({ publicId: poId });
    expect(afterShip?.status).toBe('acknowledged');

    // Partial receive — only accepted qty enters stock
    const grn1 = await request(app)
      .post('/api/v1/supplier-network/goods-receipts')
      .set('Authorization', `Bearer ${ctx.shop.login.token}`)
      .send({
        purchaseOrderId: poId,
        shipmentId: ship.body.data.publicId,
        idempotencyKey: `idem-grn1-${poId}`,
        lines: [
          {
            poLineId: lineA.lineId,
            quantityAccepted: 3,
            quantityDamaged: 1,
            damageReason: 'Cracked glass on arrival',
            quantityRejected: 0,
            quantityShort: 0
          }
        ]
      });
    expect(grn1.status).toBe(201);
    expect(grn1.body.data.totalAcceptedValue).toBe(3 * lineA.unitPrice);

    const parts = await Part.find({ shop: ctx.shop.shop._id });
    expect(parts.length).toBe(1);
    expect(parts[0].quantityAvailable).toBe(3);

    const mid = await SupplierPurchaseOrder.findOne({ publicId: poId });
    expect(mid?.status).toBe('partially_fulfilled');

    // Duplicate idempotent receive returns same GRN, no double stock
    const grnDup = await request(app)
      .post('/api/v1/supplier-network/goods-receipts')
      .set('Authorization', `Bearer ${ctx.shop.login.token}`)
      .send({
        purchaseOrderId: poId,
        idempotencyKey: `idem-grn1-${poId}`,
        lines: [
          {
            poLineId: lineA.lineId,
            quantityAccepted: 3,
            quantityDamaged: 1,
            damageReason: 'Cracked glass on arrival'
          }
        ]
      });
    expect(grnDup.status).toBe(201);
    expect(grnDup.body.data.publicId).toBe(grn1.body.data.publicId);
    const partAgain = await Part.findById(parts[0]._id);
    expect(partAgain?.quantityAvailable).toBe(3);

    // Second receive remaining for line A + all of line B
    const remainA = lineA.quantityOrdered - 3;
    const grn2 = await request(app)
      .post('/api/v1/supplier-network/goods-receipts')
      .set('Authorization', `Bearer ${ctx.shop.login.token}`)
      .send({
        purchaseOrderId: poId,
        idempotencyKey: `idem-grn2-${poId}`,
        lines: [
          { poLineId: lineA.lineId, quantityAccepted: remainA },
          { poLineId: lineB.lineId, quantityAccepted: lineB.quantityOrdered }
        ]
      });
    expect(grn2.status).toBe(201);

    const done = await SupplierPurchaseOrder.findOne({ publicId: poId });
    expect(done?.status).toBe('fulfilled');

    // Ledger: obligation + goods received
    const ledger = await request(app)
      .get('/api/v1/supplier-network/ledger')
      .query({ shopId: String(ctx.shop.shop._id), supplierBusinessId: String(ctx.s1.business._id) })
      .set('Authorization', `Bearer ${ctx.shop.login.token}`);
    expect(ledger.status).toBe(200);
    expect(ledger.body.data.some((e: { kind: string }) => e.kind === 'po_obligation')).toBe(true);
    expect(ledger.body.data.some((e: { kind: string }) => e.kind === 'goods_received')).toBe(true);

    const pay = await request(app)
      .post('/api/v1/supplier-network/ledger/payments')
      .set('Authorization', `Bearer ${ctx.shop.login.token}`)
      .send({
        shopId: String(ctx.shop.shop._id),
        supplierBusinessId: String(ctx.s1.business._id),
        purchaseOrderId: poRes.body.data.id,
        amount: 1000,
        paymentMethod: 'bank_transfer',
        externalReference: 'TRX-1',
        idempotencyKey: `pay-${poId}`
      });
    expect(pay.status).toBe(201);

    const bal = await request(app)
      .get('/api/v1/supplier-network/ledger/balance')
      .query({ shopId: String(ctx.shop.shop._id), supplierBusinessId: String(ctx.s1.business._id) })
      .set('Authorization', `Bearer ${ctx.shop.login.token}`);
    expect(bal.status).toBe(200);
    expect(bal.body.data.totalPayments).toBe(1000);

    const rev = await request(app)
      .post(`/api/v1/supplier-network/ledger/${pay.body.data.id}/reverse`)
      .set('Authorization', `Bearer ${ctx.shop.login.token}`)
      .send({ reason: 'Payment recorded against wrong supplier' });
    expect(rev.status).toBe(200);
    expect(rev.body.data.kind).toBe('reversal');

    const reports = await request(app)
      .get('/api/v1/supplier-network/purchasing-reports')
      .query({ shopId: String(ctx.shop.shop._id) })
      .set('Authorization', `Bearer ${ctx.shop.login.token}`);
    expect(reports.status).toBe(200);
    expect(reports.body.data.goodsReceivedVersusOrdered.length).toBeGreaterThan(0);
  });

  it('rejects PO and blocks cross-shop access', async () => {
    const ctx = await acceptRfqFlow(`rej-${Date.now()}`);
    const other = await createShopAdmin(`other-${Date.now()}`);
    const poRes = await request(app)
      .post('/api/v1/supplier-network/purchase-orders')
      .set('Authorization', `Bearer ${ctx.shop.login.token}`)
      .send({ rfqId: ctx.rfq.publicId, issue: true });
    const poId = poRes.body.data.publicId;

    const cross = await request(app)
      .get(`/api/v1/supplier-network/purchase-orders/${poId}`)
      .set('Authorization', `Bearer ${other.login.token}`);
    expect(cross.status).toBe(403);

    const reject = await request(app)
      .post(`/api/v1/supplier-network/purchase-orders/${poId}/reject`)
      .set('Authorization', `Bearer ${ctx.s1.supplier.token}`)
      .send({ reason: 'Cannot meet delivery timeline' });
    expect(reject.status).toBe(200);
    expect(reject.body.data.status).toBe('cancelled');
  });

  it('prevents over-receive and does not stock rejected quantities', async () => {
    const ctx = await acceptRfqFlow(`ov-${Date.now()}`);
    const poRes = await request(app)
      .post('/api/v1/supplier-network/purchase-orders')
      .set('Authorization', `Bearer ${ctx.shop.login.token}`)
      .send({ rfqId: ctx.rfq.publicId, issue: true });
    const poId = poRes.body.data.publicId;
    const line = poRes.body.data.lines[0];

    await request(app)
      .post(`/api/v1/supplier-network/purchase-orders/${poId}/acknowledge`)
      .set('Authorization', `Bearer ${ctx.s1.supplier.token}`)
      .send({});

    const over = await request(app)
      .post('/api/v1/supplier-network/goods-receipts')
      .set('Authorization', `Bearer ${ctx.shop.login.token}`)
      .send({
        purchaseOrderId: poId,
        lines: [{ poLineId: line.lineId, quantityAccepted: line.quantityOrdered + 5 }]
      });
    expect(over.status).toBe(409);

    const rejectOnly = await request(app)
      .post('/api/v1/supplier-network/goods-receipts')
      .set('Authorization', `Bearer ${ctx.shop.login.token}`)
      .send({
        purchaseOrderId: poId,
        idempotencyKey: `rej-only-${poId}`,
        lines: [
          {
            poLineId: line.lineId,
            quantityAccepted: 0,
            quantityRejected: 2,
            rejectReason: 'Wrong model shipped'
          }
        ]
      });
    expect(rejectOnly.status).toBe(201);
    expect(await Part.countDocuments({ shop: ctx.shop.shop._id })).toBe(0);
    expect(await GoodsReceipt.countDocuments({ purchaseOrder: poRes.body.data.id })).toBe(1);
    expect(await SupplierLedgerEntry.countDocuments({ kind: 'goods_received' })).toBe(0);
  });
});
