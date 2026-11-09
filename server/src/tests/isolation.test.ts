import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app.js';
import {
  Appointment,
  Part,
  RepairRequest,
  RepairShop,
  ShopMembership,
  User
} from '../models/index.js';

const app = createApp();
const password = 'Password123!';

async function login(email: string) {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.data.token as string;
}

async function seedIsolation() {
  const passwordHash = await bcrypt.hash(password, 10);
  const [shopA, shopB] = await RepairShop.create([
    { name: 'Iso Shop A', code: 'ISA1', address: 'A St', city: 'Lahore', phone: '1' },
    { name: 'Iso Shop B', code: 'ISB1', address: 'B St', city: 'Karachi', phone: '2' }
  ]);

  const users = await User.create([
    { email: 'cust-a@iso.test', passwordHash, name: 'Customer A', role: 'customer' },
    { email: 'cust-b@iso.test', passwordHash, name: 'Customer B', role: 'customer' },
    { email: 'mech-a@iso.test', passwordHash, name: 'Mechanic A', role: 'mechanic' },
    { email: 'mech-b@iso.test', passwordHash, name: 'Mechanic B', role: 'mechanic' },
    { email: 'parts-a@iso.test', passwordHash, name: 'Parts A', role: 'parts_coordinator' },
    { email: 'parts-b@iso.test', passwordHash, name: 'Parts B', role: 'parts_coordinator' },
    { email: 'admin-a@iso.test', passwordHash, name: 'Admin A', role: 'shop_admin' },
    { email: 'admin-b@iso.test', passwordHash, name: 'Admin B', role: 'shop_admin' }
  ]);

  const [custA, custB, mechA, mechB, partsA, partsB, adminA, adminB] = users;

  await ShopMembership.create([
    { user: mechA._id, shop: shopA._id, role: 'mechanic' },
    { user: mechB._id, shop: shopB._id, role: 'mechanic' },
    { user: partsA._id, shop: shopA._id, role: 'parts_coordinator' },
    { user: partsB._id, shop: shopB._id, role: 'parts_coordinator' },
    { user: adminA._id, shop: shopA._id, role: 'shop_admin' },
    { user: adminB._id, shop: shopB._id, role: 'shop_admin' }
  ]);

  const [repairA, repairB] = await RepairRequest.create([
    {
      customer: custA._id,
      shop: shopA._id,
      referenceNumber: 'ISO-A-1',
      trackingToken: 'iso-track-a-' + 'x'.repeat(20),
      deviceType: 'Laptop',
      brand: 'ABrand',
      model: 'A1',
      problemDescription: 'Customer A device issue long enough',
      status: 'completed',
      assignedMechanic: mechA._id,
      finalCost: 1000,
      workPerformed: 'Fixed A',
      completedAt: new Date(),
      internalNotes: 'SECRET-A-INTERNAL'
    },
    {
      customer: custB._id,
      shop: shopB._id,
      referenceNumber: 'ISO-B-1',
      trackingToken: 'iso-track-b-' + 'y'.repeat(20),
      deviceType: 'Phone',
      brand: 'BBrand',
      model: 'B1',
      problemDescription: 'Customer B device issue long enough',
      status: 'completed',
      assignedMechanic: mechB._id,
      finalCost: 2000,
      workPerformed: 'Fixed B',
      completedAt: new Date(),
      internalNotes: 'SECRET-B-INTERNAL'
    }
  ]);

  const apptB = await Appointment.create({
    shop: shopB._id,
    customer: custB._id,
    startsAt: new Date(Date.now() + 86400000),
    endsAt: new Date(Date.now() + 86400000 + 3600000),
    status: 'booked'
  });

  const [partA, partB] = await Part.create([
    {
      shop: shopA._id,
      sku: 'ISO-A-SKU',
      name: 'Part A',
      quantityAvailable: 5,
      quantityReserved: 0,
      reorderLevel: 1,
      unitCost: 10
    },
    {
      shop: shopB._id,
      sku: 'ISO-B-SKU',
      name: 'Part B',
      quantityAvailable: 5,
      quantityReserved: 0,
      reorderLevel: 1,
      unitCost: 10
    }
  ]);

  return {
    shopA,
    shopB,
    custA,
    custB,
    mechA,
    mechB,
    partsA,
    partsB,
    adminA,
    adminB,
    repairA,
    repairB,
    apptB,
    partA,
    partB
  };
}

describe('Multi-user isolation', () => {
  it('blocks customer A from customer B repair, receipt, and appointments', async () => {
    const ctx = await seedIsolation();
    const tokenA = await login('cust-a@iso.test');

    const repairB = await request(app)
      .get(`/api/v1/repairs/${ctx.repairB._id}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(repairB.status).toBe(403);

    const receiptB = await request(app)
      .get(`/api/v1/repairs/${ctx.repairB._id}/receipt`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(receiptB.status).toBe(403);

    const list = await request(app).get('/api/v1/repairs').set('Authorization', `Bearer ${tokenA}`);
    expect(list.status).toBe(200);
    expect(list.body.data.every((r: { _id: string }) => r._id === String(ctx.repairA._id))).toBe(
      true
    );

    const appts = await request(app)
      .get('/api/v1/appointments')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(appts.status).toBe(200);
    expect(appts.body.data.some((a: { _id: string }) => a._id === String(ctx.apptB._id))).toBe(
      false
    );

    const own = await request(app)
      .get(`/api/v1/repairs/${ctx.repairA._id}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(own.status).toBe(200);
    expect(JSON.stringify(own.body)).not.toContain('SECRET-A-INTERNAL');
  });

  it('blocks mechanic A from mechanic B assigned repair and shop B stats', async () => {
    const ctx = await seedIsolation();
    const tokenA = await login('mech-a@iso.test');

    const foreign = await request(app)
      .get(`/api/v1/repairs/${ctx.repairB._id}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(foreign.status).toBe(403);

    const stats = await request(app)
      .get('/api/v1/repairs/stats/summary')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(stats.status).toBe(200);
    expect(stats.body.data.total).toBe(1);
    expect(stats.body.data.completed).toBe(1);
  });

  it('blocks parts coordinator A from shop B inventory', async () => {
    const ctx = await seedIsolation();
    const tokenA = await login('parts-a@iso.test');

    const list = await request(app).get('/api/v1/parts').set('Authorization', `Bearer ${tokenA}`);
    expect(list.status).toBe(200);
    const ids = (list.body.data || []).map((p: { _id: string }) => String(p._id));
    expect(ids).toContain(String(ctx.partA._id));
    expect(ids).not.toContain(String(ctx.partB._id));
  });

  it('blocks shop admin A from shop B reports and staff', async () => {
    const ctx = await seedIsolation();
    const tokenA = await login('admin-a@iso.test');
    const tokenB = await login('admin-b@iso.test');

    const reportA = await request(app)
      .get('/api/v1/reports/operations')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(reportA.status).toBe(200);

    const staffB = await request(app)
      .get('/api/v1/auth/staff')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(staffB.status).toBe(200);
    const staffEmails = JSON.stringify(staffB.body.data);
    expect(staffEmails).toContain('mech-b@iso.test');
    expect(staffEmails).not.toContain('mech-a@iso.test');

    const deny = await request(app)
      .post('/api/v1/auth/staff')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        email: 'evil@iso.test',
        password,
        name: 'Evil',
        role: 'mechanic',
        shopId: String(ctx.shopB._id)
      });
    expect(deny.status).toBe(403);
  });

  it('rejects self role escalation and keeps preferences per account', async () => {
    await seedIsolation();
    const tokenA = await login('cust-a@iso.test');
    const tokenB = await login('cust-b@iso.test');

    const escalate = await request(app)
      .patch('/api/v1/auth/me/profile')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Customer A', role: 'shop_admin' });
    expect(escalate.status).toBeGreaterThanOrEqual(400);

    const prefsA = await request(app)
      .patch('/api/v1/auth/me/preferences')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ theme: 'dark', accent: 'teal' });
    expect(prefsA.status).toBe(200);
    expect(prefsA.body.data.theme).toBe('dark');

    const prefsB = await request(app)
      .patch('/api/v1/auth/me/preferences')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ theme: 'light', accent: 'emerald' });
    expect(prefsB.status).toBe(200);

    const meA = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${tokenA}`);
    const meB = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${tokenB}`);
    expect(meA.body.data.preferences.theme).toBe('dark');
    expect(meB.body.data.preferences.theme).toBe('light');
    expect(meA.body.data.role).toBe('customer');
  });

  it('keeps public tracking free of private fields', async () => {
    const ctx = await seedIsolation();
    const track = await request(app).get(`/api/v1/public/track/${ctx.repairA.trackingToken}`);
    expect(track.status).toBe(200);
    const raw = JSON.stringify(track.body);
    expect(raw).not.toContain('cust-a@iso.test');
    expect(raw).not.toContain('SECRET-A-INTERNAL');
  });
});
