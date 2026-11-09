/**
 * Atlas concurrent payment + reversal integrity audit.
 * Creates isolated verify-domain records, stresses concurrent posts, cleans up.
 *
 * Usage: npx tsx src/scripts/verifyAtomicPaymentsAtlas.ts
 */
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { connectDb, disconnectDb, getDbMode } from '../config/db.js';
import { env } from '../config/env.js';
import { createApp } from '../app.js';
import { ACCESS_COOKIE, CSRF_COOKIE } from '../utils/cookies.js';
import {
  Notification,
  PaymentRecord,
  RepairMessage,
  RepairRequest,
  RepairShop,
  ShopMembership,
  User
} from '../models/index.js';

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

async function main() {
  if (env.useMemoryDb) throw new Error('Refuse memory mode — Atlas only.');
  await connectDb();
  assert(getDbMode() === 'atlas', 'dbMode atlas');
  const app = createApp();
  const stamp = Date.now();
  const password = 'SecurePass1';
  const passwordHash = await bcrypt.hash(password, 12);
  const results: string[] = [];

  const shop = await RepairShop.create({
    name: `Atomic Atlas ${stamp}`,
    code: `ZX${String(stamp).slice(-6)}`,
    address: '9 Concurrent',
    city: 'Lahore',
    region: 'Punjab',
    phone: '+92-42-333',
    email: `atomic.atlas.${stamp}@repairconnect.verify`,
    isActive: true
  });
  const [customer, admin, mechanic] = await User.create([
    { email: `atomic.ca.${stamp}@repairconnect.verify`, passwordHash, name: 'A Cust', role: 'customer' },
    { email: `atomic.aa.${stamp}@repairconnect.verify`, passwordHash, name: 'A Admin', role: 'shop_admin' },
    { email: `atomic.ma.${stamp}@repairconnect.verify`, passwordHash, name: 'A Mech', role: 'mechanic' }
  ]);
  await ShopMembership.create([
    { user: admin._id, shop: shop._id, role: 'shop_admin', isActive: true },
    { user: mechanic._id, shop: shop._id, role: 'mechanic', isActive: true }
  ]);

  async function login(email: string) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password });
    assert(res.status === 200, `login ${email}`);
    const map = cookieMap(res);
    const csrf = res.body.data.csrfToken || map[CSRF_COOKIE];
    return {
      cookie: [ACCESS_COOKIE, CSRF_COOKIE].filter((n) => map[n]).map((n) => `${n}=${map[n]}`).join('; '),
      csrf: String(csrf)
    };
  }
  const auth = (s: { cookie: string; csrf: string }) => ({
    Cookie: s.cookie,
    'X-CSRF-Token': s.csrf
  });

  let repairId: string | null = null;
  async function cleanup() {
    if (repairId) {
      await RepairMessage.deleteMany({ repairRequest: repairId });
      await PaymentRecord.deleteMany({ repairRequest: repairId });
      await Notification.deleteMany({ repairRequest: repairId });
      await RepairRequest.deleteMany({ _id: repairId });
    }
    await ShopMembership.deleteMany({ shop: shop._id });
    await RepairShop.deleteMany({ _id: shop._id });
    await User.deleteMany({
      email: { $in: [customer.email, admin.email, mechanic.email] }
    });
  }

  try {
    const aCust = await login(customer.email);
    const aAdmin = await login(admin.email);
    const aMech = await login(mechanic.email);

    const created = await request(app)
      .post('/api/v1/repairs')
      .set(auth(aCust))
      .send({
        shopId: String(shop._id),
        deviceType: 'Tablet',
        brand: 'Samsung',
        model: 'Tab',
        problemDescription: `Atlas concurrent financial audit ${stamp}`
      });
    assert(created.status === 201, `create ${created.status}`);
    repairId = created.body.data._id;

    await request(app)
      .post(`/api/v1/repairs/${repairId}/assign`)
      .set(auth(aAdmin))
      .send({ mechanicId: String(mechanic._id) })
      .expect(200);
    await request(app)
      .post(`/api/v1/repairs/${repairId}/diagnosis`)
      .set(auth(aMech))
      .send({ findings: 'Digitizer fault', recommendedActions: 'Replace digitizer' })
      .expect(201);
    const est = await request(app)
      .post(`/api/v1/repairs/${repairId}/estimates`)
      .set(auth(aMech))
      .send({ laborCost: 1000, partsCost: 4000 })
      .expect(201);
    await request(app)
      .post(`/api/v1/repairs/estimates/${est.body.data._id}/decision`)
      .set(auth(aCust))
      .send({ decision: 'approved' })
      .expect(200);
    await request(app)
      .post(`/api/v1/repairs/${repairId}/parts-not-required`)
      .set(auth(aMech))
      .send({ notes: 'in stock' })
      .expect(200);
    await request(app).post(`/api/v1/repairs/${repairId}/start`).set(auth(aMech)).expect(200);
    await request(app)
      .post(`/api/v1/repairs/${repairId}/complete`)
      .set(auth(aMech))
      .send({ workPerformed: 'Digitizer replaced and calibrated fully', finalCost: 5000 })
      .expect(200);

    // Concurrent overpay: 3000 + 3000 against 5000
    const [c1, c2] = await Promise.all([
      request(app)
        .post('/api/v1/documents/payments')
        .set(auth(aAdmin))
        .send({
          repairId,
          amount: 3000,
          method: 'cash',
          confirmedReceived: true,
          idempotencyKey: `atlas-c1-${stamp}`
        }),
      request(app)
        .post('/api/v1/documents/payments')
        .set(auth(aAdmin))
        .send({
          repairId,
          amount: 3000,
          method: 'jazzcash',
          reference: `JC-${stamp}`,
          confirmedReceived: true,
          idempotencyKey: `atlas-c2-${stamp}`
        })
    ]);
    const statuses = [c1.status, c2.status].sort();
    assert(statuses[0] === 201 && statuses[1] === 409, `overpay race got ${statuses}`);
    const conflict = c1.status === 409 ? c1 : c2;
    assert(
      ['EXCEEDS_BALANCE', 'BALANCE_CHANGED'].includes(conflict.body.error.code),
      `conflict code ${conflict.body.error?.code}`
    );
    let summary = await request(app)
      .get(`/api/v1/repairs/${repairId}/payments`)
      .set(auth(aAdmin))
      .expect(200);
    assert(summary.body.data.amountPaid === 3000, `paid after race ${summary.body.data.amountPaid}`);
    assert(summary.body.data.outstanding === 2000, `due after race ${summary.body.data.outstanding}`);
    assert(
      (await PaymentRecord.countDocuments({ repairRequest: repairId, entryType: 'payment' })) === 1,
      'exactly one payment committed'
    );
    results.push('PASS concurrent overpay prevented on Atlas');

    // Valid concurrent remainders that fit: already 3000 paid, due 2000 — pay 1000+1000
    const [p1, p2] = await Promise.all([
      request(app)
        .post('/api/v1/documents/payments')
        .set(auth(aAdmin))
        .send({
          repairId,
          amount: 1000,
          method: 'cash',
          confirmedReceived: true,
          idempotencyKey: `atlas-ok1-${stamp}`
        }),
      request(app)
        .post('/api/v1/documents/payments')
        .set(auth(aAdmin))
        .send({
          repairId,
          amount: 1000,
          method: 'easypaisa',
          reference: `EP-${stamp}`,
          confirmedReceived: true,
          idempotencyKey: `atlas-ok2-${stamp}`
        })
    ]);
    assert(p1.status === 201 && p2.status === 201, `valid concurrent ${p1.status}/${p2.status}`);
    summary = await request(app)
      .get(`/api/v1/repairs/${repairId}/payments`)
      .set(auth(aAdmin))
      .expect(200);
    assert(summary.body.data.amountPaid === 5000, 'fully paid after valid concurrent');
    assert(summary.body.data.outstanding === 0, 'zero outstanding');
    results.push('PASS valid concurrent partials on Atlas');

    // Idempotency race
    await request(app)
      .post(`/api/v1/repairs/${repairId}/reopen`)
      .set(auth(aAdmin))
      .send({ reason: 'Need reopen for additional financial stress cases' });
    // reopen may fail if still ready_for_collection — case not closed. Skip reopen.
    // Reverse one payment partially then stress reverse remaining.
    const paymentRows = summary.body.data.payments.filter((p: any) => p.entryType === 'payment');
    const target = paymentRows.find((p: any) => p.amount === 3000) || paymentRows[0];
    assert(target, 'target payment');

    const rev1 = await request(app)
      .post(`/api/v1/documents/payments/${target.id}/reverse`)
      .set(auth(aAdmin))
      .send({ amount: 1000, reason: 'Atlas partial reversal stress', idempotencyKey: `atlas-rev1-${stamp}` });
    assert(rev1.status === 201, `partial reverse ${rev1.status}`);
    summary = await request(app)
      .get(`/api/v1/repairs/${repairId}/payments`)
      .set(auth(aAdmin))
      .expect(200);
    assert(summary.body.data.amountPaid === 4000, `after partial rev paid=${summary.body.data.amountPaid}`);
    results.push('PASS partial reversal updates balance');

    const dupRev = await Promise.all([
      request(app)
        .post(`/api/v1/documents/payments/${target.id}/reverse`)
        .set(auth(aAdmin))
        .send({
          amount: 500,
          reason: 'Duplicate key race A',
          idempotencyKey: `atlas-rev-dup-${stamp}`
        }),
      request(app)
        .post(`/api/v1/documents/payments/${target.id}/reverse`)
        .set(auth(aAdmin))
        .send({
          amount: 500,
          reason: 'Duplicate key race B',
          idempotencyKey: `atlas-rev-dup-${stamp}`
        })
    ]);
    assert(dupRev.every((r) => r.status === 201), 'dup reverse returns 201');
    assert(
      new Set(dupRev.map((r) => String(r.body.data._id))).size === 1,
      'dup reverse one ledger id'
    );
    results.push('PASS reversal idempotency under concurrency');

    // Cross-shop forbidden
    const shopB = await RepairShop.create({
      name: `Atomic B ${stamp}`,
      code: `ZY${String(stamp).slice(-6)}`,
      address: '10 X',
      city: 'Karachi',
      region: 'Sindh',
      phone: '+92-21-1',
      email: `atomic.b.${stamp}@repairconnect.verify`,
      isActive: true
    });
    const adminB = await User.create({
      email: `atomic.ab.${stamp}@repairconnect.verify`,
      passwordHash,
      name: 'Admin B',
      role: 'shop_admin'
    });
    await ShopMembership.create({
      user: adminB._id,
      shop: shopB._id,
      role: 'shop_admin',
      isActive: true
    });
    const bAdmin = await login(adminB.email);
    const cross = await request(app)
      .post(`/api/v1/documents/payments/${target.id}/reverse`)
      .set(auth(bAdmin))
      .send({ reason: 'Cross shop must fail clearly' });
    assert(cross.status === 403, `cross-shop reverse ${cross.status}`);
    results.push('PASS cross-shop reversal forbidden');

    await PaymentRecord.deleteMany({ shop: shopB._id });
    await ShopMembership.deleteMany({ shop: shopB._id });
    await RepairShop.deleteMany({ _id: shopB._id });
    await User.deleteMany({ _id: adminB._id });

    await cleanup();
    repairId = null;
    results.push('PASS cleaned isolated Atlas records');

    console.log(JSON.stringify({ ok: true, dbMode: getDbMode(), results }, null, 2));
  } catch (err) {
    try {
      await cleanup();
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    await disconnectDb();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
