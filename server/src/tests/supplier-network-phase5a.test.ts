import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app.js';
import {
  RepairShop,
  ShopMembership,
  SupplierBusiness,
  SupplierPurchaseOrder,
  SupplierQuotation,
  SupplierReview,
  SupplierShipment,
  User
} from '../models/index.js';
import { computeSupplierPerformance } from '../services/supplierPerformance.js';
import { aggregateVerifiedReviewStats } from '../services/supplierReviews.js';

const app = createApp();

async function loginToken(email: string, password: string) {
  const login = await request(app).post('/api/v1/auth/login').send({ email, password });
  expect(login.status).toBe(200);
  return login.body.data as { token: string; user: { id: string } };
}

async function approveSupplier(suffix: string) {
  let email = `p5a.sup.${suffix}@example.com`;
  const basePayload = {
    contactPerson: 'P5A Supplier',
    phone: '+92-300-5550001',
    password: 'SecurePass1',
    confirmPassword: 'SecurePass1',
    address: '40 Fulfil Street',
    city: 'Lahore',
    region: 'Punjab',
    description: 'Phase 5A supplier for verified reviews and performance metrics coverage.',
    partCategories: ['screens_displays'],
    supportedBrands: ['Samsung'],
    deliveryCities: ['Lahore'],
    termsAccepted: true
  };
  let businessName = `P5A Hub ${suffix}`;
  let reg = await request(app)
    .post('/api/v1/public/supplier-applications/register')
    .send({ ...basePayload, email, businessName });
  for (let attempt = 0; attempt < 3 && reg.status >= 500; attempt++) {
    await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    email = `p5a.sup.${suffix}.r${attempt}@example.com`;
    businessName = `P5A Hub ${suffix} r${attempt}`;
    reg = await request(app)
      .post('/api/v1/public/supplier-applications/register')
      .send({ ...basePayload, email, businessName });
  }
  expect(reg.status).toBe(201);

  const opsEmail = `ops.p5a.${suffix}@repairconnect.platform`;
  await User.create({
    email: opsEmail,
    passwordHash: await bcrypt.hash('OperatorPass1', 12),
    name: 'Ops',
    role: 'platform_operator',
    accountStatus: 'active',
    isActive: true
  });
  const opsLogin = await loginToken(opsEmail, 'OperatorPass1');
  await request(app)
    .post(`/api/v1/platform/supplier-applications/${reg.body.data.id}/approve`)
    .set('Authorization', `Bearer ${opsLogin.token}`)
    .send({});
  const supplier = await loginToken(email, 'SecurePass1');
  const business = await SupplierBusiness.findOne({ businessEmail: email });
  return { supplier, business: business!, ops: opsLogin };
}

async function createShopAdmin(suffix: string) {
  const email = `admin.p5a.${suffix}@example.com`;
  const admin = await User.create({
    email,
    passwordHash: await bcrypt.hash('SecurePass1', 12),
    name: 'Admin',
    role: 'shop_admin',
    accountStatus: 'active',
    isActive: true
  });
  const shop = await RepairShop.create({
    name: `P5A Shop ${suffix}`,
    code: `P5A${suffix}`.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 12),
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

async function fulfilPoFlow(suffix: string, opts?: { qty?: number; acceptQty?: number }) {
  const qty = opts?.qty ?? 4;
  const acceptQty = opts?.acceptQty ?? qty;
  const s1 = await approveSupplier(suffix);
  const shop = await createShopAdmin(suffix);

  const rfq = await request(app)
    .post('/api/v1/supplier-network/rfqs')
    .set('Authorization', `Bearer ${shop.login.token}`)
    .send({
      shopId: String(shop.shop._id),
      title: `P5A RFQ ${suffix}`,
      supplierBusinessIds: [String(s1.business._id)],
      items: [{ name: 'OLED Panel', quantity: qty, sku: 'OLED-P5A' }],
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
          unitPrice: 5000,
          availableQuantity: 50,
          quotedQuantity: qty
        }
      ],
      estimatedDeliveryDate: new Date(Date.now() + 5 * 86400000).toISOString()
    });
  expect(quote.status).toBe(201);

  const accept = await request(app)
    .post(`/api/v1/supplier-network/rfqs/${rfq.body.data.publicId}/accept`)
    .set('Authorization', `Bearer ${shop.login.token}`)
    .send({ quotationId: quote.body.data.id });
  expect(accept.status).toBe(200);

  const poRes = await request(app)
    .post('/api/v1/supplier-network/purchase-orders')
    .set('Authorization', `Bearer ${shop.login.token}`)
    .send({
      rfqId: rfq.body.data.publicId,
      issue: true,
      expectedDeliveryDate: new Date(Date.now() + 7 * 86400000).toISOString()
    });
  expect(poRes.status).toBe(201);
  const poId = poRes.body.data.publicId;
  const lineId = poRes.body.data.lines[0].lineId;

  const expectedArrival = new Date(Date.now() + 3 * 86400000);
  const ack = await request(app)
    .post(`/api/v1/supplier-network/purchase-orders/${poId}/acknowledge`)
    .set('Authorization', `Bearer ${s1.supplier.token}`)
    .send({
      expectedDeliveryDate: expectedArrival.toISOString()
    });
  expect(ack.status).toBe(200);

  const ship = await request(app)
    .post('/api/v1/supplier-network/shipments')
    .set('Authorization', `Bearer ${s1.supplier.token}`)
    .send({
      purchaseOrderId: poId,
      carrier: 'TCS',
      trackingNumber: `TRK-${suffix}`,
      expectedArrivalDate: expectedArrival.toISOString(),
      dispatch: true,
      lines: [{ poLineId: lineId, quantity: acceptQty }]
    });
  expect(ship.status).toBe(201);

  const arrive = await request(app)
    .patch(`/api/v1/supplier-network/shipments/${ship.body.data.publicId}`)
    .set('Authorization', `Bearer ${s1.supplier.token}`)
    .send({
      status: 'delivered',
      actualArrivalDate: new Date(expectedArrival.getTime() - 86400000).toISOString()
    });
  expect(arrive.status).toBe(200);

  const grn = await request(app)
    .post('/api/v1/supplier-network/goods-receipts')
    .set('Authorization', `Bearer ${shop.login.token}`)
    .send({
      purchaseOrderId: poId,
      idempotencyKey: `p5a-grn-${suffix}`,
      lines: [
        {
          poLineId: lineId,
          quantityAccepted: acceptQty,
          quantityRejected: 0,
          quantityDamaged: 0
        }
      ]
    });
  expect(grn.status).toBe(201);

  const po = await SupplierPurchaseOrder.findOne({ publicId: poId });
  return { s1, shop, po: po!, poId, lineId, rfq: rfq.body.data, quote: quote.body.data };
}

const fiveStars = {
  productQuality: 5,
  deliveryPerformance: 4,
  communication: 5,
  orderFulfilment: 4,
  overallExperience: 5
};

describe('Supplier network Phase 5A — verified reviews & performance', () => {
  it('allows review only for fulfilled PO with accepted GRN; blocks incomplete/cancelled/duplicate/cross-tenant', async () => {
    const suffix = `elig-${Date.now()}`;
    const ctx = await fulfilPoFlow(suffix);
    expect(ctx.po.status).toBe('fulfilled');

    const created = await request(app)
      .post(`/api/v1/marketplace/suppliers/${ctx.s1.business!.publicId}/reviews`)
      .set('Authorization', `Bearer ${ctx.shop.login.token}`)
      .send({
        shopId: String(ctx.shop.shop._id),
        purchaseOrderId: ctx.poId,
        categoryRatings: fiveStars,
        comment: 'Excellent panels'
      });
    expect(created.status).toBe(201);
    expect(created.body.data.isVerified).toBe(true);
    expect(created.body.data.purchaseOrderPublicId).toBe(ctx.poId);
    expect(created.body.data.categoryRatings.overallExperience).toBe(5);

    const dup = await request(app)
      .post(`/api/v1/marketplace/suppliers/${ctx.s1.business!.publicId}/reviews`)
      .set('Authorization', `Bearer ${ctx.shop.login.token}`)
      .send({
        shopId: String(ctx.shop.shop._id),
        purchaseOrderId: ctx.poId,
        categoryRatings: fiveStars
      });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_REVIEW');

    // Incomplete PO — issue but do not receive
    const incomplete = await fulfilPoFlow(`inc-${Date.now()}`, { qty: 2, acceptQty: 2 });
    // Create another RFQ/PO that stays acknowledged only
    const rfq2 = await request(app)
      .post('/api/v1/supplier-network/rfqs')
      .set('Authorization', `Bearer ${incomplete.shop.login.token}`)
      .send({
        shopId: String(incomplete.shop.shop._id),
        title: 'Incomplete',
        supplierBusinessIds: [String(incomplete.s1.business!._id)],
        items: [{ name: 'Glass', quantity: 2 }],
        send: true
      });
    const q2 = await request(app)
      .post(`/api/v1/supplier-network/rfqs/${rfq2.body.data.publicId}/quotations`)
      .set('Authorization', `Bearer ${incomplete.s1.supplier.token}`)
      .send({
        lines: [
          {
            rfqLineId: rfq2.body.data.items[0].lineId,
            unitPrice: 100,
            availableQuantity: 10,
            quotedQuantity: 2
          }
        ]
      });
    await request(app)
      .post(`/api/v1/supplier-network/rfqs/${rfq2.body.data.publicId}/accept`)
      .set('Authorization', `Bearer ${incomplete.shop.login.token}`)
      .send({ quotationId: q2.body.data.id });
    const po2 = await request(app)
      .post('/api/v1/supplier-network/purchase-orders')
      .set('Authorization', `Bearer ${incomplete.shop.login.token}`)
      .send({ rfqId: rfq2.body.data.publicId, issue: true });
    const bad = await request(app)
      .post(`/api/v1/marketplace/suppliers/${incomplete.s1.business!.publicId}/reviews`)
      .set('Authorization', `Bearer ${incomplete.shop.login.token}`)
      .send({
        shopId: String(incomplete.shop.shop._id),
        purchaseOrderId: po2.body.data.publicId,
        categoryRatings: fiveStars
      });
    expect(bad.status).toBe(409);
    expect(bad.body.error.code).toBe('PO_NOT_ELIGIBLE');

    // Cancelled PO
    const cancelCtx = await approveSupplier(`can-${Date.now()}`);
    const cancelShop = await createShopAdmin(`can-${Date.now()}`);
    const rfqC = await request(app)
      .post('/api/v1/supplier-network/rfqs')
      .set('Authorization', `Bearer ${cancelShop.login.token}`)
      .send({
        shopId: String(cancelShop.shop._id),
        title: 'Cancel me',
        supplierBusinessIds: [String(cancelCtx.business._id)],
        items: [{ name: 'Part', quantity: 1 }],
        send: true
      });
    const qC = await request(app)
      .post(`/api/v1/supplier-network/rfqs/${rfqC.body.data.publicId}/quotations`)
      .set('Authorization', `Bearer ${cancelCtx.supplier.token}`)
      .send({
        lines: [
          {
            rfqLineId: rfqC.body.data.items[0].lineId,
            unitPrice: 50,
            availableQuantity: 5,
            quotedQuantity: 1
          }
        ]
      });
    await request(app)
      .post(`/api/v1/supplier-network/rfqs/${rfqC.body.data.publicId}/accept`)
      .set('Authorization', `Bearer ${cancelShop.login.token}`)
      .send({ quotationId: qC.body.data.id });
    const poC = await request(app)
      .post('/api/v1/supplier-network/purchase-orders')
      .set('Authorization', `Bearer ${cancelShop.login.token}`)
      .send({ rfqId: rfqC.body.data.publicId, issue: true });
    await request(app)
      .post(`/api/v1/supplier-network/purchase-orders/${poC.body.data.publicId}/cancel`)
      .set('Authorization', `Bearer ${cancelShop.login.token}`)
      .send({ reason: 'Shop no longer needs this order' });
    const cancelReview = await request(app)
      .post(`/api/v1/marketplace/suppliers/${cancelCtx.business.publicId}/reviews`)
      .set('Authorization', `Bearer ${cancelShop.login.token}`)
      .send({
        shopId: String(cancelShop.shop._id),
        purchaseOrderId: poC.body.data.publicId,
        categoryRatings: fiveStars
      });
    expect(cancelReview.status).toBe(409);
    expect(cancelReview.body.error.code).toBe('PO_CANCELLED');

    // Unrelated shop
    const other = await createShopAdmin(`other-${Date.now()}`);
    const cross = await request(app)
      .post(`/api/v1/marketplace/suppliers/${ctx.s1.business!.publicId}/reviews`)
      .set('Authorization', `Bearer ${other.login.token}`)
      .send({
        shopId: String(other.shop._id),
        purchaseOrderId: ctx.poId,
        categoryRatings: fiveStars
      });
    expect(cross.status).toBe(403);

    // Supplier cannot self-review via marketplace (role forbidden)
    const self = await request(app)
      .post(`/api/v1/marketplace/suppliers/${ctx.s1.business!.publicId}/reviews`)
      .set('Authorization', `Bearer ${ctx.s1.supplier.token}`)
      .send({
        shopId: String(ctx.shop.shop._id),
        purchaseOrderId: ctx.poId,
        categoryRatings: fiveStars
      });
    expect(self.status).toBe(403);
  });

  it('supports edit, supplier response, report, operator moderation without deleting', async () => {
    const ctx = await fulfilPoFlow(`mod-${Date.now()}`);
    const created = await request(app)
      .post(`/api/v1/marketplace/suppliers/${ctx.s1.business!.publicId}/reviews`)
      .set('Authorization', `Bearer ${ctx.shop.login.token}`)
      .send({
        shopId: String(ctx.shop.shop._id),
        purchaseOrderId: ctx.poId,
        categoryRatings: fiveStars,
        comment: 'Good'
      });
    expect(created.status).toBe(201);
    const reviewId = created.body.data.id;

    const edited = await request(app)
      .patch(`/api/v1/marketplace/suppliers/reviews/${reviewId}`)
      .set('Authorization', `Bearer ${ctx.shop.login.token}`)
      .send({
        comment: 'Updated after follow-up',
        categoryRatings: { ...fiveStars, overallExperience: 4 }
      });
    expect(edited.status).toBe(200);
    expect(edited.body.data.comment).toBe('Updated after follow-up');
    expect(edited.body.data.rating).toBe(4);
    expect(edited.body.data.editHistory.length).toBe(1);

    const respond = await request(app)
      .post(`/api/v1/supplier/reviews/${reviewId}/respond`)
      .set('Authorization', `Bearer ${ctx.s1.supplier.token}`)
      .send({ body: 'Thank you for the feedback.' });
    expect(respond.status).toBe(200);
    expect(respond.body.data.supplierResponse.body).toContain('Thank you');
    expect(respond.body.data.comment).toBe('Updated after follow-up');

    // Supplier cannot change original ratings
    const tamper = await request(app)
      .patch(`/api/v1/marketplace/suppliers/reviews/${reviewId}`)
      .set('Authorization', `Bearer ${ctx.s1.supplier.token}`)
      .send({ comment: 'hacked' });
    expect(tamper.status).toBe(403);

    const report = await request(app)
      .post(`/api/v1/marketplace/suppliers/reviews/${reviewId}/report`)
      .set('Authorization', `Bearer ${ctx.shop.login.token}`)
      .send({ reason: 'Contains personal data that should be reviewed', shopId: String(ctx.shop.shop._id) });
    expect(report.status).toBe(200);
    expect(report.body.data.status).toBe('reported');

    const dupReport = await request(app)
      .post(`/api/v1/marketplace/suppliers/reviews/${reviewId}/report`)
      .set('Authorization', `Bearer ${ctx.shop.login.token}`)
      .send({ reason: 'Second attempt should fail' });
    expect(dupReport.status).toBe(409);

    const listed = await request(app)
      .get('/api/v1/platform/supplier-reviews?status=reported')
      .set('Authorization', `Bearer ${ctx.s1.ops.token}`);
    expect(listed.status).toBe(200);
    expect(listed.body.data.items.some((r: { id: string }) => r.id === reviewId)).toBe(true);

    const hide = await request(app)
      .post(`/api/v1/platform/supplier-reviews/${reviewId}/moderate`)
      .set('Authorization', `Bearer ${ctx.s1.ops.token}`)
      .send({ action: 'hide', reason: 'Contains personal identifiers' });
    expect(hide.status).toBe(200);
    expect(hide.body.data.status).toBe('hidden');
    expect(hide.body.data.moderationHistory.length).toBeGreaterThan(0);

    const stillExists = await SupplierReview.findById(reviewId);
    expect(stillExists).toBeTruthy();
    expect(stillExists!.status).toBe('hidden');
    expect(stillExists!.comment).toBe('Updated after follow-up');

    const restore = await request(app)
      .post(`/api/v1/platform/supplier-reviews/${reviewId}/moderate`)
      .set('Authorization', `Bearer ${ctx.s1.ops.token}`)
      .send({ action: 'restore', reason: 'PII removed via edit history; restore visibility' });
    expect(restore.status).toBe(200);
    expect(restore.body.data.status).toBe('moderated');

    // Shop admin cannot moderate
    const shopMod = await request(app)
      .post(`/api/v1/platform/supplier-reviews/${reviewId}/moderate`)
      .set('Authorization', `Bearer ${ctx.shop.login.token}`)
      .send({ action: 'hide', reason: 'Should not work for shop admin' });
    expect(shopMod.status).toBe(403);
  });

  it('computes fulfilment, on-time, quote response, cancellations, and insufficient samples', async () => {
    const full = await fulfilPoFlow(`perf-full-${Date.now()}`, { qty: 10, acceptQty: 10 });
    const partial = await fulfilPoFlow(`perf-part-${Date.now()}`, { qty: 10, acceptQty: 5 });

    // Reuse same supplier for multi-PO metrics by computing on full.business after linking
    // Create third PO on same supplier as full via new shop
    const perf = await computeSupplierPerformance(full.s1.business!._id);
    expect(perf.fulfilmentRate.sampleCount).toBeGreaterThanOrEqual(1);
    expect(perf.raw.fulfilment.acceptedQty).toBe(10);
    expect(perf.raw.fulfilment.orderedQty).toBe(10);
    // Single PO → not enough data for marketplace threshold
    expect(perf.fulfilmentRate.enoughData).toBe(false);
    expect(perf.fulfilmentRate.label).toBe('Not enough data');

    const partPerf = await computeSupplierPerformance(partial.s1.business!._id);
    expect(partPerf.raw.fulfilment.acceptedQty).toBe(5);
    expect(partPerf.raw.fulfilment.orderedQty).toBe(10);
    expect(partPerf.fulfilmentRate.value).toBeNull(); // insufficient samples
    // Raw ratio still correct when enough samples — verify math via raw
    expect(partPerf.raw.fulfilment.acceptedQty / partPerf.raw.fulfilment.orderedQty).toBe(0.5);

    // On-time: shipment had expected + actual before expected
    expect(perf.onTimeDelivery.sampleCount).toBeGreaterThanOrEqual(1);

    // Quote response: RFQ sent → quotation submitted
    expect(perf.quotationResponseTime.sampleCount).toBeGreaterThanOrEqual(1);

    // Zero eligible for brand new supplier
    const empty = await approveSupplier(`empty-${Date.now()}`);
    const emptyPerf = await computeSupplierPerformance(empty.business._id);
    expect(emptyPerf.fulfilmentRate.sampleCount).toBe(0);
    expect(emptyPerf.fulfilmentRate.label).toBe('No eligible transactions');
    expect(emptyPerf.verifiedReviews.totalPublishedVerified).toBe(0);

    // Supplier cancel vs shop cancel
    const cancelSup = await approveSupplier(`crej-${Date.now()}`);
    const cancelShop = await createShopAdmin(`crej-${Date.now()}`);
    const rfq = await request(app)
      .post('/api/v1/supplier-network/rfqs')
      .set('Authorization', `Bearer ${cancelShop.login.token}`)
      .send({
        shopId: String(cancelShop.shop._id),
        title: 'Supplier reject flow RFQ',
        supplierBusinessIds: [String(cancelSup.business._id)],
        items: [{ name: 'Rejectable Part', quantity: 1, sku: 'REJ-1' }],
        send: true
      });
    expect(rfq.status).toBe(201);
    const q = await request(app)
      .post(`/api/v1/supplier-network/rfqs/${rfq.body.data.publicId}/quotations`)
      .set('Authorization', `Bearer ${cancelSup.supplier.token}`)
      .send({
        lines: [
          {
            rfqLineId: rfq.body.data.items[0].lineId,
            unitPrice: 10,
            availableQuantity: 5,
            quotedQuantity: 1
          }
        ]
      });
    expect(q.status).toBe(201);
    await request(app)
      .post(`/api/v1/supplier-network/rfqs/${rfq.body.data.publicId}/accept`)
      .set('Authorization', `Bearer ${cancelShop.login.token}`)
      .send({ quotationId: q.body.data.id });
    const po = await request(app)
      .post('/api/v1/supplier-network/purchase-orders')
      .set('Authorization', `Bearer ${cancelShop.login.token}`)
      .send({ rfqId: rfq.body.data.publicId, issue: true });
    expect(po.status).toBe(201);
    const rejected = await request(app)
      .post(`/api/v1/supplier-network/purchase-orders/${po.body.data.publicId}/reject`)
      .set('Authorization', `Bearer ${cancelSup.supplier.token}`)
      .send({ reason: 'Cannot fulfil this SKU currently' });
    expect(rejected.status).toBe(200);

    const cancelPerf = await computeSupplierPerformance(cancelSup.business._id);
    expect(cancelPerf.raw.cancellation.supplierCancels).toBe(1);
    expect(cancelPerf.raw.cancellation.issued).toBe(1);

    // Supplier portal performance endpoint
    const portal = await request(app)
      .get('/api/v1/supplier/performance')
      .set('Authorization', `Bearer ${full.s1.supplier.token}`);
    expect(portal.status).toBe(200);
    expect(portal.body.data.performance.definitions.fulfilmentRate).toBeTruthy();
    expect(portal.body.data.verified).toBeDefined();
  });

  it('exposes marketplace performance and never treats unverified as high-performing', async () => {
    const ctx = await fulfilPoFlow(`mkt-${Date.now()}`);
    const profile = await request(app)
      .get(`/api/v1/marketplace/suppliers/${ctx.s1.business!.publicId}`)
      .set('Authorization', `Bearer ${ctx.shop.login.token}`);
    expect(profile.status).toBe(200);
    expect(profile.body.data.genuineRating).toBeNull();
    expect(profile.body.data.reviewSummary.enoughData).toBe(false);
    expect(profile.body.data.fulfilmentPerformance.enoughData).toBe(false);
    // Verified badge is platform verification, not performance
    expect(typeof profile.body.data.verified).toBe('boolean');
  });

  it('reports pending overdue separately; excludes missing expected dates from on-time', async () => {
    const ctx = await fulfilPoFlow(`ot-${Date.now()}`);
    const past = new Date(Date.now() - 5 * 86400000);
    const createdBy = ctx.s1.supplier.user.id;

    // Incomplete overdue shipment (in transit, expected in the past, no actual)
    await SupplierShipment.create({
      publicId: `SHP-OVERDUE-${Date.now()}`,
      purchaseOrder: ctx.po._id,
      supplierBusiness: ctx.s1.business!._id,
      shop: ctx.shop.shop._id,
      createdBy,
      status: 'in_transit',
      carrier: 'Leopard',
      trackingNumber: `LATE-${Date.now()}`,
      dispatchDate: past,
      expectedArrivalDate: past,
      lines: [{ poLineId: ctx.lineId, quantity: 1 }]
    });

    // Clear PO expected fallbacks, then add a delivered shipment with no shipment expected date
    await SupplierPurchaseOrder.updateOne(
      { _id: ctx.po._id },
      { $unset: { expectedDeliveryDate: 1, supplierExpectedDeliveryDate: 1 } }
    );
    await SupplierShipment.create({
      publicId: `SHP-NOEXP-${Date.now()}`,
      purchaseOrder: ctx.po._id,
      supplierBusiness: ctx.s1.business!._id,
      shop: ctx.shop.shop._id,
      createdBy,
      status: 'delivered',
      carrier: 'TCS',
      trackingNumber: `NOEXP-${Date.now()}`,
      dispatchDate: new Date(),
      actualArrivalDate: new Date(),
      lines: [{ poLineId: ctx.lineId, quantity: 1 }]
    });

    const perf = await computeSupplierPerformance(ctx.s1.business!._id);
    expect(perf.pendingOverdue.count).toBeGreaterThanOrEqual(1);
    expect(perf.raw.onTime.pendingOverdue).toBeGreaterThanOrEqual(1);
    expect(perf.raw.onTime.missingExpectedDate).toBeGreaterThanOrEqual(1);
    // Original fulfilPoFlow shipment still has its own expectedArrivalDate + actual → still eligible
    expect(perf.raw.onTime.eligible).toBeGreaterThanOrEqual(1);
    expect(perf.definitions.pendingOverdue).toMatch(/separately/i);
  });

  it('keeps first quotation submission time after withdraw for response metrics', async () => {
    const suffix = `wd-${Date.now()}`;
    const s1 = await approveSupplier(suffix);
    const shop = await createShopAdmin(suffix);
    const rfq = await request(app)
      .post('/api/v1/supplier-network/rfqs')
      .set('Authorization', `Bearer ${shop.login.token}`)
      .send({
        shopId: String(shop.shop._id),
        title: `Withdraw RFQ ${suffix}`,
        supplierBusinessIds: [String(s1.business._id)],
        items: [{ name: 'Widget', quantity: 2, sku: 'WD-1' }],
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
            unitPrice: 100,
            availableQuantity: 10,
            quotedQuantity: 2
          }
        ]
      });
    expect(quote.status).toBe(201);

    const before = await SupplierQuotation.findById(quote.body.data.id);
    expect(before?.submittedAt).toBeTruthy();
    expect(before?.firstSubmittedAt).toBeTruthy();
    const firstTs = before!.firstSubmittedAt!.getTime();

    const wd = await request(app)
      .post(`/api/v1/supplier-network/quotations/${quote.body.data.id}/withdraw`)
      .set('Authorization', `Bearer ${s1.supplier.token}`)
      .send({ reason: 'Pricing error discovered after submit' });
    expect(wd.status).toBe(200);

    const after = await SupplierQuotation.findById(quote.body.data.id);
    expect(after?.status).toBe('withdrawn');
    expect(after?.firstSubmittedAt?.getTime()).toBe(firstTs);
    expect(after?.submittedAt).toBeTruthy();

    const perf = await computeSupplierPerformance(s1.business!._id);
    expect(perf.quotationResponseTime.sampleCount).toBe(1);
    expect(perf.quotationResponseTime.value).toBeNull(); // below min samples threshold
  });

  it('excludes hidden reviews from public averages; moderated remains rating-eligible', async () => {
    const ctx = await fulfilPoFlow(`mod-avg-${Date.now()}`);
    const created = await request(app)
      .post(`/api/v1/marketplace/suppliers/${ctx.s1.business!.publicId}/reviews`)
      .set('Authorization', `Bearer ${ctx.shop.login.token}`)
      .send({
        shopId: String(ctx.shop.shop._id),
        purchaseOrderId: ctx.poId,
        categoryRatings: fiveStars,
        comment: 'Solid fulfilment'
      });
    expect(created.status).toBe(201);
    const reviewId = created.body.data.id;

    let stats = await aggregateVerifiedReviewStats(ctx.s1.business!._id);
    expect(stats.count).toBe(1);
    expect(stats.overall).toBe(5);

    await request(app)
      .post(`/api/v1/platform/supplier-reviews/${reviewId}/moderate`)
      .set('Authorization', `Bearer ${ctx.s1.ops.token}`)
      .send({ action: 'hide', reason: 'Temporarily hide while investigating complaint' });

    stats = await aggregateVerifiedReviewStats(ctx.s1.business!._id);
    expect(stats.count).toBe(0);
    expect(stats.overall).toBeNull();

    const restored = await request(app)
      .post(`/api/v1/platform/supplier-reviews/${reviewId}/moderate`)
      .set('Authorization', `Bearer ${ctx.s1.ops.token}`)
      .send({ action: 'restore', reason: 'Investigation complete; restore for public averages' });
    expect(restored.status).toBe(200);
    expect(restored.body.data.status).toBe('moderated');

    stats = await aggregateVerifiedReviewStats(ctx.s1.business!._id);
    expect(stats.count).toBe(1);
    expect(stats.overall).toBe(5);

    const still = await SupplierReview.findById(reviewId);
    expect(still?.comment).toBe('Solid fulfilment');
    expect(still?.moderationHistory.length).toBeGreaterThanOrEqual(2);
  });
});
