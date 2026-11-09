import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app.js';
import { RepairRequest, RepairShop, ShopMembership, User } from '../models/index.js';

const app = createApp();
const password = 'Password123!';

async function login(email: string) {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.data.token as string;
}

describe('Analytics and documents', () => {
  it('returns scoped customer analytics and issues an intake document', async () => {
    const passwordHash = await bcrypt.hash(password, 10);
    const shop = await RepairShop.create({
      name: 'Docs Shop',
      code: 'DOC1',
      address: '1 Doc',
      city: 'Lahore',
      phone: '1'
    });
    const [customer, admin] = await User.create([
      { email: 'docs-c@test.com', passwordHash, name: 'Docs C', role: 'customer' },
      { email: 'docs-a@test.com', passwordHash, name: 'Docs A', role: 'shop_admin' }
    ]);
    await ShopMembership.create({ user: admin._id, shop: shop._id, role: 'shop_admin' });

    const repair = await RepairRequest.create({
      customer: customer._id,
      shop: shop._id,
      referenceNumber: 'DOC-1',
      trackingToken: 'doc-track-' + 'z'.repeat(20),
      deviceType: 'Laptop',
      brand: 'Dell',
      model: 'XPS',
      problemDescription: 'Needs intake documentation for printing',
      status: 'submitted'
    });

    const customerToken = await login('docs-c@test.com');
    const analytics = await request(app)
      .get('/api/v1/analytics/me?range=30d')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(analytics.status).toBe(200);
    expect(analytics.body.data.summary.total).toBeGreaterThanOrEqual(1);
    expect(analytics.body.data.charts.statusDistribution).toBeTruthy();

    const issued = await request(app)
      .post('/api/v1/documents/issue')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ repairId: String(repair._id), docType: 'intake_receipt' });
    expect(issued.status).toBe(201);
    expect(issued.body.data.documentNumber).toMatch(/^IN-/);
    expect(issued.body.data.snapshot.repair.referenceNumber).toBe('DOC-1');

    const adminToken = await login('docs-a@test.com');
    const settings = await request(app)
      .patch(`/api/v1/documents/settings/${shop._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ currency: 'PKR', taxRatePercent: 5, receiptFooter: 'Authorized shop footer' });
    expect(settings.status).toBe(200);
    expect(settings.body.data.taxRatePercent).toBe(5);
  });

  it('does not mark payment receipt as paid without payment records', async () => {
    const passwordHash = await bcrypt.hash(password, 10);
    const shop = await RepairShop.create({
      name: 'Pay Shop',
      code: 'PAY1',
      address: '2 Pay',
      city: 'Lahore',
      phone: '2'
    });
    const [customer, admin] = await User.create([
      { email: 'pay-c@test.com', passwordHash, name: 'Pay C', role: 'customer' },
      { email: 'pay-a@test.com', passwordHash, name: 'Pay A', role: 'shop_admin' }
    ]);
    await ShopMembership.create({ user: admin._id, shop: shop._id, role: 'shop_admin' });
    const repair = await RepairRequest.create({
      customer: customer._id,
      shop: shop._id,
      referenceNumber: 'PAY-1',
      trackingToken: 'pay-track-' + 'a'.repeat(20),
      deviceType: 'Phone',
      brand: 'Pixel',
      model: '8',
      problemDescription: 'Completed repair awaiting payment documentation',
      status: 'ready_for_collection',
      finalCost: 500,
      workPerformed: 'Screen replaced',
      workCompletedAt: new Date()
    });

    const adminToken = await login('pay-a@test.com');
    const bad = await request(app)
      .post('/api/v1/documents/issue')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ repairId: String(repair._id), docType: 'payment_receipt' });
    expect(bad.status).toBeGreaterThanOrEqual(400);

    const payment = await request(app)
      .post('/api/v1/documents/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ repairId: String(repair._id), amount: 500, method: 'cash' });
    expect(payment.status).toBe(201);

    const receipt = await request(app)
      .post('/api/v1/documents/issue')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        repairId: String(repair._id),
        docType: 'payment_receipt',
        paymentId: payment.body.data._id
      });
    expect(receipt.status).toBe(201);
    expect(receipt.body.data.paymentStatus).toBe('paid');
  });
});
