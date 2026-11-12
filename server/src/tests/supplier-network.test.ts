import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app.js';
import {
  AuditLog,
  RepairShop,
  ShopMembership,
  SupplierApplication,
  SupplierBusiness,
  User
} from '../models/index.js';

const app = createApp();

function supplierPayload(suffix: string) {
  const email = `supplier.${suffix}@example.com`;
  return {
    contactPerson: 'Supplier Owner',
    email,
    phone: '+92-300-2220001',
    password: 'SecurePass1',
    confirmPassword: 'SecurePass1',
    businessName: `Parts Hub ${suffix}`,
    address: '10 Supply Street',
    city: 'Lahore',
    region: 'Punjab',
    description: 'Wholesale screens, batteries and charging parts for repair shops.',
    partCategories: ['screens_displays', 'batteries'] as const,
    supportedBrands: ['Samsung', 'Apple'],
    deliveryCities: ['Lahore', 'Islamabad'],
    termsAccepted: true as const
  };
}

async function registerSupplier(payload: ReturnType<typeof supplierPayload>) {
  const res = await request(app).post('/api/v1/public/supplier-applications/register').send(payload);
  expect(res.status).toBe(201);
  return res.body.data as { id: string; status: string; businessName: string };
}

async function loginToken(email: string, password: string) {
  const login = await request(app).post('/api/v1/auth/login').send({ email, password });
  expect(login.status).toBe(200);
  expect(login.body.data.token).toBeTruthy();
  return login.body.data as {
    token: string;
    user: { id: string; role: string; accountStatus?: string; onboardingPending?: boolean };
  };
}

async function createPlatformOperator(suffix: string) {
  const email = `ops.sup.${suffix}@repairconnect.platform`;
  const password = 'OperatorPass1';
  const passwordHash = await bcrypt.hash(password, 12);
  await User.create({
    email,
    passwordHash,
    name: `Operator ${suffix}`,
    role: 'platform_operator',
    accountStatus: 'active',
    isActive: true
  });
  return { email, password, login: await loginToken(email, password) };
}

async function createShopAdmin(suffix: string, city = 'Lahore') {
  const email = `admin.sup.${suffix}@example.com`;
  const password = 'SecurePass1';
  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await User.create({
    email,
    passwordHash,
    name: `Admin ${suffix}`,
    role: 'shop_admin',
    accountStatus: 'active',
    isActive: true
  });
  const shop = await RepairShop.create({
    name: `Shop ${suffix}`,
    code: `S${suffix.slice(-8)}`.toUpperCase().slice(0, 12),
    address: '1 Shop Rd',
    city,
    region: 'Punjab',
    phone: '+92-42-100',
    email,
    isActive: true
  });
  await ShopMembership.create({
    user: admin._id,
    shop: shop._id,
    role: 'shop_admin',
    isActive: true
  });
  return { email, password, shop, login: await loginToken(email, password) };
}

describe('Supplier network Phase 1', () => {
  it('registers supplier with pending_supplier and blocks operational APIs', async () => {
    const suffix = `reg-${Date.now()}`;
    const payload = supplierPayload(suffix);
    const reg = await registerSupplier(payload);
    expect(reg.status).toBe('pending_review');

    const owner = await User.findOne({ email: payload.email });
    expect(owner?.role).toBe('supplier');
    expect(owner?.accountStatus).toBe('pending_supplier');

    const login = await loginToken(payload.email, payload.password);
    expect(login.user.onboardingPending).toBe(true);
    expect(login.user.role).toBe('supplier');

    const blocked = await request(app)
      .get('/api/v1/supplier/me')
      .set('Authorization', `Bearer ${login.token}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('ONBOARDING_PENDING');

    const mine = await request(app)
      .get('/api/v1/supplier-applications/mine')
      .set('Authorization', `Bearer ${login.token}`);
    expect(mine.status).toBe(200);
    expect(mine.body.data.id).toBe(reg.id);
  });

  it('prevents duplicate email and duplicate business registrations', async () => {
    const suffix = `dup-${Date.now()}`;
    const payload = supplierPayload(suffix);
    await registerSupplier(payload);

    const again = await request(app)
      .post('/api/v1/public/supplier-applications/register')
      .send(payload);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('DUPLICATE_EMAIL');

    const otherEmail = { ...payload, email: `other.${suffix}@example.com` };
    const nameDup = await request(app)
      .post('/api/v1/public/supplier-applications/register')
      .send(otherEmail);
    expect(nameDup.status).toBe(409);
    expect(nameDup.body.error.code).toBe('DUPLICATE_APPLICATION');
  });

  it('allows platform operator to approve, marketplace visibility, suspend and reactivate', async () => {
    const suffix = `flow-${Date.now()}`;
    const payload = supplierPayload(suffix);
    const reg = await registerSupplier(payload);
    const ops = await createPlatformOperator(suffix);
    const admin = await createShopAdmin(suffix, 'Lahore');

    const denied = await request(app)
      .get('/api/v1/platform/supplier-applications')
      .set('Authorization', `Bearer ${admin.login.token}`);
    expect(denied.status).toBe(403);

    const list = await request(app)
      .get('/api/v1/platform/supplier-applications?status=pending')
      .set('Authorization', `Bearer ${ops.login.token}`);
    expect(list.status).toBe(200);
    expect(list.body.data.items.some((i: { id: string }) => i.id === reg.id)).toBe(true);

    const approve = await request(app)
      .post(`/api/v1/platform/supplier-applications/${reg.id}/approve`)
      .set('Authorization', `Bearer ${ops.login.token}`)
      .send({ remarks: 'Verified documents' });
    expect(approve.status).toBe(200);
    expect(approve.body.data.status).toBe('approved');

    const owner = await User.findOne({ email: payload.email });
    expect(owner?.accountStatus).toBe('active');
    const business = await SupplierBusiness.findOne({ owner: owner!._id });
    expect(business?.isActive).toBe(true);
    expect(business?.status).toBe('approved');

    const audit = await AuditLog.find({
      action: 'supplier_application.approve',
      entityType: 'SupplierApplication'
    });
    expect(audit.length).toBeGreaterThan(0);

    const market = await request(app)
      .get('/api/v1/marketplace/suppliers?city=Lahore')
      .set('Authorization', `Bearer ${admin.login.token}`);
    expect(market.status).toBe(200);
    expect(market.body.data.items.some((i: { businessName: string }) => i.businessName === payload.businessName)).toBe(
      true
    );

    const supplierLogin = await loginToken(payload.email, payload.password);
    expect(supplierLogin.user.onboardingPending).toBe(false);
    const me = await request(app)
      .get('/api/v1/supplier/me')
      .set('Authorization', `Bearer ${supplierLogin.token}`);
    expect(me.status).toBe(200);
    expect(me.body.data.businessName).toBe(payload.businessName);

    const catalog = await request(app)
      .post('/api/v1/supplier/catalog')
      .set('Authorization', `Bearer ${supplierLogin.token}`)
      .send({
        name: 'OLED Screen',
        category: 'screens_displays',
        brand: 'Samsung',
        unitPrice: 12000,
        inStock: true
      });
    expect(catalog.status).toBe(201);

    const profile = await request(app)
      .get(`/api/v1/marketplace/suppliers/${business!.publicId}`)
      .set('Authorization', `Bearer ${admin.login.token}`);
    expect(profile.status).toBe(200);
    expect(profile.body.data.catalog.length).toBe(1);
    expect(profile.body.data.genuineRating).toBeNull();

    const suspend = await request(app)
      .post(`/api/v1/platform/supplier-applications/${reg.id}/suspend`)
      .set('Authorization', `Bearer ${ops.login.token}`)
      .send({ reason: 'Policy violation found' });
    expect(suspend.status).toBe(200);

    const hidden = await request(app)
      .get('/api/v1/marketplace/suppliers?city=Lahore')
      .set('Authorization', `Bearer ${admin.login.token}`);
    expect(hidden.status).toBe(200);
    expect(
      hidden.body.data.items.some((i: { businessName: string }) => i.businessName === payload.businessName)
    ).toBe(false);

    const reactivate = await request(app)
      .post(`/api/v1/platform/supplier-applications/${reg.id}/reactivate`)
      .set('Authorization', `Bearer ${ops.login.token}`)
      .send({ remarks: 'Cleared' });
    expect(reactivate.status).toBe(200);

    const visibleAgain = await request(app)
      .get('/api/v1/marketplace/suppliers?city=Lahore&q=Parts')
      .set('Authorization', `Bearer ${admin.login.token}`);
    expect(visibleAgain.status).toBe(200);
    expect(
      visibleAgain.body.data.items.some((i: { businessName: string }) => i.businessName === payload.businessName)
    ).toBe(true);

    const rejectedReg = await registerSupplier({
      ...supplierPayload(`rej-${Date.now()}`),
      deliveryCities: ['Karachi']
    });
    await request(app)
      .post(`/api/v1/platform/supplier-applications/${rejectedReg.id}/reject`)
      .set('Authorization', `Bearer ${ops.login.token}`)
      .send({ reason: 'Incomplete paperwork' });
    const rejectedApp = await SupplierApplication.findOne({ publicId: rejectedReg.id });
    expect(rejectedApp?.status).toBe('rejected');
    const rejectedMarket = await request(app)
      .get('/api/v1/marketplace/suppliers?city=Karachi')
      .set('Authorization', `Bearer ${admin.login.token}`);
    expect(
      rejectedMarket.body.data.items.some((i: { publicId?: string }) => i.publicId === rejectedReg.id)
    ).toBe(false);
  });

  it('does not grant platform_operator via supplier registration', async () => {
    const suffix = `priv-${Date.now()}`;
    const payload = {
      ...supplierPayload(suffix),
      role: 'platform_operator'
    };
    const res = await request(app).post('/api/v1/public/supplier-applications/register').send(payload);
    // zod strips/rejects undefined-only role field; unknown role key with value may fail validation
    expect([201, 400]).toContain(res.status);
    if (res.status === 201) {
      const user = await User.findOne({ email: payload.email });
      expect(user?.role).toBe('supplier');
    }
  });
});
