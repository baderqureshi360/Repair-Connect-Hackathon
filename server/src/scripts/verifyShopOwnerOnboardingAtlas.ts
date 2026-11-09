/**
 * Atlas end-to-end verification for shop-owner onboarding.
 * Requires MONGODB_URI + USE_MEMORY_DB=false. Uses PROVISIONING_API_KEY for approve/reject.
 *
 * Usage: npx tsx src/scripts/verifyShopOwnerOnboardingAtlas.ts
 */
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { connectDb, disconnectDb, getDbMode } from '../config/db.js';
import {
  RepairShop,
  ShopApplication,
  ShopMembership,
  User
} from '../models/index.js';
import {
  approveShopApplication,
  registerShopOwnerApplication,
  rejectShopApplication
} from '../services/shopApplications.js';
import { createApp } from '../app.js';
import { ACCESS_COOKIE, CSRF_COOKIE } from '../utils/cookies.js';
import request from 'supertest';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function cookieMap(res: request.Response): Record<string, string> {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const map: Record<string, string> = {};
  for (const line of list) {
    const [pair] = line.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) map[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return map;
}

function cookieHeader(map: Record<string, string>, names: string[]) {
  return names.filter((n) => map[n]).map((n) => `${n}=${map[n]}`).join('; ');
}

function authCookie(login: request.Response): string {
  const map = cookieMap(login);
  assert(map[ACCESS_COOKIE], 'access cookie set on login');
  return cookieHeader(map, [ACCESS_COOKIE, CSRF_COOKIE]);
}

async function main() {
  if (env.useMemoryDb) {
    throw new Error('Refuse memory mode — set USE_MEMORY_DB=false and MONGODB_URI for Atlas verify.');
  }
  if (!env.provisioningApiKey || env.provisioningApiKey.length < 16) {
    throw new Error('PROVISIONING_API_KEY required (min 16 chars).');
  }

  await connectDb();
  assert(getDbMode() === 'atlas', 'DB mode must be atlas');

  const stamp = Date.now();
  const email = `e2e.owner.${stamp}@repairconnect.verify`;
  const password = 'SecurePass1';
  const shopName = `E2E Onboard Shop ${stamp}`;
  const results: string[] = [];

  // 1–2: register + password hash
  const reg = await registerShopOwnerApplication({
    ownerName: 'E2E Owner',
    ownerEmail: email,
    ownerPhone: '+92-300-9000001',
    password,
    shopName,
    businessPhone: '+92-42-9000002',
    businessEmail: email,
    address: '12 Verification Blvd',
    city: 'Lahore',
    region: 'Punjab',
    servicesDescription: 'Acceptance verification shop for phones and laptops.',
    serviceCategories: ['computers_laptops', 'mobile_phones_tablets'],
    supportedDevices: ['Laptop', 'Phone'],
    supportedBrands: ['Dell', 'Apple'],
    termsAccepted: true
  });
  assert(reg.id.startsWith('SA-'), 'publicId issued');
  assert(reg.status === 'pending_review', 'status pending_review');

  const user = await User.findOne({ email }).select('+passwordHash');
  assert(user, 'owner user created');
  assert(user!.role === 'shop_admin', 'role shop_admin');
  assert(user!.accountStatus === 'pending_shop_owner', 'pending accountStatus');
  assert(user!.passwordHash && user!.passwordHash !== password, 'password hashed, not plaintext');
  assert(await bcrypt.compare(password, user!.passwordHash), 'bcrypt verifies password');
  assert((await ShopMembership.countDocuments({ user: user!._id })) === 0, 'no membership yet');
  results.push('PASS register + bcrypt hash + no membership');

  // 3: duplicate email / application
  let dupOk = false;
  try {
    await registerShopOwnerApplication({
      ownerName: 'Dup',
      ownerEmail: email,
      ownerPhone: '+92-300-9000003',
      password,
      shopName: `Dup Shop ${stamp}`,
      businessPhone: '+92-42-9000004',
      businessEmail: email,
      address: '13 Verification Blvd',
      city: 'Lahore',
      region: 'Punjab',
      servicesDescription: 'Duplicate attempt should fail for same email.',
      serviceCategories: ['computers_laptops'],
      termsAccepted: true
    });
  } catch (err: any) {
    dupOk = err?.code === 'DUPLICATE_EMAIL' || /already registered/i.test(String(err?.message));
  }
  assert(dupOk, 'duplicate email rejected');
  results.push('PASS duplicate email prevention');

  // 4–6: pending login via HTTP + block admin APIs
  const app = createApp();
  const login = await request(app).post('/api/v1/auth/login').send({ email, password });
  assert(login.status === 200, 'pending login 200');
  assert(login.body.data.user.onboardingPending === true, 'onboardingPending true');
  const pendingCookie = authCookie(login);

  const status = await request(app)
    .get('/api/v1/shop-applications/mine')
    .set('Cookie', pendingCookie);
  assert(status.status === 200, 'status page API 200');
  assert(status.body.data.id === reg.id, 'status returns own application');

  for (const path of ['/api/v1/shops/mine', '/api/v1/analytics/me', '/api/v1/repairs', '/api/v1/admin']) {
    const blocked = await request(app).get(path).set('Cookie', pendingCookie);
    // /admin may 404 as route; shops/analytics/repairs must be 403 ONBOARDING_PENDING
    if (path !== '/api/v1/admin') {
      assert(blocked.status === 403, `${path} blocked for pending owner`);
      assert(blocked.body.error?.code === 'ONBOARDING_PENDING', `${path} ONBOARDING_PENDING`);
    }
  }
  results.push('PASS pending login + status + admin API block');

  // 7–8: approve once → one shop + membership
  const shopsBefore = await RepairShop.countDocuments({ name: shopName });
  const approved = await approveShopApplication({
    publicId: reg.id,
    actorLabel: 'atlas-verify',
    remarks: 'E2E acceptance approve'
  });
  assert(approved.status === 'approved', 'approved');
  const shopsAfter = await RepairShop.countDocuments({ name: shopName });
  assert(shopsAfter - shopsBefore === 1, 'exactly one shop created');
  const memberships = await ShopMembership.countDocuments({
    user: approved.ownerId,
    shop: approved.shopId,
    role: 'shop_admin',
    isActive: true
  });
  assert(memberships === 1, 'exactly one active shop_admin membership');
  const refreshed = await User.findById(approved.ownerId);
  assert(refreshed!.accountStatus === 'active', 'account activated');
  results.push('PASS approval creates one shop + membership');

  // 11: duplicate approval
  let dupApprove = false;
  try {
    await approveShopApplication({ publicId: reg.id, actorLabel: 'atlas-verify' });
  } catch (err: any) {
    dupApprove = err?.code === 'ALREADY_APPROVED';
  }
  assert(dupApprove, 'duplicate approval prevented');
  results.push('PASS duplicate approval prevention');

  // 9–10: login after approval
  const login2 = await request(app).post('/api/v1/auth/login').send({ email, password });
  assert(login2.status === 200, 'post-approval login');
  assert(login2.body.data.user.onboardingPending === false, 'not pending');
  assert(login2.body.data.user.accountStatus === 'active', 'active status');
  assert((login2.body.data.user.shops || []).length >= 1, 'shop in login payload');
  const activeCookie = authCookie(login2);
  const mine = await request(app).get('/api/v1/shops/mine').set('Cookie', activeCookie);
  assert(mine.status === 200, 'shops/mine allowed after approval');
  assert(
    (mine.body.data || []).some((s: any) => String(s._id) === String(approved.shopId)),
    'authorized shop visible'
  );
  results.push('PASS post-approval login + shop admin access');

  // 12: rejected application handling
  const rejEmail = `e2e.reject.${stamp}@repairconnect.verify`;
  const rej = await registerShopOwnerApplication({
    ownerName: 'Reject Owner',
    ownerEmail: rejEmail,
    ownerPhone: '+92-300-9000011',
    password,
    shopName: `E2E Reject Shop ${stamp}`,
    businessPhone: '+92-42-9000012',
    businessEmail: rejEmail,
    address: '99 Reject Lane',
    city: 'Karachi',
    region: 'Sindh',
    servicesDescription: 'Application that will be rejected for acceptance testing.',
    serviceCategories: ['other_electronics'],
    termsAccepted: true
  });
  await rejectShopApplication({
    publicId: rej.id,
    reason: 'Incomplete documentation for acceptance test',
    actorLabel: 'atlas-verify'
  });
  const rejLogin = await request(app).post('/api/v1/auth/login').send({ email: rejEmail, password });
  assert(rejLogin.status === 200, 'rejected owner can still login');
  const rejCookie = authCookie(rejLogin);
  const rejStatus = await request(app)
    .get('/api/v1/shop-applications/mine')
    .set('Cookie', rejCookie);
  assert(rejStatus.body.data.status === 'rejected', 'rejected status visible');
  assert(String(rejStatus.body.data.rejectionReason || '').includes('Incomplete'), 'rejection reason');
  const rejBlocked = await request(app).get('/api/v1/shops/mine').set('Cookie', rejCookie);
  assert(rejBlocked.status === 403, 'rejected owner still blocked from shop APIs');
  results.push('PASS rejected application remains restricted');

  // 13: existing demo staff/customer regression (if seed accounts exist on Atlas)
  const demoChecks: Array<{ email: string; expectRole: string }> = [
    { email: 'customer@repairconnect.local', expectRole: 'customer' },
    { email: 'admin@repairconnect.local', expectRole: 'shop_admin' },
    { email: 'mechanic@repairconnect.local', expectRole: 'mechanic' }
  ];
  let demoOk = 0;
  let demoSkipped = 0;
  for (const d of demoChecks) {
    const exists = await User.findOne({ email: d.email });
    if (!exists) {
      demoSkipped += 1;
      continue;
    }
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: d.email, password: 'Password123!' });
    assert(res.status === 200, `${d.email} login works`);
    assert(res.body.data.user.role === d.expectRole, `${d.email} role intact`);
    assert(res.body.data.user.onboardingPending !== true, `${d.email} not pending`);
    demoOk += 1;
  }
  results.push(
    demoOk
      ? `PASS existing account regression (${demoOk} demo accounts)`
      : `SKIP existing demo accounts not present on Atlas (${demoSkipped} missing)`
  );

  // 15: cross-shop isolation — approved owner cannot see unrelated shop via mine list scope
  const otherShop = await RepairShop.findOne({ _id: { $ne: approved.shopId }, isActive: true });
  if (otherShop) {
    const ownerShops = mine.body.data.map((s: any) => String(s._id));
    assert(!ownerShops.includes(String(otherShop._id)), 'owner mine list excludes foreign shop');
    results.push('PASS cross-shop isolation on shops/mine');
  } else {
    results.push('SKIP cross-shop isolation (no second active shop on Atlas)');
  }

  // Persist markers for restart check
  const appDoc = await ShopApplication.findOne({ publicId: reg.id });
  assert(appDoc?.status === 'approved' && appDoc.provisionedShop, 'application linked to shop in Atlas');

  console.log(JSON.stringify({
    ok: true,
    dbMode: getDbMode(),
    publicId: reg.id,
    shopId: String(approved.shopId),
    shopCode: approved.shopCode,
    ownerEmail: email,
    results
  }, null, 2));

  await disconnectDb();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await disconnectDb();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
