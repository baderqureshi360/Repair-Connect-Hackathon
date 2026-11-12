import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app.js';
import {
  AuditLog,
  RepairRequest,
  RepairShop,
  ShopMembership,
  User
} from '../models/index.js';

const app = createApp();
const password = 'Password123!';

async function seed() {
  const passwordHash = await bcrypt.hash(password, 10);
  const shopA = await RepairShop.create({
    name: 'Staff Shop A',
    code: 'STAFFA',
    address: '1 Staff St',
    city: 'Lahore',
    phone: '111'
  });
  const shopB = await RepairShop.create({
    name: 'Staff Shop B',
    code: 'STAFFB',
    address: '2 Staff St',
    city: 'Karachi',
    phone: '222'
  });

  const [adminA, adminB, mechanicA, customer, partsB] = await User.create([
    { email: 'admin-a@staff.test', passwordHash, name: 'Admin A', role: 'shop_admin' },
    { email: 'admin-b@staff.test', passwordHash, name: 'Admin B', role: 'shop_admin' },
    { email: 'mech-a@staff.test', passwordHash, name: 'Mech A', role: 'mechanic' },
    { email: 'cust@staff.test', passwordHash, name: 'Customer', role: 'customer' },
    { email: 'parts-b@staff.test', passwordHash, name: 'Parts B', role: 'parts_coordinator' }
  ]);

  const [adminMembershipA] = await ShopMembership.create([
    { user: adminA._id, shop: shopA._id, role: 'shop_admin', isActive: true },
    { user: adminB._id, shop: shopB._id, role: 'shop_admin', isActive: true },
    { user: mechanicA._id, shop: shopA._id, role: 'mechanic', isActive: true },
    { user: partsB._id, shop: shopB._id, role: 'parts_coordinator', isActive: true }
  ]);

  const customerUser = await User.findOne({ email: 'cust@staff.test' });
  const repair = await RepairRequest.create({
    referenceNumber: 'RC-STAFF-1',
    trackingToken: 'staff-track-' + 'x'.repeat(20),
    customer: customerUser!._id,
    shop: shopA._id,
    deviceType: 'Phone',
    brand: 'Test',
    model: 'X1',
    problemDescription: 'Screen cracked for staff history test',
    status: 'assigned',
    assignedMechanic: mechanicA._id
  });

  return {
    shopA,
    shopB,
    adminA,
    adminB,
    mechanicA,
    customer,
    adminMembershipA,
    repair
  };
}

async function login(email: string) {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.data.token as string;
}

describe('Staff management module', () => {
  it('allows shop admin to create a mechanic in an authorized shop', async () => {
    const ctx = await seed();
    const token = await login('admin-a@staff.test');

    const created = await request(app)
      .post('/api/v1/auth/staff')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'new.mech@staff.test',
        password,
        name: 'New Mechanic',
        role: 'mechanic',
        shopId: String(ctx.shopA._id),
        phone: '03001234567'
      });

    expect(created.status).toBe(201);
    expect(created.body.data.user.role).toBe('mechanic');
    expect(created.body.data.membership.role).toBe('mechanic');

    const audit = await AuditLog.findOne({ action: 'auth.staff_create' }).sort({ createdAt: -1 });
    expect(audit).toBeTruthy();
    expect(String(audit?.shop)).toBe(String(ctx.shopA._id));
  });

  it('allows shop admin to create a parts coordinator who lands on parts portal role', async () => {
    const ctx = await seed();
    const token = await login('admin-a@staff.test');

    const created = await request(app)
      .post('/api/v1/auth/staff')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'new.parts@staff.test',
        password,
        name: 'New Parts',
        role: 'parts_coordinator',
        shopId: String(ctx.shopA._id)
      });

    expect(created.status).toBe(201);
    expect(created.body.data.user.role).toBe('parts_coordinator');

    const loginRes = await request(app).post('/api/v1/auth/login').send({
      email: 'new.parts@staff.test',
      password
    });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.data.user.role).toBe('parts_coordinator');
    // Client roleHome maps parts_coordinator → /app/parts
    expect(loginRes.body.data.user.shops?.length).toBeGreaterThan(0);

    const partsList = await request(app)
      .get('/api/v1/parts')
      .set('Authorization', `Bearer ${loginRes.body.data.token}`);
    expect(partsList.status).toBe(200);
  });

  it('lists manage view with stats and supports edit + deactivate', async () => {
    const ctx = await seed();
    const token = await login('admin-a@staff.test');

    const create = await request(app)
      .post('/api/v1/auth/staff')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'edit.me@staff.test',
        password,
        name: 'Edit Me',
        role: 'mechanic',
        shopId: String(ctx.shopA._id),
        phone: '111'
      });
    expect(create.status).toBe(201);
    const membershipId = create.body.data.membership.membershipId || create.body.data.membership.id;

    const list = await request(app)
      .get(`/api/v1/auth/staff?view=manage&includeInactive=1&shopId=${ctx.shopA._id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.data.stats.total).toBeGreaterThanOrEqual(2);
    expect(list.body.data.stats.active).toBeGreaterThanOrEqual(2);
    expect(list.body.data.staff.some((s: { user: { email: string } }) => s.user?.email === 'edit.me@staff.test')).toBe(
      true
    );

    const patched = await request(app)
      .patch(`/api/v1/auth/staff/${membershipId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Edited Name', phone: '999', role: 'parts_coordinator' });
    expect(patched.status).toBe(200);
    expect(patched.body.data.user.name).toBe('Edited Name');
    expect(patched.body.data.role).toBe('parts_coordinator');

    const deactivated = await request(app)
      .post(`/api/v1/auth/staff/${membershipId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.data.membership.isActive).toBe(false);

    const loginDenied = await request(app).post('/api/v1/auth/login').send({
      email: 'edit.me@staff.test',
      password
    });
    expect(loginDenied.status).toBe(401);
  });

  it('blocks unauthorized cross-shop staff access', async () => {
    const ctx = await seed();
    const tokenA = await login('admin-a@staff.test');

    const denyCreate = await request(app)
      .post('/api/v1/auth/staff')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        email: 'cross@staff.test',
        password,
        name: 'Cross',
        role: 'mechanic',
        shopId: String(ctx.shopB._id)
      });
    expect(denyCreate.status).toBe(403);

    const listB = await request(app)
      .get(`/api/v1/auth/staff?shopId=${ctx.shopB._id}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(listB.status).toBe(403);
  });

  it('denies customer and mechanic access to staff management', async () => {
    const ctx = await seed();
    const customerToken = await login('cust@staff.test');
    const mechToken = await login('mech-a@staff.test');

    for (const token of [customerToken, mechToken]) {
      const list = await request(app)
        .get('/api/v1/auth/staff')
        .set('Authorization', `Bearer ${token}`);
      expect(list.status).toBe(403);

      const create = await request(app)
        .post('/api/v1/auth/staff')
        .set('Authorization', `Bearer ${token}`)
        .send({
          email: 'nope@staff.test',
          password,
          name: 'Nope',
          role: 'mechanic',
          shopId: String(ctx.shopA._id)
        });
      expect(create.status).toBe(403);
    }
  });

  it('prevents privilege escalation to platform_operator', async () => {
    const ctx = await seed();
    const token = await login('admin-a@staff.test');

    const escalated = await request(app)
      .post('/api/v1/auth/staff')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'evil.ops@staff.test',
        password,
        name: 'Evil Ops',
        role: 'platform_operator',
        shopId: String(ctx.shopA._id)
      });
    expect(escalated.status).toBeGreaterThanOrEqual(400);
    expect([400, 403]).toContain(escalated.status);

    const created = await request(app)
      .post('/api/v1/auth/staff')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'temp.mech@staff.test',
        password,
        name: 'Temp Mech',
        role: 'mechanic',
        shopId: String(ctx.shopA._id)
      });
    const membershipId = created.body.data.membership.membershipId;

    const patchEscalation = await request(app)
      .patch(`/api/v1/auth/staff/${membershipId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'platform_operator' });
    expect(patchEscalation.status).toBeGreaterThanOrEqual(400);
    expect([400, 403]).toContain(patchEscalation.status);
  });

  it('protects the last active shop admin from deactivation and self-demotion', async () => {
    const ctx = await seed();
    const token = await login('admin-a@staff.test');

    const membershipId = String(ctx.adminMembershipA._id);

    const selfDeactivate = await request(app)
      .post(`/api/v1/auth/staff/${membershipId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false });
    expect(selfDeactivate.status).toBe(403);
    expect(selfDeactivate.body.error.code).toBe('SELF_DEACTIVATION_FORBIDDEN');

    const selfDemote = await request(app)
      .patch(`/api/v1/auth/staff/${membershipId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'mechanic' });
    expect(selfDemote.status).toBe(403);
    expect(selfDemote.body.error.code).toBe('SELF_DEMOTION_FORBIDDEN');

    // Add second admin, then first can deactivate the second; last remaining still protected via self rules.
    const second = await request(app)
      .post('/api/v1/auth/staff')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'admin-a2@staff.test',
        password,
        name: 'Admin A2',
        role: 'shop_admin',
        shopId: String(ctx.shopA._id)
      });
    expect(second.status).toBe(201);
    const secondId = second.body.data.membership.membershipId;

    const deactivateSecond = await request(app)
      .post(`/api/v1/auth/staff/${secondId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false });
    expect(deactivateSecond.status).toBe(200);

    const stillSelf = await request(app)
      .post(`/api/v1/auth/staff/${membershipId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false });
    expect(stillSelf.status).toBe(403);
  });

  it('preserves repair records after staff deactivation', async () => {
    const ctx = await seed();
    const token = await login('admin-a@staff.test');

    const mechMembership = await ShopMembership.findOne({
      user: ctx.mechanicA._id,
      shop: ctx.shopA._id
    });
    expect(mechMembership).toBeTruthy();

    const before = await RepairRequest.findById(ctx.repair._id);
    expect(before?.assignedMechanic?.toString()).toBe(String(ctx.mechanicA._id));
    expect(before?.problemDescription).toContain('staff history');

    const deactivated = await request(app)
      .post(`/api/v1/auth/staff/${mechMembership!._id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.data.preservedRepairReferences).toBeGreaterThanOrEqual(1);

    const after = await RepairRequest.findById(ctx.repair._id);
    expect(after).toBeTruthy();
    expect(after?.assignedMechanic?.toString()).toBe(String(ctx.mechanicA._id));
    expect(after?.referenceNumber).toBe('RC-STAFF-1');
    expect(after?.problemDescription).toBe(before?.problemDescription);

    const userStillExists = await User.findById(ctx.mechanicA._id);
    expect(userStillExists).toBeTruthy();
    expect(userStillExists?.isActive).toBe(false);
  });

  it('rejects duplicate employee emails', async () => {
    const ctx = await seed();
    const token = await login('admin-a@staff.test');

    const first = await request(app)
      .post('/api/v1/auth/staff')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'dup@staff.test',
        password,
        name: 'Dup One',
        role: 'mechanic',
        shopId: String(ctx.shopA._id)
      });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/v1/auth/staff')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'dup@staff.test',
        password,
        name: 'Dup Two',
        role: 'parts_coordinator',
        shopId: String(ctx.shopA._id)
      });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('DUPLICATE');
  });

  it('supports secure password reset for staff', async () => {
    const ctx = await seed();
    const token = await login('admin-a@staff.test');

    const created = await request(app)
      .post('/api/v1/auth/staff')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'reset.me@staff.test',
        password,
        name: 'Reset Me',
        role: 'mechanic',
        shopId: String(ctx.shopA._id)
      });
    const membershipId = created.body.data.membership.membershipId;

    const reset = await request(app)
      .post(`/api/v1/auth/staff/${membershipId}/reset-password`)
      .set('Authorization', `Bearer ${token}`)
      .send({ temporaryPassword: 'NewPass123!', invite: true });
    expect(reset.status).toBe(200);
    expect(reset.body.data.temporaryPassword).toBe('NewPass123!');
    expect(reset.body.data.invite?.resetToken).toBeTruthy();

    const oldLogin = await request(app).post('/api/v1/auth/login').send({
      email: 'reset.me@staff.test',
      password
    });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app).post('/api/v1/auth/login').send({
      email: 'reset.me@staff.test',
      password: 'NewPass123!'
    });
    expect(newLogin.status).toBe(200);
  });
});
