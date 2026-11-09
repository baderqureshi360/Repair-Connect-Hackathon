import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app.js';
import { AuditLog, RepairShop, ShopApplication, ShopMembership, User } from '../models/index.js';

const app = createApp();

function ownerPayload(suffix: string) {
  const email = `plat.owner.${suffix}@example.com`;
  return {
    ownerName: 'Platform Applicant',
    ownerEmail: email,
    ownerPhone: '+92-300-1110001',
    password: 'SecurePass1',
    confirmPassword: 'SecurePass1',
    shopName: `Platform Review Shop ${suffix}`,
    businessPhone: '+92-42-1110002',
    businessEmail: email,
    address: '22 Operator Avenue',
    city: 'Islamabad',
    region: 'ICT',
    servicesDescription: 'Platform review shop covering phones and computers.',
    serviceCategories: ['mobile_phones_tablets', 'computers_laptops'] as const,
    supportedDevices: ['Phone', 'Laptop'],
    supportedBrands: ['Samsung', 'Dell'],
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
  return login.body.data as { token: string; user: { id: string; role: string } };
}

async function createPlatformOperator(suffix: string) {
  const email = `ops.${suffix}@repairconnect.platform`;
  const password = 'OperatorPass1';
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({
    email,
    passwordHash,
    name: `Operator ${suffix}`,
    role: 'platform_operator',
    accountStatus: 'active',
    isActive: true
  });
  return { email, password, user, login: await loginToken(email, password) };
}

describe('Platform shop application management', () => {
  it('denies list/detail/approve/reject to customers, shop admins, and pending owners', async () => {
    const suffix = `deny-${Date.now()}`;
    const payload = ownerPayload(suffix);
    const reg = await register(payload);
    const pending = await loginToken(payload.ownerEmail, payload.password);

    const customerHash = await bcrypt.hash('SecurePass1', 12);
    await User.create({
      email: `cust.${suffix}@example.com`,
      passwordHash: customerHash,
      name: 'Customer',
      role: 'customer',
      accountStatus: 'active'
    });
    const customer = await loginToken(`cust.${suffix}@example.com`, 'SecurePass1');

    const adminHash = await bcrypt.hash('SecurePass1', 12);
    const admin = await User.create({
      email: `admin.${suffix}@example.com`,
      passwordHash: adminHash,
      name: 'Shop Admin',
      role: 'shop_admin',
      accountStatus: 'active'
    });
    const shop = await RepairShop.create({
      name: `Existing ${suffix}`,
      code: `EX${suffix.slice(-6)}`.toUpperCase().slice(0, 12),
      address: '1 A',
      city: 'Lahore',
      region: 'Punjab',
      phone: '+92-42-1',
      email: admin.email,
      isActive: true
    });
    await ShopMembership.create({
      user: admin._id,
      shop: shop._id,
      role: 'shop_admin',
      isActive: true
    });
    const adminLogin = await loginToken(admin.email, 'SecurePass1');

    for (const token of [pending.token, customer.token, adminLogin.token]) {
      await request(app)
        .get('/api/v1/platform/shop-applications')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      await request(app)
        .get(`/api/v1/platform/shop-applications/${reg.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      await request(app)
        .post(`/api/v1/platform/shop-applications/${reg.id}/approve`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(403);
      await request(app)
        .post(`/api/v1/platform/shop-applications/${reg.id}/reject`)
        .set('Authorization', `Bearer ${token}`)
        .send({ reason: 'Not authorized path' })
        .expect(403);
    }
  });

  it('lists pending applications and returns required fields for operators', async () => {
    const suffix = `list-${Date.now()}`;
    const payload = ownerPayload(suffix);
    const reg = await register(payload);
    const ops = await createPlatformOperator(suffix);

    const list = await request(app)
      .get('/api/v1/platform/shop-applications?status=pending_review')
      .set('Authorization', `Bearer ${ops.login.token}`)
      .expect(200);

    const item = (list.body.data.items as Array<Record<string, unknown>>).find(
      (row) => row.id === reg.id
    );
    expect(item).toBeTruthy();
    expect(item).toMatchObject({
      id: reg.id,
      ownerName: payload.ownerName,
      businessEmail: payload.businessEmail,
      shopName: payload.shopName,
      city: payload.city,
      region: payload.region,
      status: 'pending_review'
    });
    expect(item!.serviceCategories).toEqual(
      expect.arrayContaining(['mobile_phones_tablets', 'computers_laptops'])
    );
    expect(item!.submittedAt).toBeTruthy();
  });

  it('approves via operator session: one shop, one membership, audit, reviewer recorded', async () => {
    const suffix = `appr-${Date.now()}`;
    const payload = ownerPayload(suffix);
    const reg = await register(payload);
    const ops = await createPlatformOperator(suffix);

    const detail = await request(app)
      .get(`/api/v1/platform/shop-applications/${reg.id}`)
      .set('Authorization', `Bearer ${ops.login.token}`)
      .expect(200);
    expect(detail.body.data.id).toBe(reg.id);
    expect(detail.body.data.ownerName).toBe(payload.ownerName);

    const approved = await request(app)
      .post(`/api/v1/platform/shop-applications/${reg.id}/approve`)
      .set('Authorization', `Bearer ${ops.login.token}`)
      .send({ remarks: 'Verified business docs' })
      .expect(200);

    expect(approved.body.data.status).toBe('approved');
    expect(approved.body.data.shopId).toBeTruthy();

    const owner = await User.findOne({ email: payload.ownerEmail }).select('+passwordHash');
    expect(owner!.accountStatus).toBe('active');
    expect(await bcrypt.compare(payload.password, owner!.passwordHash)).toBe(true);

    const memberships = await ShopMembership.find({ user: owner!._id, isActive: true });
    expect(memberships).toHaveLength(1);
    expect(memberships[0].role).toBe('shop_admin');
    expect(String(memberships[0].shop)).toBe(String(approved.body.data.shopId));

    const shops = await RepairShop.countDocuments({ _id: approved.body.data.shopId });
    expect(shops).toBe(1);

    const appDoc = await ShopApplication.findOne({ publicId: reg.id });
    expect(appDoc!.status).toBe('approved');
    expect(String(appDoc!.reviewedBy)).toBe(String(ops.user._id));
    expect(appDoc!.reviewedAt).toBeTruthy();
    expect(appDoc!.approvedAt).toBeTruthy();

    const audit = await AuditLog.findOne({
      action: 'shop_application.approve',
      entityId: appDoc!._id
    }).sort({ createdAt: -1 });
    expect(audit).toBeTruthy();
    expect(String(audit!.actor)).toBe(String(ops.user._id));
  });

  it('rejects with required reason and keeps owner blocked from shop APIs', async () => {
    const suffix = `rej-${Date.now()}`;
    const payload = ownerPayload(suffix);
    const reg = await register(payload);
    const ops = await createPlatformOperator(suffix);

    await request(app)
      .post(`/api/v1/platform/shop-applications/${reg.id}/reject`)
      .set('Authorization', `Bearer ${ops.login.token}`)
      .send({ reason: 'ab' })
      .expect(400);

    await request(app)
      .post(`/api/v1/platform/shop-applications/${reg.id}/reject`)
      .set('Authorization', `Bearer ${ops.login.token}`)
      .send({ reason: 'Incomplete documentation for platform review' })
      .expect(200);

    const ownerLogin = await loginToken(payload.ownerEmail, payload.password);
    const status = await request(app)
      .get('/api/v1/shop-applications/mine')
      .set('Authorization', `Bearer ${ownerLogin.token}`)
      .expect(200);
    expect(status.body.data.status).toBe('rejected');
    expect(String(status.body.data.rejectionReason)).toMatch(/Incomplete/);

    await request(app)
      .get('/api/v1/shops/mine')
      .set('Authorization', `Bearer ${ownerLogin.token}`)
      .expect(403);

    const filtered = await request(app)
      .get('/api/v1/platform/shop-applications?status=rejected')
      .set('Authorization', `Bearer ${ops.login.token}`)
      .expect(200);
    expect(
      (filtered.body.data.items as Array<{ id: string }>).some((i) => i.id === reg.id)
    ).toBe(true);
  });

  it('prevents duplicate approval and duplicate shop creation', async () => {
    const suffix = `dup-${Date.now()}`;
    const payload = ownerPayload(suffix);
    const reg = await register(payload);
    const ops = await createPlatformOperator(suffix);

    await request(app)
      .post(`/api/v1/platform/shop-applications/${reg.id}/approve`)
      .set('Authorization', `Bearer ${ops.login.token}`)
      .send({})
      .expect(200);

    const shopsBefore = await RepairShop.countDocuments({ name: payload.shopName });
    const again = await request(app)
      .post(`/api/v1/platform/shop-applications/${reg.id}/approve`)
      .set('Authorization', `Bearer ${ops.login.token}`)
      .send({})
      .expect(409);
    expect(again.body.error.code).toBe('ALREADY_APPROVED');
    const shopsAfter = await RepairShop.countDocuments({ name: payload.shopName });
    expect(shopsAfter).toBe(shopsBefore);
  });

  it('prevents applicants from approving their own applications even with elevated setup', async () => {
    const suffix = `self-${Date.now()}`;
    const payload = ownerPayload(suffix);
    const reg = await register(payload);
    const owner = await User.findOne({ email: payload.ownerEmail });
    // Force-elevate only for abuse-case proof; production bootstrap never does this.
    owner!.role = 'platform_operator' as never;
    owner!.accountStatus = 'active';
    await owner!.save();

    const login = await loginToken(payload.ownerEmail, payload.password);
    const res = await request(app)
      .post(`/api/v1/platform/shop-applications/${reg.id}/approve`)
      .set('Authorization', `Bearer ${login.token}`)
      .send({})
      .expect(403);
    expect(res.body.error.code).toBe('SELF_APPROVAL_FORBIDDEN');

    expect(await ShopMembership.countDocuments({ user: owner!._id })).toBe(0);
    expect(await RepairShop.countDocuments({ name: payload.shopName })).toBe(0);
  });

  it('keeps approved shop isolated from another shop admin', async () => {
    const suffix = `iso-${Date.now()}`;
    const payload = ownerPayload(suffix);
    const reg = await register(payload);
    const ops = await createPlatformOperator(suffix);

    const approved = await request(app)
      .post(`/api/v1/platform/shop-applications/${reg.id}/approve`)
      .set('Authorization', `Bearer ${ops.login.token}`)
      .send({})
      .expect(200);

    const otherHash = await bcrypt.hash('SecurePass1', 12);
    const other = await User.create({
      email: `other.${suffix}@example.com`,
      passwordHash: otherHash,
      name: 'Other Admin',
      role: 'shop_admin',
      accountStatus: 'active'
    });
    const otherShop = await RepairShop.create({
      name: `Other Shop ${suffix}`,
      code: `OT${suffix.slice(-6)}`.toUpperCase().slice(0, 12),
      address: '9 B',
      city: 'Karachi',
      region: 'Sindh',
      phone: '+92-21-1',
      email: other.email,
      isActive: true
    });
    await ShopMembership.create({
      user: other._id,
      shop: otherShop._id,
      role: 'shop_admin',
      isActive: true
    });

    const otherLogin = await loginToken(other.email, 'SecurePass1');
    const mine = await request(app)
      .get('/api/v1/shops/mine')
      .set('Authorization', `Bearer ${otherLogin.token}`)
      .expect(200);
    const ids = (mine.body.data as Array<{ _id: string }>).map((s) => String(s._id));
    expect(ids).toContain(String(otherShop._id));
    expect(ids).not.toContain(String(approved.body.data.shopId));

    // Persistence: application remains approved after re-read
    const persisted = await ShopApplication.findOne({ publicId: reg.id });
    expect(persisted!.status).toBe('approved');
    expect(String(persisted!.provisionedShop)).toBe(String(approved.body.data.shopId));
  });

  it('does not expose platform routes to unauthenticated callers', async () => {
    await request(app).get('/api/v1/platform/shop-applications').expect(401);
  });
});
