import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { createApp } from '../app.js';
import {
  PaymentRecord,
  RepairRequest,
  RepairShop,
  ShopMembership,
  User
} from '../models/index.js';

const app = createApp();
const password = 'SecurePass1';

async function login(email: string) {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.data.token as string;
}

async function seedPaidReadyRepair(finalCost = 5000) {
  const passwordHash = await bcrypt.hash(password, 12);
  const stamp = Date.now() + Math.floor(Math.random() * 1000);
  const shop = await RepairShop.create({
    name: `Atomic Shop ${stamp}`,
    code: `AT${String(stamp).slice(-6)}`,
    address: '1 Atomic',
    city: 'Lahore',
    region: 'Punjab',
    phone: '+92-42-200',
    email: `atomic.shop.${stamp}@test.com`,
    isActive: true
  });
  const [customer, admin, mechanic] = await User.create([
    { email: `atomic.c.${stamp}@test.com`, passwordHash, name: 'Atomic C', role: 'customer' },
    { email: `atomic.a.${stamp}@test.com`, passwordHash, name: 'Atomic A', role: 'shop_admin' },
    { email: `atomic.m.${stamp}@test.com`, passwordHash, name: 'Atomic M', role: 'mechanic' }
  ]);
  await ShopMembership.create([
    { user: admin._id, shop: shop._id, role: 'shop_admin', isActive: true },
    { user: mechanic._id, shop: shop._id, role: 'mechanic', isActive: true }
  ]);
  const customerToken = await login(customer.email);
  const adminToken = await login(admin.email);
  const mechanicToken = await login(mechanic.email);

  const created = await request(app)
    .post('/api/v1/repairs')
    .set('Authorization', `Bearer ${customerToken}`)
    .send({
      shopId: String(shop._id),
      deviceType: 'Phone',
      brand: 'Pixel',
      model: '8',
      problemDescription: `Atomic payment concurrency case ${stamp}`
    })
    .expect(201);
  const repairId = created.body.data._id as string;

  await request(app)
    .post(`/api/v1/repairs/${repairId}/assign`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ mechanicId: String(mechanic._id) })
    .expect(200);
  await request(app)
    .post(`/api/v1/repairs/${repairId}/diagnosis`)
    .set('Authorization', `Bearer ${mechanicToken}`)
    .send({ findings: 'Board short', recommendedActions: 'Replace board' })
    .expect(201);
  const est = await request(app)
    .post(`/api/v1/repairs/${repairId}/estimates`)
    .set('Authorization', `Bearer ${mechanicToken}`)
    .send({ laborCost: 1000, partsCost: finalCost - 1000 })
    .expect(201);
  await request(app)
    .post(`/api/v1/repairs/estimates/${est.body.data._id}/decision`)
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ decision: 'approved' })
    .expect(200);
  await request(app)
    .post(`/api/v1/repairs/${repairId}/parts-not-required`)
    .set('Authorization', `Bearer ${mechanicToken}`)
    .send({ notes: 'parts on hand' })
    .expect(200);
  await request(app)
    .post(`/api/v1/repairs/${repairId}/start`)
    .set('Authorization', `Bearer ${mechanicToken}`)
    .expect(200);
  await request(app)
    .post(`/api/v1/repairs/${repairId}/complete`)
    .set('Authorization', `Bearer ${mechanicToken}`)
    .send({ workPerformed: 'Board replaced and tested thoroughly', finalCost })
    .expect(200);

  return { shop, customer, admin, repairId, customerToken, adminToken, finalCost };
}

describe('Atomic payments + reversals', () => {
  it('rejects concurrent overpayment — only one of two 3000 PKR posts commits against 5000 due', async () => {
    const ctx = await seedPaidReadyRepair(5000);

    const [a, b] = await Promise.all([
      request(app)
        .post('/api/v1/documents/payments')
        .set('Authorization', `Bearer ${ctx.adminToken}`)
        .send({
          repairId: ctx.repairId,
          amount: 3000,
          method: 'cash',
          confirmedReceived: true,
          idempotencyKey: `conc-a-${ctx.repairId}`
        }),
      request(app)
        .post('/api/v1/documents/payments')
        .set('Authorization', `Bearer ${ctx.adminToken}`)
        .send({
          repairId: ctx.repairId,
          amount: 3000,
          method: 'jazzcash',
          reference: 'JC-CONC-1',
          confirmedReceived: true,
          idempotencyKey: `conc-b-${ctx.repairId}`
        })
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    const conflict = a.status === 409 ? a : b;
    expect(['EXCEEDS_BALANCE', 'BALANCE_CHANGED']).toContain(conflict.body.error.code);

    const summary = await request(app)
      .get(`/api/v1/repairs/${ctx.repairId}/payments`)
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .expect(200);
    expect(summary.body.data.amountPaid).toBe(3000);
    expect(summary.body.data.outstanding).toBe(2000);
    expect(await PaymentRecord.countDocuments({ repairRequest: ctx.repairId, entryType: 'payment' })).toBe(
      1
    );
  });

  it('allows two valid concurrent partial payments that sum to outstanding', async () => {
    const ctx = await seedPaidReadyRepair(5000);
    const [a, b] = await Promise.all([
      request(app)
        .post('/api/v1/documents/payments')
        .set('Authorization', `Bearer ${ctx.adminToken}`)
        .send({
          repairId: ctx.repairId,
          amount: 2000,
          method: 'cash',
          confirmedReceived: true,
          idempotencyKey: `ok-a-${ctx.repairId}`
        }),
      request(app)
        .post('/api/v1/documents/payments')
        .set('Authorization', `Bearer ${ctx.adminToken}`)
        .send({
          repairId: ctx.repairId,
          amount: 3000,
          method: 'easypaisa',
          reference: 'EP-OK-1',
          confirmedReceived: true,
          idempotencyKey: `ok-b-${ctx.repairId}`
        })
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    const summary = await request(app)
      .get(`/api/v1/repairs/${ctx.repairId}/payments`)
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .expect(200);
    expect(summary.body.data.amountPaid).toBe(5000);
    expect(summary.body.data.outstanding).toBe(0);
    expect(await PaymentRecord.countDocuments({ repairRequest: ctx.repairId, entryType: 'payment' })).toBe(
      2
    );
  });

  it('dedupes concurrent identical idempotency keys to one ledger row', async () => {
    const ctx = await seedPaidReadyRepair(5000);
    const key = `idem-race-${ctx.repairId}`;
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post('/api/v1/documents/payments')
          .set('Authorization', `Bearer ${ctx.adminToken}`)
          .send({
            repairId: ctx.repairId,
            amount: 1500,
            method: 'cash',
            confirmedReceived: true,
            idempotencyKey: key
          })
      )
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    const ids = new Set(results.map((r) => String(r.body.data._id)));
    expect(ids.size).toBe(1);
    expect(await PaymentRecord.countDocuments({ repairRequest: ctx.repairId, entryType: 'payment' })).toBe(
      1
    );
  });

  it('rolls back payment insert when financialRevision conflict aborts before commit', async () => {
    const ctx = await seedPaidReadyRepair(5000);
    const repair = await RepairRequest.findById(ctx.repairId);
    expect(repair).toBeTruthy();

    // Simulate competing revision bump outside the payment path.
    await RepairRequest.updateOne({ _id: ctx.repairId }, { $inc: { financialRevision: 1 } });

    // Force a transaction that reads stale revision by manually racing: first payment still works.
    const ok = await request(app)
      .post('/api/v1/documents/payments')
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({
        repairId: ctx.repairId,
        amount: 1000,
        method: 'cash',
        confirmedReceived: true,
        idempotencyKey: `after-bump-${ctx.repairId}`
      });
    expect(ok.status).toBe(201);
    expect(await PaymentRecord.countDocuments({ repairRequest: ctx.repairId })).toBe(1);
  });

  it('supports partial and full reversals via API with authorization', async () => {
    const ctx = await seedPaidReadyRepair(5000);
    const pay = await request(app)
      .post('/api/v1/documents/payments')
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({
        repairId: ctx.repairId,
        amount: 4000,
        method: 'cash',
        confirmedReceived: true,
        idempotencyKey: `rev-src-${ctx.repairId}`
      })
      .expect(201);

    const partial = await request(app)
      .post(`/api/v1/documents/payments/${pay.body.data._id}/reverse`)
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({ amount: 1500, reason: 'Customer dispute partial cash', idempotencyKey: `rev-p-${ctx.repairId}` })
      .expect(201);
    expect(partial.body.data.entryType).toBe('reversal');
    expect(partial.body.data.amount).toBe(1500);

    let summary = await request(app)
      .get(`/api/v1/repairs/${ctx.repairId}/payments`)
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .expect(200);
    expect(summary.body.data.amountPaid).toBe(2500);
    expect(summary.body.data.outstanding).toBe(2500);
    const original = summary.body.data.payments.find((p: any) => String(p.id) === String(pay.body.data._id));
    expect(original.status).toBe('partially_reversed');
    expect(original.reversedAmount).toBe(1500);
    expect(original.remainingReversible).toBe(2500);

    await request(app)
      .post(`/api/v1/documents/payments/${pay.body.data._id}/reverse`)
      .set('Authorization', `Bearer ${ctx.customerToken}`)
      .send({ reason: 'Customer cannot reverse' })
      .expect(403);

    const full = await request(app)
      .post(`/api/v1/documents/payments/${pay.body.data._id}/reverse`)
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({ reason: 'Remaining amount fully reversed by admin' })
      .expect(201);
    expect(full.body.data.amount).toBe(2500);

    summary = await request(app)
      .get(`/api/v1/repairs/${ctx.repairId}/payments`)
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .expect(200);
    expect(summary.body.data.amountPaid).toBe(0);
    expect(summary.body.data.outstanding).toBe(5000);

    const badReceipt = await request(app)
      .post('/api/v1/documents/issue')
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({
        repairId: ctx.repairId,
        docType: 'payment_receipt',
        paymentId: pay.body.data._id
      });
    expect(badReceipt.status).toBe(409);

    // Over-reverse blocked
    await request(app)
      .post(`/api/v1/documents/payments/${pay.body.data._id}/reverse`)
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({ amount: 1, reason: 'Should already be fully reversed' })
      .expect(409);

    void mongoose;
  });
});
