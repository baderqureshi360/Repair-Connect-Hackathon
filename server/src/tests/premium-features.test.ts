import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app.js';
import {
  Appointment,
  Part,
  RepairShop,
  ShopMembership,
  User,
  RepairRequest,
  StockTransfer
} from '../models/index.js';

const app = createApp();
const password = 'Password123!';

async function seed() {
  const passwordHash = await bcrypt.hash(password, 10);
  const shopA = await RepairShop.create({
    name: 'Premium Shop A',
    code: 'PREMA',
    address: '1 A St',
    city: 'Lahore',
    phone: '111',
    dailyCapacity: 8,
    slotMinutes: 60,
    cancelPolicyHours: 0
  });
  const shopB = await RepairShop.create({
    name: 'Premium Shop B',
    code: 'PREMB',
    address: '2 B St',
    city: 'Karachi',
    phone: '222'
  });

  const [customer, mechanic, parts, admin, outsiderAdmin] = await User.create([
    { email: 'prem-c@test.com', passwordHash, name: 'Prem Customer', role: 'customer' },
    { email: 'prem-m@test.com', passwordHash, name: 'Prem Mechanic', role: 'mechanic' },
    { email: 'prem-p@test.com', passwordHash, name: 'Prem Parts', role: 'parts_coordinator' },
    { email: 'prem-a@test.com', passwordHash, name: 'Prem Admin', role: 'shop_admin' },
    { email: 'prem-oa@test.com', passwordHash, name: 'Outsider Admin', role: 'shop_admin' }
  ]);

  await ShopMembership.create([
    { user: mechanic._id, shop: shopA._id, role: 'mechanic' },
    { user: parts._id, shop: shopA._id, role: 'parts_coordinator' },
    { user: admin._id, shop: shopA._id, role: 'shop_admin' },
    { user: outsiderAdmin._id, shop: shopB._id, role: 'shop_admin' }
  ]);

  const partA = await Part.create({
    shop: shopA._id,
    sku: 'XFER-1',
    name: 'Transfer Cable',
    quantityAvailable: 5,
    quantityReserved: 0,
    reorderLevel: 2,
    unitCost: 500
  });

  return { shopA, shopB, customer, mechanic, parts, admin, outsiderAdmin, partA };
}

async function login(email: string) {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.data.token as string;
}

function tomorrowAt(hour: number) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  // Align to a likely open weekday slot window
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return d;
}

describe('Premium SaaS features', () => {
  it('creates repair with serial/accessories/tracking and supports public track privacy', async () => {
    const ctx = await seed();
    const token = await login('prem-c@test.com');

    const create = await request(app)
      .post('/api/v1/repairs')
      .set('Authorization', `Bearer ${token}`)
      .send({
        shopId: ctx.shopA._id.toString(),
        deviceType: 'Phone',
        brand: 'Pixel',
        model: '8',
        serialNumber: 'SN-PREM-1',
        accessories: 'Case, charger',
        problemDescription: 'Screen flicker under load',
        photos: [{ url: 'data:image/png;base64,aaa', kind: 'device', visibility: 'customer' }]
      });
    expect(create.status).toBe(201);
    expect(create.body.data.serialNumber).toBe('SN-PREM-1');
    expect(create.body.data.accessories).toContain('charger');
    expect(create.body.data.trackingToken).toBeTruthy();
    expect(create.body.data.photos?.length).toBe(1);

    const track = await request(app).get(`/api/v1/public/track/${create.body.data.trackingToken}`);
    expect(track.status).toBe(200);
    expect(track.body.data.referenceNumber).toBe(create.body.data.referenceNumber);
    expect(track.body.data.brand).toBe('Pixel');
    expect(track.body.data.customer).toBeUndefined();
    expect(JSON.stringify(track.body.data)).not.toMatch(/prem-c@test\.com/i);
    expect(JSON.stringify(track.body.data)).not.toMatch(/Prem Customer/i);

    const bad = await request(app).get('/api/v1/public/track/not-a-real-token-zzzz');
    expect(bad.status).toBe(404);

    const short = await request(app).get('/api/v1/public/track/short');
    expect(short.status).toBe(404);
    expect(short.body.error.code).toBe('TRACKING_DENIED');
  });

  it('prevents appointment double booking and supports cancel', async () => {
    const ctx = await seed();
    const token = await login('prem-c@test.com');
    const day = tomorrowAt(10);
    const date = day.toISOString().slice(0, 10);

    const slots = await request(app).get(
      `/api/v1/appointments/slots?shopId=${ctx.shopA._id}&date=${date}`
    );
    expect(slots.status).toBe(200);
    expect(Array.isArray(slots.body.data.slots)).toBe(true);
    expect(slots.body.data.slots.length).toBeGreaterThan(0);

    const startsAt = slots.body.data.slots[0];
    const book1 = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${token}`)
      .send({ shopId: ctx.shopA._id.toString(), startsAt, notes: 'Drop-off' });
    expect(book1.status).toBe(201);

    const book2 = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${token}`)
      .send({ shopId: ctx.shopA._id.toString(), startsAt, notes: 'Duplicate' });
    expect(book2.status).toBe(409);
    expect(book2.body.error.code).toBe('SLOT_UNAVAILABLE');

    const slotsAfter = await request(app).get(
      `/api/v1/appointments/slots?shopId=${ctx.shopA._id}&date=${date}`
    );
    expect(slotsAfter.body.data.slots).not.toContain(startsAt);

    const cancel = await request(app)
      .post(`/api/v1/appointments/${book1.body.data._id}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Changed plans' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.status).toBe('cancelled');

    const stillBooked = await Appointment.countDocuments({
      shop: ctx.shopA._id,
      startsAt: new Date(startsAt),
      status: 'booked'
    });
    expect(stillBooked).toBe(0);
  });

  it('rejects inventory adjust without reason and blocks negative stock', async () => {
    const ctx = await seed();
    const token = await login('prem-p@test.com');

    const noReason = await request(app)
      .post(`/api/v1/parts/${ctx.partA._id}/adjust`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantityDelta: -1, reason: 'x' });
    expect(noReason.status).toBe(400);

    const tooMuch = await request(app)
      .post(`/api/v1/parts/${ctx.partA._id}/adjust`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantityDelta: -99, reason: 'Cycle count correction' });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error.code).toBe('INSUFFICIENT_STOCK');

    const ok = await request(app)
      .post(`/api/v1/parts/${ctx.partA._id}/adjust`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantityDelta: -1, reason: 'Damaged unit disposed' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.quantityAvailable).toBe(4);
  });

  it('runs shop-to-shop transfer approve/dispatch/receive without negative inventory', async () => {
    const ctx = await seed();
    const partsToken = await login('prem-p@test.com');
    const outsiderToken = await login('prem-oa@test.com');

    const create = await request(app)
      .post('/api/v1/transfers')
      .set('Authorization', `Bearer ${partsToken}`)
      .send({
        fromPartId: ctx.partA._id.toString(),
        toShopId: ctx.shopB._id.toString(),
        quantity: 2,
        reason: 'Balance stock'
      });
    expect(create.status).toBe(201);

    const approve = await request(app)
      .post(`/api/v1/transfers/${create.body.data._id}/approve`)
      .set('Authorization', `Bearer ${partsToken}`)
      .send({});
    expect(approve.status).toBe(200);
    expect(approve.body.data.status).toBe('awaiting_transfer');

    const before = await Part.findById(ctx.partA._id);
    expect(before!.quantityAvailable).toBe(5);

    const dispatch = await request(app)
      .post(`/api/v1/transfers/${create.body.data._id}/dispatch`)
      .set('Authorization', `Bearer ${partsToken}`)
      .send({});
    expect(dispatch.status).toBe(200);
    expect(dispatch.body.data.status).toBe('in_transit');
    const afterDispatch = await Part.findById(ctx.partA._id);
    expect(afterDispatch!.quantityAvailable).toBe(3);

    const receiveForbidden = await request(app)
      .post(`/api/v1/transfers/${create.body.data._id}/receive`)
      .set('Authorization', `Bearer ${partsToken}`)
      .send({});
    expect(receiveForbidden.status).toBe(403);

    const receive = await request(app)
      .post(`/api/v1/transfers/${create.body.data._id}/receive`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({});
    expect(receive.status).toBe(200);
    expect(receive.body.data.status).toBe('received');

    const dest = await Part.findOne({ shop: ctx.shopB._id, sku: 'XFER-1' });
    expect(dest).toBeTruthy();
    expect(dest!.quantityAvailable).toBe(2);

    const xfer = await StockTransfer.findById(create.body.data._id);
    expect(xfer!.status).toBe('received');
  });

  it('supports mechanic workspace updates and customer feedback/receipt after completion', async () => {
    const ctx = await seed();
    const customerToken = await login('prem-c@test.com');
    const adminToken = await login('prem-a@test.com');
    const mechanicToken = await login('prem-m@test.com');

    const create = await request(app)
      .post('/api/v1/repairs')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        shopId: ctx.shopA._id.toString(),
        deviceType: 'Laptop',
        brand: 'Dell',
        model: 'XPS',
        problemDescription: 'Battery drains quickly overnight'
      });
    const repairId = create.body.data._id;

    await request(app)
      .post(`/api/v1/repairs/${repairId}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mechanicId: ctx.mechanic._id.toString() });

    const workspace = await request(app)
      .patch(`/api/v1/repairs/${repairId}/workspace`)
      .set('Authorization', `Bearer ${mechanicToken}`)
      .send({
        priority: 'high',
        laborMinutes: 45,
        customerNotes: 'Will replace battery',
        internalNotes: 'Need OEM pack',
        diagnosisChecklist: [{ label: 'Run diagnostics', done: true, visibility: 'internal' }],
        photos: [{ url: 'data:image/jpeg;base64,bbb', kind: 'before', visibility: 'internal' }]
      });
    expect(workspace.status).toBe(200);
    expect(workspace.body.data.priority).toBe('high');
    expect(workspace.body.data.laborMinutes).toBe(45);
    expect(workspace.body.data.customerNotes).toContain('battery');

    await request(app)
      .post(`/api/v1/repairs/${repairId}/diagnosis`)
      .set('Authorization', `Bearer ${mechanicToken}`)
      .send({ findings: 'Weak battery cells', recommendedActions: 'Replace battery pack' });

    const est = await request(app)
      .post(`/api/v1/repairs/${repairId}/estimates`)
      .set('Authorization', `Bearer ${mechanicToken}`)
      .send({ laborCost: 1000, partsCost: 5000 });

    await request(app)
      .post(`/api/v1/repairs/estimates/${est.body.data._id}/decision`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ decision: 'approved' });

    await request(app)
      .post(`/api/v1/repairs/${repairId}/parts-not-required`)
      .set('Authorization', `Bearer ${mechanicToken}`)
      .send({ notes: 'Battery swap uses stocked pack already on hand — confirmed none additional' });

    await request(app)
      .post(`/api/v1/repairs/${repairId}/start`)
      .set('Authorization', `Bearer ${mechanicToken}`)
      .send({});

    const complete = await request(app)
      .post(`/api/v1/repairs/${repairId}/complete`)
      .set('Authorization', `Bearer ${mechanicToken}`)
      .send({ workPerformed: 'Replaced battery pack', finalCost: 6000 });
    expect(complete.status).toBe(200);
    expect(complete.body.data.status).toBe('ready_for_collection');
    expect(complete.body.data.warrantyExpiresAt).toBeTruthy();

    const collect = await request(app)
      .post(`/api/v1/repairs/${repairId}/collect`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ notes: 'Handed over' });
    expect(collect.status).toBe(200);
    expect(collect.body.data.status).toBe('ready_for_collection');
    expect(collect.body.data.collectedAt).toBeTruthy();

    await request(app)
      .post('/api/v1/documents/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        repairId,
        amount: 6000,
        method: 'cash',
        confirmedReceived: true,
        idempotencyKey: `prem-pay-${repairId}`
      })
      .expect(201);

    const closed = await request(app)
      .post(`/api/v1/repairs/${repairId}/close`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ notes: 'Closed after payment' });
    expect(closed.status).toBe(200);
    expect(closed.body.data.status).toBe('completed');

    const feedbackEarly = await request(app)
      .post(`/api/v1/repairs/${repairId}/feedback`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rating: 5, comment: 'Great service' });
    expect(feedbackEarly.status).toBe(200);

    const receipt = await request(app)
      .get(`/api/v1/repairs/${repairId}/receipt`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(receipt.status).toBe(200);
    expect(receipt.body.data.finalCost).toBe(6000);
    expect(receipt.body.data.referenceNumber).toBeTruthy();

    const outsider = await login('prem-oa@test.com');
    const forbiddenReceipt = await request(app)
      .get(`/api/v1/repairs/${repairId}/receipt`)
      .set('Authorization', `Bearer ${outsider}`);
    expect(forbiddenReceipt.status).toBe(403);
  });

  it('returns admin operations analytics from real records and blocks outsider shop', async () => {
    const ctx = await seed();
    const customerToken = await login('prem-c@test.com');
    const adminToken = await login('prem-a@test.com');
    const outsiderToken = await login('prem-oa@test.com');

    const created = await request(app)
      .post('/api/v1/repairs')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        shopId: ctx.shopA._id.toString(),
        deviceType: 'Tablet',
        brand: 'iPad',
        model: 'Air',
        problemDescription: 'Does not charge from wall adapter'
      });
    expect(created.status).toBe(201);

    const report = await request(app)
      .get('/api/v1/reports/operations')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(report.status).toBe(200);
    expect(report.body.data.totalReceived).toBeGreaterThanOrEqual(1);
    expect(report.body.data).toHaveProperty('avgTurnaroundHours');
    expect(report.body.data).toHaveProperty('mechanicWorkload');

    const csv = await request(app)
      .get('/api/v1/reports/operations.csv')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(csv.status).toBe(200);
    expect(String(csv.text || csv.body)).toContain('reference,status');

    const blocked = await request(app)
      .get('/api/v1/reports/operations')
      .set('Authorization', `Bearer ${outsiderToken}`);
    // Outsider admin has shop B membership; report scoped to their shops (may be empty but authorized)
    expect(blocked.status).toBe(200);
    expect(blocked.body.data.totalReceived).toBe(0);

    const customerBlocked = await request(app)
      .get('/api/v1/reports/operations')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(customerBlocked.status).toBe(403);
  });

  it('updates notification preferences and respects them for in-app create', async () => {
    const ctx = await seed();
    const token = await login('prem-c@test.com');

    const patch = await request(app)
      .patch('/api/v1/auth/me/notifications')
      .set('Authorization', `Bearer ${token}`)
      .send({ repairUpdates: false, appointmentReminders: true });
    expect(patch.status).toBe(200);
    expect(patch.body.data.repairUpdates).toBe(false);

    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.body.data.notificationPreferences.repairUpdates).toBe(false);

    // supplier create requires parts role
    const partsToken = await login('prem-p@test.com');
    const supplier = await request(app)
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${partsToken}`)
      .send({
        shopId: ctx.shopA._id.toString(),
        name: 'DisplayCo Test',
        phone: '03001234567',
        email: 'vendor@example.com'
      });
    expect(supplier.status).toBe(201);

    const customerSupplier = await request(app)
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${token}`)
      .send({ shopId: ctx.shopA._id.toString(), name: 'Nope' });
    expect(customerSupplier.status).toBe(403);
  });

  it('rejects oversized photo payload on repair create', async () => {
    const ctx = await seed();
    const token = await login('prem-c@test.com');
    const huge = 'x'.repeat(400_001);
    const res = await request(app)
      .post('/api/v1/repairs')
      .set('Authorization', `Bearer ${token}`)
      .send({
        shopId: ctx.shopA._id.toString(),
        deviceType: 'Phone',
        brand: 'Samsung',
        model: 'S24',
        problemDescription: 'Camera fails to focus properly',
        photos: [{ url: huge }]
      });
    expect(res.status).toBe(400);
  });
});
