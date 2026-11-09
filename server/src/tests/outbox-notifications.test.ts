import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app.js';
import {
  Notification,
  OutboxEvent,
  RepairMessage,
  RepairShop,
  ShopMembership,
  User
} from '../models/index.js';
import { processOutboxBatch } from '../services/outbox.js';
import { notify } from '../services/notifications.js';

const app = createApp();
const password = 'SecurePass1';

async function login(email: string) {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.data.token as string;
}

describe('Transactional outbox notifications', () => {
  it('dedupes notify deliveries and retains outbox audit trail', async () => {
    const passwordHash = await bcrypt.hash(password, 12);
    const stamp = Date.now();
    const user = await User.create({
      email: `outbox.${stamp}@test.com`,
      passwordHash,
      name: 'Outbox User',
      role: 'customer'
    });

    await notify({
      user: user._id,
      type: 'payment_received',
      title: 'Payment received',
      message: 'Test payment 100 PKR',
      dedupeKey: `outbox-dup-${stamp}`
    });
    await notify({
      user: user._id,
      type: 'payment_received',
      title: 'Payment received',
      message: 'Test payment 100 PKR',
      dedupeKey: `outbox-dup-${stamp}`
    });
    await processOutboxBatch(20);

    expect(await OutboxEvent.countDocuments({ dedupeKey: `outbox-dup-${stamp}` })).toBe(1);
    expect(await Notification.countDocuments({ user: user._id, type: 'payment_received' })).toBe(1);
    const delivered = await OutboxEvent.findOne({ dedupeKey: `outbox-dup-${stamp}` });
    expect(delivered?.status).toBe('delivered');
  });

  it('keeps payment customer messages durable via outbox after recordPayment', async () => {
    const passwordHash = await bcrypt.hash(password, 12);
    const stamp = Date.now();
    const shop = await RepairShop.create({
      name: `Outbox Shop ${stamp}`,
      code: `OX${String(stamp).slice(-6)}`,
      address: '1 O',
      city: 'Lahore',
      region: 'Punjab',
      phone: '+92-42-1',
      email: `ox.shop.${stamp}@test.com`,
      isActive: true
    });
    const [customer, admin, mechanic] = await User.create([
      { email: `ox.c.${stamp}@test.com`, passwordHash, name: 'C', role: 'customer' },
      { email: `ox.a.${stamp}@test.com`, passwordHash, name: 'A', role: 'shop_admin' },
      { email: `ox.m.${stamp}@test.com`, passwordHash, name: 'M', role: 'mechanic' }
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
        brand: 'Nokia',
        model: 'X',
        problemDescription: 'Outbox payment messaging verification case'
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
      .send({ findings: 'Power board fault found', recommendedActions: 'Replace power board' })
      .expect(201);
    const est = await request(app)
      .post(`/api/v1/repairs/${repairId}/estimates`)
      .set('Authorization', `Bearer ${mechanicToken}`)
      .send({ laborCost: 500, partsCost: 500 })
      .expect(201);
    await request(app)
      .post(`/api/v1/repairs/estimates/${est.body.data._id}/decision`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ decision: 'approved' })
      .expect(200);
    await request(app)
      .post(`/api/v1/repairs/${repairId}/parts-not-required`)
      .set('Authorization', `Bearer ${mechanicToken}`)
      .send({ notes: 'ok' })
      .expect(200);
    await request(app)
      .post(`/api/v1/repairs/${repairId}/start`)
      .set('Authorization', `Bearer ${mechanicToken}`)
      .expect(200);
    await request(app)
      .post(`/api/v1/repairs/${repairId}/complete`)
      .set('Authorization', `Bearer ${mechanicToken}`)
      .send({ workPerformed: 'Fixed device thoroughly enough', finalCost: 1000 })
      .expect(200);

    await request(app)
      .post('/api/v1/documents/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        repairId,
        amount: 1000,
        method: 'cash',
        confirmedReceived: true,
        idempotencyKey: `ox-pay-${repairId}`
      })
      .expect(201);

    await processOutboxBatch(20);
    expect(
      await Notification.countDocuments({ user: customer._id, type: 'payment_received' })
    ).toBeGreaterThan(0);
    expect(
      await RepairMessage.countDocuments({
        repairRequest: repairId,
        messageType: 'payment',
        visibility: 'customer_visible'
      })
    ).toBeGreaterThan(0);
    expect(await OutboxEvent.countDocuments({ status: 'delivered' })).toBeGreaterThan(0);
  });
});
