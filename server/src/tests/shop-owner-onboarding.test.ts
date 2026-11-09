import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { createApp } from '../app.js';
import { RepairShop, ShopApplication, ShopMembership, User } from '../models/index.js';
import { approveShopApplication, rejectShopApplication } from '../services/shopApplications.js';

const app = createApp();

function ownerPayload(suffix: string) {
  const email = `owner.${suffix}@example.com`;
  return {
    ownerName: 'Nadia Owner',
    ownerEmail: email,
    ownerPhone: '+92-300-5550001',
    password: 'SecurePass1',
    confirmPassword: 'SecurePass1',
    shopName: `Nadia Mobile Lab ${suffix}`,
    businessPhone: '+92-42-5550002',
    businessEmail: email,
    address: '10 Test Street',
    city: 'Lahore',
    region: 'Punjab',
    servicesDescription: 'Mobile and laptop repair specialists for consumers.',
    serviceCategories: ['mobile_phones_tablets', 'computers_laptops'] as const,
    supportedDevices: ['Phone', 'Laptop'],
    supportedBrands: ['Samsung', 'Apple'],
    termsAccepted: true as const
  };
}

async function register(payload: ReturnType<typeof ownerPayload>) {
  const res = await request(app).post('/api/v1/public/shop-applications/register').send(payload);
  expect(res.status).toBe(201);
  return res.body.data as { id: string; status: string; shopName: string };
}

async function loginToken(email: string, password: string) {
  const login = await request(app).post('/api/v1/auth/login').send({ email, password });
  expect(login.status).toBe(200);
  expect(login.body.data.token).toBeTruthy();
  return login.body.data as {
    token: string;
    user: { onboardingPending?: boolean; accountStatus?: string };
  };
}

describe('Shop owner onboarding', () => {
  it('registers owner with hashed password and pending application', async () => {
    const payload = ownerPayload(`reg-${Date.now()}`);
    const data = await register(payload);

    expect(data.id).toMatch(/^SA-/);
    expect(data.status).toBe('pending_review');

    const user = await User.findOne({ email: payload.ownerEmail }).select('+passwordHash');
    expect(user).toBeTruthy();
    expect(user!.role).toBe('shop_admin');
    expect(user!.accountStatus).toBe('pending_shop_owner');
    expect(user!.passwordHash).toBeTruthy();
    expect(user!.passwordHash).not.toBe(payload.password);
    expect(await bcrypt.compare(payload.password, user!.passwordHash)).toBe(true);

    const memberships = await ShopMembership.countDocuments({ user: user!._id });
    expect(memberships).toBe(0);

    const appDoc = await ShopApplication.findOne({ publicId: data.id });
    expect(appDoc?.owner?.toString()).toBe(user!._id.toString());
  });

  it('prevents duplicate email registration', async () => {
    const payload = ownerPayload(`dup-${Date.now()}`);
    await register(payload);
    const res = await request(app)
      .post('/api/v1/public/shop-applications/register')
      .send({ ...payload, shopName: 'Another Shop' })
      .expect(409);
    expect(res.body.error.code).toBe('DUPLICATE_EMAIL');
  });

  it('allows pending owner login and status, blocks admin APIs', async () => {
    const payload = ownerPayload(`pend-${Date.now()}`);
    await register(payload);
    const login = await loginToken(payload.ownerEmail, payload.password);
    expect(login.user.onboardingPending).toBe(true);
    expect(login.user.accountStatus).toBe('pending_shop_owner');

    const status = await request(app)
      .get('/api/v1/shop-applications/mine')
      .set('Authorization', `Bearer ${login.token}`)
      .expect(200);
    expect(status.body.data.shopName).toBe(payload.shopName);
    expect(status.body.data.status).toBe('pending_review');

    await request(app)
      .get('/api/v1/shops/mine')
      .set('Authorization', `Bearer ${login.token}`)
      .expect(403);
    await request(app)
      .get('/api/v1/analytics/me')
      .set('Authorization', `Bearer ${login.token}`)
      .expect(403);
    await request(app)
      .get('/api/v1/repairs')
      .set('Authorization', `Bearer ${login.token}`)
      .expect(403);
  });

  it('rejects unauthorized application lookup and isolates /mine', async () => {
    const a = ownerPayload(`iso-a-${Date.now()}`);
    const b = ownerPayload(`iso-b-${Date.now()}`);
    const regA = await register(a);
    await register(b);

    await request(app)
      .get(`/api/v1/public/shop-applications/${regA.id}`)
      .query({ email: 'wrong@example.com' })
      .expect(404);

    const loginB = await loginToken(b.ownerEmail, b.password);
    const mine = await request(app)
      .get('/api/v1/shop-applications/mine')
      .set('Authorization', `Bearer ${loginB.token}`)
      .expect(200);
    expect(mine.body.data.shopName).toBe(b.shopName);
    expect(mine.body.data.id).not.toBe(regA.id);
  });

  it('approves exactly once and grants shop admin access', async () => {
    const payload = ownerPayload(`appr-${Date.now()}`);
    const reg = await register(payload);
    const beforeShops = await RepairShop.countDocuments({ name: payload.shopName });

    const result = await approveShopApplication({
      publicId: reg.id,
      actorLabel: 'test',
      remarks: 'Documents verified'
    });

    expect(result.status).toBe('approved');
    const afterShops = await RepairShop.countDocuments({ name: payload.shopName });
    expect(afterShops - beforeShops).toBe(1);

    const memberships = await ShopMembership.countDocuments({
      user: result.ownerId,
      shop: result.shopId,
      role: 'shop_admin',
      isActive: true
    });
    expect(memberships).toBe(1);

    const user = await User.findById(result.ownerId);
    expect(user!.accountStatus).toBe('active');

    await expect(
      approveShopApplication({ publicId: reg.id, actorLabel: 'test' })
    ).rejects.toMatchObject({ code: 'ALREADY_APPROVED' });

    const login = await loginToken(payload.ownerEmail, payload.password);
    expect(login.user.onboardingPending).toBe(false);

    await request(app)
      .get('/api/v1/shops/mine')
      .set('Authorization', `Bearer ${login.token}`)
      .expect(200);
  });

  it('keeps rejected applicants restricted', async () => {
    const payload = ownerPayload(`rej-${Date.now()}`);
    const reg = await register(payload);

    await rejectShopApplication({
      publicId: reg.id,
      reason: 'Incomplete business details',
      actorLabel: 'test'
    });

    const login = await loginToken(payload.ownerEmail, payload.password);
    const status = await request(app)
      .get('/api/v1/shop-applications/mine')
      .set('Authorization', `Bearer ${login.token}`)
      .expect(200);
    expect(status.body.data.status).toBe('rejected');
    expect(status.body.data.rejectionReason).toContain('Incomplete');
    await request(app)
      .get('/api/v1/shops/mine')
      .set('Authorization', `Bearer ${login.token}`)
      .expect(403);
  });

  it('requires provisioning key for HTTP approve', async () => {
    await request(app)
      .post('/api/v1/shop-applications/provision/approve')
      .send({ publicId: 'SA-does-not-exist' })
      .expect(401);

    expect(mongoose.connection.readyState).toBe(1);
  });
});
