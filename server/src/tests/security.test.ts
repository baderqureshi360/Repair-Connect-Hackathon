import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app.js';
import { RepairShop, ShopMembership, User } from '../models/index.js';

const app = createApp();
const password = 'Password123!';

async function seed() {
  const passwordHash = await bcrypt.hash(password, 10);
  const shopA = await RepairShop.create({
    name: 'Shop A',
    code: 'SA01',
    address: '1 A St',
    city: 'Lahore',
    phone: '1'
  });
  const shopB = await RepairShop.create({
    name: 'Shop B',
    code: 'SB01',
    address: '2 B St',
    city: 'Karachi',
    phone: '2'
  });
  const [customer, adminA, mechanicB] = await User.create([
    { email: 'cust@sec.test', passwordHash, name: 'Cust', role: 'customer' },
    { email: 'admin@sec.test', passwordHash, name: 'Admin', role: 'shop_admin' },
    { email: 'mechb@sec.test', passwordHash, name: 'MechB', role: 'mechanic' }
  ]);
  await ShopMembership.create([
    { user: adminA._id, shop: shopA._id, role: 'shop_admin' },
    { user: mechanicB._id, shop: shopB._id, role: 'mechanic' }
  ]);
  return { shopA, shopB, customer, adminA, mechanicB };
}

async function login(email: string) {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  expect(res.body.data.token).toBeTruthy();
  return res.body.data.token as string;
}

describe('Security hardening', () => {
  it('rejects privileged self-registration attempts', async () => {
    const attempts = ['mechanic', 'parts_coordinator', 'shop_admin'] as const;
    for (const role of attempts) {
      const res = await request(app).post('/api/v1/auth/register').send({
        email: `${role}@evil.test`,
        password,
        name: 'Attacker',
        role,
        shopId: '000000000000000000000001'
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect([400, 403]).toContain(res.status);
    }

    const okCustomer = await request(app).post('/api/v1/auth/register').send({
      email: 'okcustomer@sec.test',
      password,
      name: 'Ok Customer',
      role: 'customer'
    });
    expect(okCustomer.status).toBe(201);
    expect(okCustomer.body.data.user.role).toBe('customer');
    expect(okCustomer.body.data.user.passwordHash).toBeUndefined();
  });

  it('allows only shop admins to create staff for their shop', async () => {
    const ctx = await seed();
    const adminToken = await login('admin@sec.test');
    const customerToken = await login('cust@sec.test');

    const denied = await request(app)
      .post('/api/v1/auth/staff')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        email: 'newmech@sec.test',
        password,
        name: 'New Mech',
        role: 'mechanic',
        shopId: ctx.shopA._id.toString()
      });
    expect(denied.status).toBe(403);

    const crossShop = await request(app)
      .post('/api/v1/auth/staff')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'cross@sec.test',
        password,
        name: 'Cross',
        role: 'mechanic',
        shopId: ctx.shopB._id.toString()
      });
    expect(crossShop.status).toBe(403);

    const created = await request(app)
      .post('/api/v1/auth/staff')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'newmech@sec.test',
        password,
        name: 'New Mech',
        role: 'mechanic',
        shopId: ctx.shopA._id.toString()
      });
    expect(created.status).toBe(201);
    expect(created.body.data.user.role).toBe('mechanic');

    const stored = await User.findOne({ email: 'newmech@sec.test' }).select('+passwordHash');
    expect(stored?.passwordHash).toBeTruthy();
    expect(stored?.passwordHash).not.toBe(password);
    expect(await bcrypt.compare(password, stored!.passwordHash)).toBe(true);
  });

  it('rejects unauthenticated access to protected routes', async () => {
    const res = await request(app).get('/api/v1/repairs');
    expect(res.status).toBe(401);
  });

  it('rejects invalid JWT', async () => {
    const res = await request(app)
      .get('/api/v1/repairs')
      .set('Authorization', 'Bearer not.a.valid.token');
    expect(res.status).toBe(401);
  });

  it('blocks cross-shop repair access', async () => {
    const ctx = await seed();
    const customerToken = await login('cust@sec.test');
    const outsiderToken = await login('mechb@sec.test');

    const created = await request(app)
      .post('/api/v1/repairs')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        shopId: ctx.shopA._id.toString(),
        deviceType: 'Laptop',
        brand: 'Dell',
        model: 'XPS',
        problemDescription: 'Screen cracked badly'
      });
    expect(created.status).toBe(201);

    const peek = await request(app)
      .get(`/api/v1/repairs/${created.body.data._id}`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(peek.status).toBe(403);
  });
});
