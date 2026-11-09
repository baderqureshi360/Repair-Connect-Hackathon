import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app.js';
import {
  AuditLog,
  PaymentRecord,
  RepairMessage,
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

async function seedLifecycle() {
  const passwordHash = await bcrypt.hash(password, 12);
  const stamp = Date.now();
  const shop = await RepairShop.create({
    name: `Life Shop ${stamp}`,
    code: `LF${String(stamp).slice(-6)}`,
    address: '1 Life St',
    city: 'Lahore',
    region: 'Punjab',
    phone: '+92-42-111',
    email: `life.shop.${stamp}@test.com`,
    isActive: true
  });
  const [customer, admin, mechanic] = await User.create([
    {
      email: `life.c.${stamp}@test.com`,
      passwordHash,
      name: 'Life Customer',
      role: 'customer'
    },
    {
      email: `life.a.${stamp}@test.com`,
      passwordHash,
      name: 'Life Admin',
      role: 'shop_admin'
    },
    {
      email: `life.m.${stamp}@test.com`,
      passwordHash,
      name: 'Life Mechanic',
      role: 'mechanic'
    }
  ]);
  await ShopMembership.create([
    { user: admin._id, shop: shop._id, role: 'shop_admin', isActive: true },
    { user: mechanic._id, shop: shop._id, role: 'mechanic', isActive: true }
  ]);
  return {
    shop,
    customer,
    admin,
    mechanic,
    customerToken: await login(customer.email),
    adminToken: await login(admin.email),
    mechanicToken: await login(mechanic.email)
  };
}

describe('Lifecycle — messaging, payments, closure', () => {
  it('runs communication + partial/full payment + collection + close with isolation', async () => {
    const ctx = await seedLifecycle();

    const created = await request(app)
      .post('/api/v1/repairs')
      .set('Authorization', `Bearer ${ctx.customerToken}`)
      .send({
        shopId: String(ctx.shop._id),
        deviceType: 'Laptop',
        brand: 'Dell',
        model: 'XPS',
        problemDescription: 'Keyboard failing intermittently during typing sessions'
      });
    expect(created.status).toBe(201);
    const repairId = created.body.data._id as string;

    await request(app)
      .post(`/api/v1/repairs/${repairId}/assign`)
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({ mechanicId: String(ctx.mechanic._id) })
      .expect(200);

    await request(app)
      .post(`/api/v1/repairs/${repairId}/diagnosis`)
      .set('Authorization', `Bearer ${ctx.mechanicToken}`)
      .send({ findings: 'Faulty keyboard matrix', recommendedActions: 'Replace keyboard' })
      .expect(201);

    const estimate = await request(app)
      .post(`/api/v1/repairs/${repairId}/estimates`)
      .set('Authorization', `Bearer ${ctx.mechanicToken}`)
      .send({ laborCost: 2000, partsCost: 3000, notes: 'Keyboard assembly' });
    expect(estimate.status).toBe(201);

    await request(app)
      .post(`/api/v1/repairs/${repairId}/customer-updates`)
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({
        body: 'Diagnosis complete. Estimate ready for your approval.',
        messageType: 'estimate'
      })
      .expect(201);

    await request(app)
      .post(`/api/v1/repairs/estimates/${estimate.body.data._id}/decision`)
      .set('Authorization', `Bearer ${ctx.customerToken}`)
      .send({ decision: 'approved' })
      .expect(200);

    await request(app)
      .post(`/api/v1/repairs/${repairId}/parts-not-required`)
      .set('Authorization', `Bearer ${ctx.mechanicToken}`)
      .send({ notes: 'Using in-house keyboard stock' })
      .expect(200);

    await request(app)
      .post(`/api/v1/repairs/${repairId}/start`)
      .set('Authorization', `Bearer ${ctx.mechanicToken}`)
      .expect(200);

    await request(app)
      .post(`/api/v1/repairs/${repairId}/messages`)
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({
        body: 'Repair work has started on your device.',
        visibility: 'customer_visible',
        messageType: 'status_update'
      })
      .expect(201);

    await request(app)
      .post(`/api/v1/repairs/${repairId}/messages`)
      .set('Authorization', `Bearer ${ctx.customerToken}`)
      .send({ body: 'Thanks — please keep me updated on timing.' })
      .expect(201);

    const complete = await request(app)
      .post(`/api/v1/repairs/${repairId}/complete`)
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({
        workPerformed: 'Replaced keyboard and verified ports',
        finalCost: 5000,
        completionSummary: 'Keyboard replaced successfully. Ready for payment and collection.'
      });
    expect(complete.status).toBe(200);
    expect(complete.body.data.status).toBe('ready_for_collection');

    const detail = await request(app)
      .get(`/api/v1/repairs/${repairId}`)
      .set('Authorization', `Bearer ${ctx.customerToken}`)
      .expect(200);
    expect(detail.body.data.customerStatus.key).toBe('repair_completed');
    expect(detail.body.data.paymentSummary.totalDue).toBe(5000);
    expect(detail.body.data.paymentSummary.outstanding).toBe(5000);

    // Partial payment
    const partial = await request(app)
      .post('/api/v1/documents/payments')
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({
        repairId,
        amount: 2000,
        method: 'cash',
        confirmedReceived: true,
        idempotencyKey: `life-partial-${repairId}`
      });
    expect(partial.status).toBe(201);

    const afterPartial = await request(app)
      .get(`/api/v1/repairs/${repairId}/payments`)
      .set('Authorization', `Bearer ${ctx.customerToken}`)
      .expect(200);
    expect(afterPartial.body.data.amountPaid).toBe(2000);
    expect(afterPartial.body.data.outstanding).toBe(3000);
    expect(afterPartial.body.data.status).toBe('partially_paid');

    // Duplicate idempotent payment
    const dup = await request(app)
      .post('/api/v1/documents/payments')
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({
        repairId,
        amount: 2000,
        method: 'cash',
        confirmedReceived: true,
        idempotencyKey: `life-partial-${repairId}`
      });
    expect(dup.status).toBe(201);
    expect(String(dup.body.data._id)).toBe(String(partial.body.data._id));
    expect(await PaymentRecord.countDocuments({ repairRequest: repairId, entryType: 'payment' })).toBe(1);

    // Overpay blocked
    const over = await request(app)
      .post('/api/v1/documents/payments')
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({ repairId, amount: 99999, method: 'cash', confirmedReceived: true });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('EXCEEDS_BALANCE');

    // Mobile payment remainder
    const mobile = await request(app)
      .post('/api/v1/documents/payments')
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({
        repairId,
        amount: 3000,
        method: 'jazzcash',
        reference: 'JC-998877',
        confirmedReceived: true,
        idempotencyKey: `life-mobile-${repairId}`
      });
    expect(mobile.status).toBe(201);

    const receipt = await request(app)
      .post('/api/v1/documents/issue')
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({
        repairId,
        docType: 'payment_receipt',
        paymentId: mobile.body.data._id
      });
    expect(receipt.status).toBe(201);
    expect(receipt.body.data.paymentStatus).toBe('paid');

    // Close blocked without collection
    const closeEarly = await request(app)
      .post(`/api/v1/repairs/${repairId}/close`)
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({ notes: 'try close' });
    expect(closeEarly.status).toBe(409);
    expect(closeEarly.body.error.code).toBe('COLLECTION_REQUIRED');

    await request(app)
      .post(`/api/v1/repairs/${repairId}/collect`)
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({ notes: 'Customer collected laptop' })
      .expect(200);

    const closed = await request(app)
      .post(`/api/v1/repairs/${repairId}/close`)
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({ notes: 'All settled', caseSummary: 'Keyboard repair closed paid in full.' });
    expect(closed.status).toBe(200);
    expect(closed.body.data.status).toBe('completed');

    // Closed still visible
    const history = await request(app)
      .get(`/api/v1/repairs/${repairId}`)
      .set('Authorization', `Bearer ${ctx.customerToken}`)
      .expect(200);
    expect(history.body.data.customerStatus.key).toBe('closed');
    expect(history.body.data.paymentSummary.status).toBe('paid');

    // Unauthorized outsider cannot message/pay/close
    const passwordHash = await bcrypt.hash(password, 12);
    const otherShop = await RepairShop.create({
      name: 'Other Life',
      code: `OL${Date.now().toString().slice(-5)}`,
      address: '9 X',
      city: 'Karachi',
      region: 'Sindh',
      phone: '+92-21-1',
      email: `other.life.${Date.now()}@test.com`,
      isActive: true
    });
    const outsider = await User.create({
      email: `life.out.${Date.now()}@test.com`,
      passwordHash,
      name: 'Outsider',
      role: 'shop_admin'
    });
    await ShopMembership.create({
      user: outsider._id,
      shop: otherShop._id,
      role: 'shop_admin',
      isActive: true
    });
    const outToken = await login(outsider.email);

    await request(app)
      .post(`/api/v1/repairs/${repairId}/messages`)
      .set('Authorization', `Bearer ${outToken}`)
      .send({ body: 'intrusion' })
      .expect(403);
    await request(app)
      .post('/api/v1/documents/payments')
      .set('Authorization', `Bearer ${outToken}`)
      .send({ repairId, amount: 1, method: 'cash', confirmedReceived: true })
      .expect(403);
    await request(app)
      .post(`/api/v1/repairs/${repairId}/close`)
      .set('Authorization', `Bearer ${outToken}`)
      .send({ notes: 'nope' })
      .expect(403);

    // Closed repair blocks ordinary mutation
    await request(app)
      .patch(`/api/v1/repairs/${repairId}/workspace`)
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({ customerNotes: 'edit closed' })
      .expect(409);

    expect(await RepairMessage.countDocuments({ repairRequest: repairId })).toBeGreaterThan(3);
    expect(
      await AuditLog.countDocuments({
        entityType: 'RepairRequest',
        action: { $in: ['repair.close', 'repair.collect'] }
      })
    ).toBeGreaterThan(0);

    const persisted = await RepairRequest.findById(repairId);
    expect(persisted?.status).toBe('completed');
    expect(persisted?.collectedAt).toBeTruthy();
    expect(persisted?.caseSummary).toMatch(/closed paid/i);
  });

  it('partial payment reversal restores outstanding without double-counting', async () => {
    const ctx = await seedLifecycle();
    const created = await request(app)
      .post('/api/v1/repairs')
      .set('Authorization', `Bearer ${ctx.customerToken}`)
      .send({
        shopId: String(ctx.shop._id),
        deviceType: 'Phone',
        brand: 'Xiaomi',
        model: '12',
        problemDescription: 'Screen flicker for reversal audit case'
      })
      .expect(201);
    const repairId = created.body.data._id as string;

    await request(app)
      .post(`/api/v1/repairs/${repairId}/assign`)
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({ mechanicId: String(ctx.mechanic._id) })
      .expect(200);
    await request(app)
      .post(`/api/v1/repairs/${repairId}/diagnosis`)
      .set('Authorization', `Bearer ${ctx.mechanicToken}`)
      .send({ findings: 'LCD fault', recommendedActions: 'Replace LCD' })
      .expect(201);
    const est = await request(app)
      .post(`/api/v1/repairs/${repairId}/estimates`)
      .set('Authorization', `Bearer ${ctx.mechanicToken}`)
      .send({ laborCost: 1000, partsCost: 4000 })
      .expect(201);
    await request(app)
      .post(`/api/v1/repairs/estimates/${est.body.data._id}/decision`)
      .set('Authorization', `Bearer ${ctx.customerToken}`)
      .send({ decision: 'approved' })
      .expect(200);
    await request(app)
      .post(`/api/v1/repairs/${repairId}/parts-not-required`)
      .set('Authorization', `Bearer ${ctx.mechanicToken}`)
      .send({ notes: 'LCD in stock' })
      .expect(200);
    await request(app)
      .post(`/api/v1/repairs/${repairId}/start`)
      .set('Authorization', `Bearer ${ctx.mechanicToken}`)
      .expect(200);
    await request(app)
      .post(`/api/v1/repairs/${repairId}/complete`)
      .set('Authorization', `Bearer ${ctx.mechanicToken}`)
      .send({ workPerformed: 'LCD replaced and calibrated', finalCost: 5000 })
      .expect(200);

    const cash = await request(app)
      .post('/api/v1/documents/payments')
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({
        repairId,
        amount: 2000,
        method: 'cash',
        confirmedReceived: true,
        idempotencyKey: `rev-cash-${repairId}`
      })
      .expect(201);
    const jazz = await request(app)
      .post('/api/v1/documents/payments')
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({
        repairId,
        amount: 3000,
        method: 'jazzcash',
        reference: 'JC-REV-1',
        confirmedReceived: true,
        idempotencyKey: `rev-jazz-${repairId}`
      })
      .expect(201);

    await request(app)
      .post(`/api/v1/documents/payments/${jazz.body.data._id}/reverse`)
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({ reason: 'Customer disputed JazzCash txn' })
      .expect(201);

    const summary = await request(app)
      .get(`/api/v1/repairs/${repairId}/payments`)
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .expect(200);
    expect(summary.body.data.amountPaid).toBe(2000);
    expect(summary.body.data.outstanding).toBe(3000);
    expect(summary.body.data.status).toBe('partially_paid');
    expect(String(cash.body.data._id)).toBeTruthy();

    const badReceipt = await request(app)
      .post('/api/v1/documents/issue')
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({
        repairId,
        docType: 'payment_receipt',
        paymentId: jazz.body.data._id
      });
    expect(badReceipt.status).toBe(409);
    expect(badReceipt.body.error.code).toBe('INVALID_PAYMENT');
  });
});
