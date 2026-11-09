import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app.js';
import { Part, RepairShop, ShopMembership, User, RepairRequest, EstimateDecision, PartsReservation } from '../models/index.js';

const app = createApp();
const password = 'Password123!';

async function seedUsers() {
  const passwordHash = await bcrypt.hash(password, 10);
  const shop = await RepairShop.create({
    name: 'Test Shop',
    code: 'TST01',
    address: '1 Test St',
    city: 'Lahore',
    phone: '123'
  });
  const otherShop = await RepairShop.create({
    name: 'Other Shop',
    code: 'OTH01',
    address: '2 Other St',
    city: 'Karachi',
    phone: '456'
  });

  const [customer, mechanic, parts, admin, outsider] = await User.create([
    { email: 'c@test.com', passwordHash, name: 'Customer', role: 'customer' },
    { email: 'm@test.com', passwordHash, name: 'Mechanic', role: 'mechanic' },
    { email: 'p@test.com', passwordHash, name: 'Parts', role: 'parts_coordinator' },
    { email: 'a@test.com', passwordHash, name: 'Admin', role: 'shop_admin' },
    { email: 'o@test.com', passwordHash, name: 'Outsider', role: 'mechanic' }
  ]);

  await ShopMembership.create([
    { user: mechanic._id, shop: shop._id, role: 'mechanic' },
    { user: parts._id, shop: shop._id, role: 'parts_coordinator' },
    { user: admin._id, shop: shop._id, role: 'shop_admin' },
    { user: outsider._id, shop: otherShop._id, role: 'mechanic' }
  ]);

  const screen = await Part.create({
    shop: shop._id,
    sku: 'SCR-1',
    name: 'Laptop Screen',
    quantityAvailable: 0,
    quantityReserved: 0,
    reorderLevel: 1,
    unitCost: 8000
  });

  const lastUnit = await Part.create({
    shop: shop._id,
    sku: 'LAST-1',
    name: 'Last Battery',
    quantityAvailable: 1,
    quantityReserved: 0,
    reorderLevel: 0,
    unitCost: 1000
  });

  return { shop, otherShop, customer, mechanic, parts, admin, outsider, screen, lastUnit };
}

async function login(email: string) {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.data.token as string;
}

describe('RepairConnect end-to-end workflow', () => {
  it('runs full laptop repair with stock shortage then fulfillment', async () => {
    const ctx = await seedUsers();
    const customerToken = await login('c@test.com');
    const adminToken = await login('a@test.com');
    const mechanicToken = await login('m@test.com');
    const partsToken = await login('p@test.com');

    // 1. Customer submits laptop repair
    const createRes = await request(app)
      .post('/api/v1/repairs')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'idem-laptop-1')
      .send({
        shopId: ctx.shop._id.toString(),
        deviceType: 'Laptop',
        brand: 'Dell',
        model: 'XPS 15',
        problemDescription: 'Cracked screen needs replacement',
        idempotencyKey: 'idem-laptop-1'
      });
    expect(createRes.status).toBe(201);
    const repairId = createRes.body.data._id;

    // Duplicate idempotency returns same record
    const dup = await request(app)
      .post('/api/v1/repairs')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        shopId: ctx.shop._id.toString(),
        deviceType: 'Laptop',
        brand: 'Dell',
        model: 'XPS 15',
        problemDescription: 'Cracked screen needs replacement',
        idempotencyKey: 'idem-laptop-1'
      });
    expect(dup.status).toBe(201);
    expect(dup.body.data._id).toBe(repairId);

    // 2. Admin assigns mechanic
    const assign = await request(app)
      .post(`/api/v1/repairs/${repairId}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mechanicId: ctx.mechanic._id.toString() });
    expect(assign.status).toBe(200);

    // 3. Diagnosis
    const diag = await request(app)
      .post(`/api/v1/repairs/${repairId}/diagnosis`)
      .set('Authorization', `Bearer ${mechanicToken}`)
      .send({
        findings: 'LCD panel cracked; digitizer intact',
        recommendedActions: 'Replace LCD screen assembly'
      });
    expect(diag.status).toBe(201);

    // 4. Estimate
    const est = await request(app)
      .post(`/api/v1/repairs/${repairId}/estimates`)
      .set('Authorization', `Bearer ${mechanicToken}`)
      .send({ laborCost: 2500, partsCost: 8500, notes: 'Includes screen' });
    expect(est.status).toBe(201);
    const estimateId = est.body.data._id;

    // 5. Customer approves
    const decision = await request(app)
      .post(`/api/v1/repairs/estimates/${estimateId}/decision`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ decision: 'approved' });
    expect(decision.status).toBe(200);
    const savedDecision = await EstimateDecision.findOne({ estimate: estimateId });
    expect(savedDecision?.decision).toBe('approved');

    // 6. Request unavailable screen
    const pr = await request(app)
      .post(`/api/v1/repairs/${repairId}/parts-requests`)
      .set('Authorization', `Bearer ${mechanicToken}`)
      .send({ partId: ctx.screen._id.toString(), quantity: 1 });
    expect(pr.status).toBe(201);
    const partsRequestId = pr.body.data._id;

    // 7-8. Reserve fails with shortage
    const failReserve = await request(app)
      .post(`/api/v1/parts/requests/${partsRequestId}/reserve`)
      .set('Authorization', `Bearer ${partsToken}`)
      .send({ quantity: 1 });
    expect(failReserve.status).toBe(409);
    expect(failReserve.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(failReserve.body.error.details.shortage).toBeGreaterThan(0);

    // 9. Stock arrival
    const stock = await request(app)
      .post(`/api/v1/parts/${ctx.screen._id}/stock-in`)
      .set('Authorization', `Bearer ${partsToken}`)
      .send({ quantity: 2, notes: 'Supplier delivery' });
    expect(stock.status).toBe(200);
    expect(stock.body.data.quantityAvailable).toBe(2);

    // 10. Reserve succeeds
    const reserve = await request(app)
      .post(`/api/v1/parts/requests/${partsRequestId}/reserve`)
      .set('Authorization', `Bearer ${partsToken}`)
      .send({ quantity: 1 });
    expect(reserve.status).toBe(200);

    const partAfter = await Part.findById(ctx.screen._id);
    expect(partAfter?.quantityAvailable).toBe(1);
    expect(partAfter?.quantityReserved).toBe(1);

    const reservation = await PartsReservation.findOne({ partsRequest: partsRequestId });
    expect(reservation?.status).toBe('active');

    // 11. Start + finish work (ready for collection — not yet closed)
    await request(app)
      .post(`/api/v1/repairs/${repairId}/start`)
      .set('Authorization', `Bearer ${mechanicToken}`);

    const complete = await request(app)
      .post(`/api/v1/repairs/${repairId}/complete`)
      .set('Authorization', `Bearer ${mechanicToken}`)
      .send({ workPerformed: 'Replaced LCD screen and tested display', finalCost: 11000 });
    expect(complete.status).toBe(200);
    expect(complete.body.data.status).toBe('ready_for_collection');

    const finalPart = await Part.findById(ctx.screen._id);
    expect(finalPart?.quantityReserved).toBe(0);
    expect(finalPart?.quantityAvailable).toBe(1);

    // 12. Collection confirms handover (case stays open until paid + closed)
    const collect = await request(app)
      .post(`/api/v1/repairs/${repairId}/collect`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ notes: 'Customer collected device' });
    expect(collect.status).toBe(200);
    expect(collect.body.data.status).toBe('ready_for_collection');
    expect(collect.body.data.collectedAt).toBeTruthy();

    await request(app)
      .post('/api/v1/documents/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        repairId,
        amount: 11000,
        method: 'cash',
        confirmedReceived: true,
        idempotencyKey: `wf-pay-${repairId}`
      })
      .expect(201);

    const closed = await request(app)
      .post(`/api/v1/repairs/${repairId}/close`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ notes: 'Paid in full and closed' });
    expect(closed.status).toBe(200);
    expect(closed.body.data.status).toBe('completed');

    const history = await request(app)
      .get(`/api/v1/repairs/${repairId}`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(history.body.data.history.length).toBeGreaterThan(5);
    expect(history.body.data.decisions[0].decision).toBe('approved');
    expect(history.body.data.readiness.workflowStage).toBe('collected_closed');
  });

  it('rejects estimate and blocks completion without approval', async () => {
    const ctx = await seedUsers();
    const customerToken = await login('c@test.com');
    const adminToken = await login('a@test.com');
    const mechanicToken = await login('m@test.com');

    const createRes = await request(app)
      .post('/api/v1/repairs')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        shopId: ctx.shop._id.toString(),
        deviceType: 'Laptop',
        brand: 'HP',
        model: 'EliteBook',
        problemDescription: 'Keyboard failure'
      });
    const repairId = createRes.body.data._id;

    await request(app)
      .post(`/api/v1/repairs/${repairId}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mechanicId: ctx.mechanic._id.toString() });

    await request(app)
      .post(`/api/v1/repairs/${repairId}/diagnosis`)
      .set('Authorization', `Bearer ${mechanicToken}`)
      .send({ findings: 'Keyboard membrane damaged', recommendedActions: 'Replace keyboard' });

    const est = await request(app)
      .post(`/api/v1/repairs/${repairId}/estimates`)
      .set('Authorization', `Bearer ${mechanicToken}`)
      .send({ laborCost: 1500, partsCost: 2200 });

    const reject = await request(app)
      .post(`/api/v1/repairs/estimates/${est.body.data._id}/decision`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ decision: 'rejected', reason: 'Too expensive' });
    expect(reject.status).toBe(200);

    const decision = await EstimateDecision.findOne({ estimate: est.body.data._id });
    expect(decision?.decision).toBe('rejected');

    const complete = await request(app)
      .post(`/api/v1/repairs/${repairId}/complete`)
      .set('Authorization', `Bearer ${mechanicToken}`)
      .send({ workPerformed: 'Attempted completion without approval', finalCost: 100 });
    expect(complete.status).toBe(409);
  });

  it('allows only one concurrent reservation of last unit', async () => {
    const ctx = await seedUsers();
    const customerToken = await login('c@test.com');
    const adminToken = await login('a@test.com');
    const mechanicToken = await login('m@test.com');
    const partsToken = await login('p@test.com');

    const createRes = await request(app)
      .post('/api/v1/repairs')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        shopId: ctx.shop._id.toString(),
        deviceType: 'Laptop',
        brand: 'Lenovo',
        model: 'T14',
        problemDescription: 'Battery swollen'
      });
    const repairId = createRes.body.data._id;
    await request(app)
      .post(`/api/v1/repairs/${repairId}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mechanicId: ctx.mechanic._id.toString() });
    await request(app)
      .post(`/api/v1/repairs/${repairId}/diagnosis`)
      .set('Authorization', `Bearer ${mechanicToken}`)
      .send({ findings: 'Battery unsafe', recommendedActions: 'Replace battery' });
    const est = await request(app)
      .post(`/api/v1/repairs/${repairId}/estimates`)
      .set('Authorization', `Bearer ${mechanicToken}`)
      .send({ laborCost: 1000, partsCost: 1000 });
    await request(app)
      .post(`/api/v1/repairs/estimates/${est.body.data._id}/decision`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ decision: 'approved' });

    const pr1 = await request(app)
      .post(`/api/v1/repairs/${repairId}/parts-requests`)
      .set('Authorization', `Bearer ${mechanicToken}`)
      .send({ partId: ctx.lastUnit._id.toString(), quantity: 1 });

    // Second request against same last unit
    const create2 = await request(app)
      .post('/api/v1/repairs')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        shopId: ctx.shop._id.toString(),
        deviceType: 'Laptop',
        brand: 'Lenovo',
        model: 'T15',
        problemDescription: 'Another battery issue'
      });
    await request(app)
      .post(`/api/v1/repairs/${create2.body.data._id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mechanicId: ctx.mechanic._id.toString() });
    await request(app)
      .post(`/api/v1/repairs/${create2.body.data._id}/diagnosis`)
      .set('Authorization', `Bearer ${mechanicToken}`)
      .send({ findings: 'Battery fail', recommendedActions: 'Replace' });
    const est2 = await request(app)
      .post(`/api/v1/repairs/${create2.body.data._id}/estimates`)
      .set('Authorization', `Bearer ${mechanicToken}`)
      .send({ laborCost: 1000, partsCost: 1000 });
    await request(app)
      .post(`/api/v1/repairs/estimates/${est2.body.data._id}/decision`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ decision: 'approved' });
    const pr2 = await request(app)
      .post(`/api/v1/repairs/${create2.body.data._id}/parts-requests`)
      .set('Authorization', `Bearer ${mechanicToken}`)
      .send({ partId: ctx.lastUnit._id.toString(), quantity: 1 });

    const [r1, r2] = await Promise.all([
      request(app)
        .post(`/api/v1/parts/requests/${pr1.body.data._id}/reserve`)
        .set('Authorization', `Bearer ${partsToken}`)
        .send({ quantity: 1 }),
      request(app)
        .post(`/api/v1/parts/requests/${pr2.body.data._id}/reserve`)
        .set('Authorization', `Bearer ${partsToken}`)
        .send({ quantity: 1 })
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const part = await Part.findById(ctx.lastUnit._id);
    expect(part?.quantityAvailable).toBe(0);
    expect(part?.quantityReserved).toBe(1);
  });

  it('blocks cross-shop unauthorized access', async () => {
    const ctx = await seedUsers();
    const customerToken = await login('c@test.com');
    const outsiderToken = await login('o@test.com');

    const createRes = await request(app)
      .post('/api/v1/repairs')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        shopId: ctx.shop._id.toString(),
        deviceType: 'Phone',
        brand: 'Samsung',
        model: 'S21',
        problemDescription: 'Charging port broken'
      });

    const peek = await request(app)
      .get(`/api/v1/repairs/${createRes.body.data._id}`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(peek.status).toBe(403);
  });
});
