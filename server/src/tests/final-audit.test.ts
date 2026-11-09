import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app.js';
import {
  FinancialDocument,
  PaymentRecord,
  RepairRequest,
  RepairShop,
  ShopMembership,
  User
} from '../models/index.js';
import { issueDocument } from '../services/documents.js';
import type { AuthUser } from '../middleware/auth.js';

const app = createApp();
const password = 'Password123!';

async function login(email: string) {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.data.token as string;
}

function asAuth(user: { _id: { toString(): string }; role: string; email: string }, shopIds: string[]): AuthUser {
  return {
    id: user._id.toString(),
    email: user.email,
    role: user.role as AuthUser['role'],
    name: 'Audit',
    preferredLanguage: 'en',
    shopIds
  };
}

async function seedShops() {
  const passwordHash = await bcrypt.hash(password, 10);
  const [shopA, shopB] = await RepairShop.create([
    { name: 'Audit Shop A', code: 'AUDA', address: 'A', city: 'Lahore', phone: '1' },
    { name: 'Audit Shop B', code: 'AUDB', address: 'B', city: 'Karachi', phone: '2' }
  ]);
  const [custA, custB, adminA, adminB, mechA, partsA] = await User.create([
    { email: 'audit-ca@test.com', passwordHash, name: 'Cust A', role: 'customer' },
    { email: 'audit-cb@test.com', passwordHash, name: 'Cust B', role: 'customer' },
    { email: 'audit-aa@test.com', passwordHash, name: 'Admin A', role: 'shop_admin' },
    { email: 'audit-ab@test.com', passwordHash, name: 'Admin B', role: 'shop_admin' },
    { email: 'audit-ma@test.com', passwordHash, name: 'Mech A', role: 'mechanic' },
    { email: 'audit-pa@test.com', passwordHash, name: 'Parts A', role: 'parts_coordinator' }
  ]);
  await ShopMembership.create([
    { user: adminA._id, shop: shopA._id, role: 'shop_admin' },
    { user: adminB._id, shop: shopB._id, role: 'shop_admin' },
    { user: mechA._id, shop: shopA._id, role: 'mechanic' },
    { user: partsA._id, shop: shopA._id, role: 'parts_coordinator' }
  ]);

  const [repairA, repairB] = await RepairRequest.create([
    {
      customer: custA._id,
      shop: shopA._id,
      referenceNumber: 'AUD-A-1',
      trackingToken: 'audit-a-' + 'x'.repeat(24),
      deviceType: 'Laptop',
      brand: 'A',
      model: '1',
      problemDescription: 'Audit repair A long enough',
      status: 'completed',
      assignedMechanic: mechA._id,
      finalCost: 1000,
      workPerformed: 'Fixed A',
      workCompletedAt: new Date(),
      completedAt: new Date(),
      internalNotes: 'INTERNAL-A'
    },
    {
      customer: custB._id,
      shop: shopB._id,
      referenceNumber: 'AUD-B-1',
      trackingToken: 'audit-b-' + 'y'.repeat(24),
      deviceType: 'Phone',
      brand: 'B',
      model: '2',
      problemDescription: 'Audit repair B long enough',
      status: 'completed',
      finalCost: 2000,
      workPerformed: 'Fixed B',
      completedAt: new Date()
    }
  ]);

  return { shopA, shopB, custA, custB, adminA, adminB, mechA, partsA, repairA, repairB };
}

describe('Final audit — documents, analytics, preferences', () => {
  it('generates unique concurrent document numbers per shop', async () => {
    const { shopA, adminA, repairA } = await seedShops();
    const actor = asAuth(adminA, [String(shopA._id)]);

    const issued = await Promise.all(
      Array.from({ length: 8 }, () =>
        issueDocument({ user: actor, repairId: String(repairA._id), docType: 'invoice' })
      )
    );

    const numbers = issued.map((d) => d.documentNumber);
    expect(new Set(numbers).size).toBe(8);
    expect(numbers.every((n) => n.startsWith('INV-'))).toBe(true);
  });

  it('preserves invoice snapshot and blocks unpaid payment receipts', async () => {
    const { shopA, adminA, repairA } = await seedShops();
    const token = await login('audit-aa@test.com');

    const invoice = await request(app)
      .post('/api/v1/documents/issue')
      .set('Authorization', `Bearer ${token}`)
      .send({ repairId: String(repairA._id), docType: 'invoice' });
    expect(invoice.status).toBe(201);
    expect(invoice.body.data.docType).toBe('invoice');
    expect(invoice.body.data.paymentStatus).toBe('unpaid');
    expect(invoice.body.data.snapshot.repair.referenceNumber).toBe('AUD-A-1');
    const snapshotBefore = JSON.stringify(invoice.body.data.snapshot);

    // Mutate live repair after issue — historical snapshot must remain unchanged.
    await RepairRequest.findByIdAndUpdate(repairA._id, { workPerformed: 'CHANGED AFTER ISSUE' });
    const fetched = await request(app)
      .get(`/api/v1/documents/${invoice.body.data._id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(fetched.status).toBe(200);
    expect(JSON.stringify(fetched.body.data.snapshot)).toBe(snapshotBefore);
    expect(fetched.body.data.snapshot.repair.workPerformed).toBe('Fixed A');

    const estimate = await request(app)
      .post('/api/v1/documents/issue')
      .set('Authorization', `Bearer ${token}`)
      .send({ repairId: String(repairA._id), docType: 'estimate' });
    expect(estimate.status).toBe(201);
    expect(estimate.body.data.docType).toBe('estimate');
    expect(estimate.body.data.paymentStatus).toBe('not_applicable');
    expect(estimate.body.data.documentNumber).toMatch(/^QT-/);
    expect(invoice.body.data.documentNumber).toMatch(/^INV-/);

    const unpaidReceipt = await request(app)
      .post('/api/v1/documents/issue')
      .set('Authorization', `Bearer ${token}`)
      .send({ repairId: String(repairA._id), docType: 'payment_receipt' });
    expect(unpaidReceipt.status).toBeGreaterThanOrEqual(400);

    void shopA;
  });

  it('enforces customer ownership and cross-shop document denial', async () => {
    const { shopA, shopB, adminA, adminB, repairA, repairB } = await seedShops();
    const tokenA = await login('audit-aa@test.com');
    const tokenB = await login('audit-ab@test.com');
    const custA = await login('audit-ca@test.com');
    const custB = await login('audit-cb@test.com');

    const docA = await request(app)
      .post('/api/v1/documents/issue')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ repairId: String(repairA._id), docType: 'warranty' });
    expect(docA.status).toBe(201);

    const docB = await request(app)
      .post('/api/v1/documents/issue')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ repairId: String(repairB._id), docType: 'warranty' });
    expect(docB.status).toBe(201);

    const crossShop = await request(app)
      .get(`/api/v1/documents/${docB.body.data._id}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(crossShop.status).toBe(403);

    const foreignCustomer = await request(app)
      .get(`/api/v1/documents/${docA.body.data._id}`)
      .set('Authorization', `Bearer ${custB}`);
    expect(foreignCustomer.status).toBe(403);

    const owner = await request(app)
      .get(`/api/v1/documents/${docA.body.data._id}`)
      .set('Authorization', `Bearer ${custA}`);
    expect(owner.status).toBe(200);

    const guessed = await request(app)
      .get('/api/v1/documents/000000000000000000000099')
      .set('Authorization', `Bearer ${custA}`);
    expect([403, 404]).toContain(guessed.status);

    void shopA;
    void shopB;
    void adminA;
    void adminB;
  });

  it('scopes analytics and CSV export by role/shop', async () => {
    const { shopA, repairA, repairB, mechA } = await seedShops();
    await PaymentRecord.create({
      shop: shopA._id,
      repairRequest: repairA._id,
      customer: repairA.customer,
      amount: 400,
      recordedBy: mechA._id,
      method: 'cash'
    });

    const custA = await login('audit-ca@test.com');
    const mechToken = await login('audit-ma@test.com');
    const partsToken = await login('audit-pa@test.com');
    const adminA = await login('audit-aa@test.com');
    const adminB = await login('audit-ab@test.com');

    const customerAnalytics = await request(app)
      .get('/api/v1/analytics/me?range=90d')
      .set('Authorization', `Bearer ${custA}`);
    expect(customerAnalytics.status).toBe(200);
    expect(customerAnalytics.body.data.summary.total).toBe(1);
    // Completed Repair Value = finalCost; Actual Spending = PaymentRecord; Outstanding = unpaid remainder.
    expect(customerAnalytics.body.data.summary.completedRepairValue).toBe(1000);
    expect(customerAnalytics.body.data.summary.actualCustomerSpending).toBe(400);
    expect(customerAnalytics.body.data.summary.outstandingBalance).toBe(600);
    expect(customerAnalytics.body.data.summary.recordedSpending).toBe(1000);

    const mechAnalytics = await request(app)
      .get('/api/v1/analytics/me?range=90d')
      .set('Authorization', `Bearer ${mechToken}`);
    expect(mechAnalytics.status).toBe(200);
    expect(mechAnalytics.body.data.summary.assigned).toBe(1);
    expect(mechAnalytics.body.data.summary.completed).toBe(1);

    const partsAnalytics = await request(app)
      .get('/api/v1/analytics/me?range=90d')
      .set('Authorization', `Bearer ${partsToken}`);
    expect(partsAnalytics.status).toBe(200);
    expect(partsAnalytics.body.data.summary).toBeDefined();
    expect(typeof partsAnalytics.body.data.summary.activeParts).toBe('number');

    const partsForeignShop = await request(app)
      .get(`/api/v1/analytics/me?range=90d&shopId=${repairB.shop}`)
      .set('Authorization', `Bearer ${partsToken}`);
    expect(partsForeignShop.status).toBe(403);

    const adminAnalytics = await request(app)
      .get('/api/v1/analytics/me?range=90d')
      .set('Authorization', `Bearer ${adminA}`);
    expect(adminAnalytics.status).toBe(200);
    expect(adminAnalytics.body.data.summary.totalRepairs).toBe(1);
    // Recorded revenue uses confirmed PaymentRecord totals (not finalCost).
    expect(adminAnalytics.body.data.summary.recordedRevenue).toBe(400);

    const csvOk = await request(app)
      .get('/api/v1/reports/operations.csv')
      .set('Authorization', `Bearer ${adminA}`);
    expect(csvOk.status).toBe(200);

    const csvDenied = await request(app)
      .get('/api/v1/reports/operations.csv')
      .set('Authorization', `Bearer ${mechToken}`);
    expect(csvDenied.status).toBe(403);

    const foreignShop = await request(app)
      .get(`/api/v1/analytics/admin?shopId=${repairB.shop}`)
      .set('Authorization', `Bearer ${adminA}`);
    expect(foreignShop.status).toBe(403);

    void repairA;
    void adminB;
  });

  it('keeps appearance preferences isolated across accounts', async () => {
    await seedShops();
    const a = await login('audit-ca@test.com');
    const b = await login('audit-cb@test.com');

    const saveA = await request(app)
      .patch('/api/v1/auth/me/preferences')
      .set('Authorization', `Bearer ${a}`)
      .send({
        theme: 'dark',
        accent: 'teal',
        density: 'compact',
        fontScale: 'large',
        reducedMotion: true,
        highContrast: true,
        chartStyle: 'line'
      });
    expect(saveA.status).toBe(200);

    const saveB = await request(app)
      .patch('/api/v1/auth/me/preferences')
      .set('Authorization', `Bearer ${b}`)
      .send({
        theme: 'light',
        accent: 'emerald',
        density: 'comfortable',
        fontScale: 'standard',
        reducedMotion: false,
        highContrast: false,
        chartStyle: 'donut'
      });
    expect(saveB.status).toBe(200);

    const meA = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${a}`);
    const meB = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${b}`);
    expect(meA.body.data.preferences.accent).toBe('teal');
    expect(meA.body.data.preferences.density).toBe('compact');
    expect(meA.body.data.preferences.fontScale).toBe('large');
    expect(meA.body.data.preferences.reducedMotion).toBe(true);
    expect(meB.body.data.preferences.accent).toBe('emerald');
    expect(meB.body.data.preferences.theme).toBe('light');
    expect(meB.body.data.preferences.chartStyle).toBe('donut');

    const widgetsA = await request(app)
      .patch('/api/v1/auth/me/preferences')
      .set('Authorization', `Bearer ${a}`)
      .send({ dashboardWidgets: ['repairs', 'spending'] });
    expect(widgetsA.status).toBe(200);

    const widgetsB = await request(app)
      .patch('/api/v1/auth/me/preferences')
      .set('Authorization', `Bearer ${b}`)
      .send({ dashboardWidgets: ['jobs'] });
    expect(widgetsB.status).toBe(200);

    const afterA = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${a}`);
    const afterB = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${b}`);
    expect(afterA.body.data.preferences.dashboardWidgets).toEqual(['repairs', 'spending']);
    expect(afterB.body.data.preferences.dashboardWidgets).toEqual(['jobs']);
  });

  it('computes outstanding balance after partial payment', async () => {
    const { shopA, adminA, repairA } = await seedShops();
    const token = await login('audit-aa@test.com');

    // Payments are recorded before case closure.
    await RepairRequest.findByIdAndUpdate(repairA._id, {
      status: 'ready_for_collection',
      completedAt: null,
      workCompletedAt: new Date()
    });

    const pay = await request(app)
      .post('/api/v1/documents/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({ repairId: String(repairA._id), amount: 250, method: 'cash', confirmedReceived: true });
    expect(pay.status).toBe(201);

    const invoice = await request(app)
      .post('/api/v1/documents/issue')
      .set('Authorization', `Bearer ${token}`)
      .send({ repairId: String(repairA._id), docType: 'invoice' });
    expect(invoice.status).toBe(201);
    expect(invoice.body.data.amountPaid).toBe(250);
    expect(invoice.body.data.paymentStatus).toBe('partial');
    expect(invoice.body.data.balanceDue).toBe(750);

    const docs = await FinancialDocument.find({ shop: shopA._id, docType: 'invoice' });
    expect(docs.length).toBeGreaterThanOrEqual(1);
    void adminA;
  });
});
