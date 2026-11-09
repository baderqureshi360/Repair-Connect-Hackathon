import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app.js';
import { RepairRequest, RepairShop, ShopMembership, User } from '../models/index.js';
import { hashTrackingAccessCode, issueTrackingCredentials } from '../services/trackingCredentials.js';

const app = createApp();
const password = 'Password123!';

async function login(email: string) {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.data.token as string;
}

async function seed() {
  const passwordHash = await bcrypt.hash(password, 10);
  const shop = await RepairShop.create({
    name: 'Track Shop',
    code: 'TRK1',
    address: '1 Track St',
    city: 'Lahore',
    phone: '03000000000'
  });
  const [customer, mechanic, otherCustomer] = await User.create([
    { email: 'track-c@test.com', passwordHash, name: 'Track Customer', role: 'customer' },
    { email: 'track-m@test.com', passwordHash, name: 'Track Mechanic', role: 'mechanic' },
    { email: 'track-c2@test.com', passwordHash, name: 'Other Customer', role: 'customer' }
  ]);
  await ShopMembership.create({ user: mechanic._id, shop: shop._id, role: 'mechanic' });

  const creds = issueTrackingCredentials();
  const repair = await RepairRequest.create({
    customer: customer._id,
    shop: shop._id,
    referenceNumber: 'RC-TRACK-1',
    trackingToken: creds.trackingToken,
    trackingAccessCodeHash: creds.trackingAccessCodeHash,
    trackingExpiresAt: creds.trackingExpiresAt,
    trackingCodeUpdatedAt: creds.trackingCodeUpdatedAt,
    deviceType: 'Laptop',
    brand: 'Lenovo',
    model: 'T14',
    serialNumber: 'SECRET-SERIAL-99',
    problemDescription: 'Keyboard keys stick under humidity',
    status: 'estimate_pending',
    assignedMechanic: mechanic._id,
    internalNotes: 'INTERNAL-DO-NOT-LEAK',
    partsRequirement: { status: 'undetermined', notes: '' }
  });

  return { shop, customer, mechanic, otherCustomer, repair, accessCode: creds.accessCode };
}

describe('public tracking & messaging', () => {
  it('allows lookup with reference + access code and strips PII', async () => {
    const ctx = await seed();
    const ok = await request(app).post('/api/v1/public/track/lookup').send({
      referenceNumber: ctx.repair.referenceNumber,
      accessCode: ctx.accessCode
    });
    expect(ok.status).toBe(200);
    expect(ok.body.data.referenceNumber).toBe('RC-TRACK-1');
    expect(ok.body.data.brand).toBe('Lenovo');
    expect(ok.body.data.parts).toBeTruthy();
    expect(ok.body.data.estimate).toBeTruthy();
    const blob = JSON.stringify(ok.body.data);
    expect(blob).not.toMatch(/track-c@test\.com/i);
    expect(blob).not.toMatch(/SECRET-SERIAL/i);
    expect(blob).not.toMatch(/INTERNAL-DO-NOT-LEAK/i);
    expect(blob).not.toMatch(/trackingAccessCodeHash/i);
  });

  it('denies guessed reference and bad code with uniform error', async () => {
    const ctx = await seed();
    const badRef = await request(app).post('/api/v1/public/track/lookup').send({
      referenceNumber: 'RC-DOES-NOT-EXIST',
      accessCode: ctx.accessCode
    });
    expect(badRef.status).toBe(404);
    expect(badRef.body.error.code).toBe('TRACKING_DENIED');

    const badCode = await request(app).post('/api/v1/public/track/lookup').send({
      referenceNumber: ctx.repair.referenceNumber,
      accessCode: 'WRONGCODE01'
    });
    expect(badCode.status).toBe(404);
    expect(badCode.body.error.code).toBe('TRACKING_DENIED');
  });

  it('denies revoked and expired tracking', async () => {
    const ctx = await seed();
    await RepairRequest.findByIdAndUpdate(ctx.repair._id, { trackingRevokedAt: new Date() });
    const revoked = await request(app).post('/api/v1/public/track/lookup').send({
      referenceNumber: ctx.repair.referenceNumber,
      accessCode: ctx.accessCode
    });
    expect(revoked.status).toBe(404);

    await RepairRequest.findByIdAndUpdate(ctx.repair._id, {
      trackingRevokedAt: null,
      trackingExpiresAt: new Date(Date.now() - 1000)
    });
    const expired = await request(app)
      .get(`/api/v1/public/track/${ctx.repair.trackingToken}`)
      .send();
    expect(expired.status).toBe(404);
  });

  it('issues access code on create and never returns hash', async () => {
    const ctx = await seed();
    const token = await login('track-c@test.com');
    const create = await request(app)
      .post('/api/v1/repairs')
      .set('Authorization', `Bearer ${token}`)
      .send({
        shopId: ctx.shop._id.toString(),
        deviceType: 'Phone',
        brand: 'Samsung',
        model: 'A54',
        problemDescription: 'Battery drains overnight quickly'
      });
    expect(create.status).toBe(201);
    expect(create.body.data.trackingToken).toBeTruthy();
    expect(create.body.data.trackingAccessCode).toMatch(/^[0-9A-Z]{10}$/);
    expect(create.body.data.trackingAccessCodeHash).toBeUndefined();

    const stored = await RepairRequest.findById(create.body.data._id).select('+trackingAccessCodeHash');
    expect(stored?.trackingAccessCodeHash).toBe(
      hashTrackingAccessCode(create.body.data.trackingAccessCode)
    );
  });

  it('enforces message visibility between customer and staff', async () => {
    const ctx = await seed();
    const customerToken = await login('track-c@test.com');
    const mechanicToken = await login('track-m@test.com');
    const otherToken = await login('track-c2@test.com');

    const customerMsg = await request(app)
      .post(`/api/v1/repairs/${ctx.repair._id}/messages`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ body: 'Hello shop, when will diagnosis finish?' });
    expect(customerMsg.status).toBe(201);

    const internal = await request(app)
      .post(`/api/v1/repairs/${ctx.repair._id}/messages`)
      .set('Authorization', `Bearer ${mechanicToken}`)
      .send({ body: 'Internal: suspect liquid damage', visibility: 'internal' });
    expect(internal.status).toBe(201);

    const visible = await request(app)
      .post(`/api/v1/repairs/${ctx.repair._id}/messages`)
      .set('Authorization', `Bearer ${mechanicToken}`)
      .send({ body: 'We are diagnosing your device now.', visibility: 'customer_visible' });
    expect(visible.status).toBe(201);

    const customerList = await request(app)
      .get(`/api/v1/repairs/${ctx.repair._id}/messages`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(customerList.status).toBe(200);
    const bodies = customerList.body.data.map((m: { body: string }) => m.body);
    expect(bodies).toContain('Hello shop, when will diagnosis finish?');
    expect(bodies).toContain('We are diagnosing your device now.');
    expect(bodies.join(' ')).not.toMatch(/Internal: suspect/);

    const staffList = await request(app)
      .get(`/api/v1/repairs/${ctx.repair._id}/messages`)
      .set('Authorization', `Bearer ${mechanicToken}`);
    expect(staffList.body.data.some((m: { visibility: string }) => m.visibility === 'internal')).toBe(
      true
    );

    const forbidden = await request(app)
      .get(`/api/v1/repairs/${ctx.repair._id}/messages`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(forbidden.status).toBe(403);
  });

  it('accepts shop applications without creating staff accounts', async () => {
    const res = await request(app).post('/api/v1/public/shop-applications').send({
      shopName: 'New Valley Repairs',
      businessEmail: 'apply@valley.example',
      contactPerson: 'Ali Khan',
      phone: '03001234567',
      address: '12 Mall Road',
      city: 'Lahore',
      region: 'Punjab',
      mechanicCount: 3,
      servicesDescription: 'Laptops, phones, and tablet hardware repairs.'
    });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('pending_review');
    expect(res.body.data.id).toMatch(/^SA-/);

    const users = await User.find({ email: 'apply@valley.example' });
    expect(users.length).toBe(0);

    const status = await request(app)
      .get(`/api/v1/public/shop-applications/${res.body.data.id}`)
      .query({ email: 'apply@valley.example' });
    expect(status.status).toBe(200);
    expect(status.body.data.status).toBe('pending_review');
  });
});
