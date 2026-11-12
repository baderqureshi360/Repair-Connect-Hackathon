import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app.js';
import {
  RepairShop,
  ShopMembership,
  SupplierBusiness,
  SupplierConversationMessage,
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
  const email = `p3.sup.${suffix}@example.com`;
  const payload = {
    contactPerson: 'P3 Supplier',
    email,
    phone: '+92-300-4440001',
    password: 'SecurePass1',
    confirmPassword: 'SecurePass1',
    businessName: `P3 Hub ${suffix}`,
    address: '30 Quote Street',
    city: 'Lahore',
    region: 'Punjab',
    description: 'Phase 3 supplier for RFQ and messaging tests covering screens.',
    partCategories: ['screens_displays'],
    supportedBrands: ['Samsung'],
    deliveryCities: ['Lahore'],
    termsAccepted: true
  };
  const reg = await request(app).post('/api/v1/public/supplier-applications/register').send(payload);
  expect(reg.status).toBe(201);

  const opsEmail = `ops.p3.${suffix}@repairconnect.platform`;
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
  return { payload, supplier, business: business!, publicId: reg.body.data.id };
}

async function createShopAdmin(suffix: string) {
  const email = `admin.p3.${suffix}@example.com`;
  const admin = await User.create({
    email,
    passwordHash: await bcrypt.hash('SecurePass1', 12),
    name: 'Admin',
    role: 'shop_admin',
    accountStatus: 'active',
    isActive: true
  });
  const shop = await RepairShop.create({
    name: `P3 Shop ${suffix}`,
    code: `P3${suffix}`.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 12),
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

describe('Supplier network Phase 3 — messaging & RFQ', () => {
  it('isolates conversations and hides shop_internal notes from suppliers', async () => {
    const suffix = `msg-${Date.now()}`;
    const a = await approveSupplier(suffix);
    const b = await approveSupplier(`other-${suffix}`);
    const shop = await createShopAdmin(suffix);
    const shopB = await createShopAdmin(`b-${suffix}`);

    const start = await request(app)
      .post('/api/v1/supplier-network/conversations')
      .set('Authorization', `Bearer ${shop.login.token}`)
      .send({
        shopId: String(shop.shop._id),
        supplierBusinessId: String(a.business._id),
        subject: 'Parts inquiry'
      });
    expect(start.status).toBe(201);
    const conversationId = start.body.data.id;

    const visible = await request(app)
      .post(`/api/v1/supplier-network/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${shop.login.token}`)
      .send({ body: 'Do you stock OLED screens?' });
    expect(visible.status).toBe(201);

    const internal = await request(app)
      .post(`/api/v1/supplier-network/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${shop.login.token}`)
      .send({ body: 'Internal: prefer OEM only', visibility: 'shop_internal' });
    expect(internal.status).toBe(201);

    const supplierMsgs = await request(app)
      .get(`/api/v1/supplier-network/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${a.supplier.token}`);
    expect(supplierMsgs.status).toBe(200);
    expect(supplierMsgs.body.data.some((m: { body: string }) => m.body.includes('OLED'))).toBe(true);
    expect(supplierMsgs.body.data.some((m: { body: string }) => m.body.includes('Internal'))).toBe(false);

    const otherSupplier = await request(app)
      .get(`/api/v1/supplier-network/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${b.supplier.token}`);
    expect(otherSupplier.status).toBe(404);

    const otherShop = await request(app)
      .get(`/api/v1/supplier-network/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${shopB.login.token}`);
    expect(otherShop.status).toBe(403);

    const reply = await request(app)
      .post(`/api/v1/supplier-network/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${a.supplier.token}`)
      .send({ body: 'Yes, Samsung OLED in stock.' });
    expect(reply.status).toBe(201);

    expect(await SupplierConversationMessage.countDocuments({ conversation: conversationId })).toBe(3);
  });

  it('distributes multi-supplier RFQs, compares quotes, and accepts with concurrency guard', async () => {
    const suffix = `rfq-${Date.now()}`;
    const s1 = await approveSupplier(`1-${suffix}`);
    const s2 = await approveSupplier(`2-${suffix}`);
    const shop = await createShopAdmin(suffix);

    const rfq = await request(app)
      .post('/api/v1/supplier-network/rfqs')
      .set('Authorization', `Bearer ${shop.login.token}`)
      .send({
        shopId: String(shop.shop._id),
        title: 'OLED screens RFQ',
        additionalRequirements: 'Prefer OEM with 90 day warranty',
        supplierBusinessIds: [String(s1.business._id), String(s2.business._id)],
        items: [
          {
            name: 'Galaxy S21 OLED',
            quantity: 10,
            specifications: 'OEM grade'
          }
        ],
        send: true
      });
    expect(rfq.status).toBe(201);
    expect(rfq.body.data.status).toBe('sent');
    const rfqPublicId = rfq.body.data.publicId;
    const rfqLineId = rfq.body.data.items[0].lineId;

    // Unauthorized supplier cannot view
    const outsider = await approveSupplier(`out-${suffix}`);
    const denied = await request(app)
      .get(`/api/v1/supplier-network/rfqs/${rfqPublicId}`)
      .set('Authorization', `Bearer ${outsider.supplier.token}`);
    expect(denied.status).toBe(404);

    const quote1 = await request(app)
      .post(`/api/v1/supplier-network/rfqs/${rfqPublicId}/quotations`)
      .set('Authorization', `Bearer ${s1.supplier.token}`)
      .send({
        lines: [
          {
            rfqLineId,
            unitPrice: 12000,
            availableQuantity: 20,
            quotedQuantity: 10,
            moq: 2,
            warranty: '90 days'
          }
        ],
        deliveryCharges: 500,
        taxPercent: 0
      });
    expect(quote1.status).toBe(201);
    expect(quote1.body.data.totalAmount).toBe(120500);

    const quote2 = await request(app)
      .post(`/api/v1/supplier-network/rfqs/${rfqPublicId}/quotations`)
      .set('Authorization', `Bearer ${s2.supplier.token}`)
      .send({
        lines: [
          {
            rfqLineId,
            unitPrice: 11000,
            availableQuantity: 5,
            quotedQuantity: 5,
            isAlternative: true,
            alternativeName: 'Compatible OLED',
            warranty: '30 days'
          }
        ],
        deliveryCharges: 800
      });
    expect(quote2.status).toBe(201);

    const compare = await request(app)
      .get(`/api/v1/supplier-network/rfqs/${rfqPublicId}/compare`)
      .set('Authorization', `Bearer ${shop.login.token}`);
    expect(compare.status).toBe(200);
    expect(compare.body.data.columns.length).toBe(2);
    expect(compare.body.data.columns.every((c: { suggested: boolean }) => c.suggested === false)).toBe(true);
    expect(compare.body.data.itemMatrix[0].quotes.length).toBe(2);

    // Revise quote1
    const revise = await request(app)
      .post(`/api/v1/supplier-network/rfqs/${rfqPublicId}/quotations`)
      .set('Authorization', `Bearer ${s1.supplier.token}`)
      .send({
        lines: [
          {
            rfqLineId,
            unitPrice: 11500,
            availableQuantity: 20,
            quotedQuantity: 10,
            warranty: '90 days'
          }
        ],
        deliveryCharges: 400
      });
    expect(revise.status).toBe(201);
    expect(revise.body.data.status).toBe('revised');

    const acceptA = request(app)
      .post(`/api/v1/supplier-network/rfqs/${rfqPublicId}/accept`)
      .set('Authorization', `Bearer ${shop.login.token}`)
      .send({ quotationId: quote1.body.data.id });
    const acceptB = request(app)
      .post(`/api/v1/supplier-network/rfqs/${rfqPublicId}/accept`)
      .set('Authorization', `Bearer ${shop.login.token}`)
      .send({ quotationId: quote2.body.data.id });
    const [r1, r2] = await Promise.all([acceptA, acceptB]);
    const okCount = [r1.status, r2.status].filter((s) => s === 200).length;
    const conflictCount = [r1.status, r2.status].filter((s) => s === 409).length;
    expect(okCount).toBe(1);
    expect(conflictCount).toBe(1);

    const rfqDoc = await SupplierRfq.findOne({ publicId: rfqPublicId });
    expect(rfqDoc?.status).toBe('completed');
    expect(await SupplierQuotation.countDocuments({ rfq: rfqDoc!._id, status: 'accepted' })).toBe(1);

    // Cannot withdraw accepted
    const accepted = await SupplierQuotation.findOne({ rfq: rfqDoc!._id, status: 'accepted' });
    const ownerIsS1 = String(accepted!.supplierBusiness) === String(s1.business._id);
    const withdraw = await request(app)
      .post(`/api/v1/supplier-network/quotations/${accepted!._id}/withdraw`)
      .set('Authorization', `Bearer ${ownerIsS1 ? s1.supplier.token : s2.supplier.token}`)
      .send({ reason: 'Changed mind after acceptance' });
    expect(withdraw.status).toBe(409);
  });

  it('allows quotation withdrawal before acceptance with audit reason', async () => {
    const suffix = `wd-${Date.now()}`;
    const s1 = await approveSupplier(suffix);
    const shop = await createShopAdmin(suffix);
    const rfq = await request(app)
      .post('/api/v1/supplier-network/rfqs')
      .set('Authorization', `Bearer ${shop.login.token}`)
      .send({
        shopId: String(shop.shop._id),
        title: 'Battery RFQ',
        supplierBusinessIds: [String(s1.business._id)],
        items: [{ name: 'Battery', quantity: 4 }],
        send: true
      });
    const lineId = rfq.body.data.items[0].lineId;
    const quote = await request(app)
      .post(`/api/v1/supplier-network/rfqs/${rfq.body.data.publicId}/quotations`)
      .set('Authorization', `Bearer ${s1.supplier.token}`)
      .send({
        lines: [
          {
            rfqLineId: lineId,
            unitPrice: 2000,
            availableQuantity: 10,
            quotedQuantity: 4
          }
        ]
      });
    const withdraw = await request(app)
      .post(`/api/v1/supplier-network/quotations/${quote.body.data.id}/withdraw`)
      .set('Authorization', `Bearer ${s1.supplier.token}`)
      .send({ reason: 'Stock shortage discovered' });
    expect(withdraw.status).toBe(200);
    expect(withdraw.body.data.status).toBe('withdrawn');
  });
});
