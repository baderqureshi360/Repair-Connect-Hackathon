/**
 * Atlas audit for communication / payments / closure.
 * Creates isolated records, verifies negatives + financials + persistence after reconnect,
 * then cleans audit artifacts (only stamp-tagged @repairconnect.verify emails).
 *
 * Usage: npx tsx src/scripts/verifyLifecycleAtlasAudit.ts
 */
import bcrypt from 'bcryptjs';
import { connectDb, disconnectDb, getDbMode } from '../config/db.js';
import { env } from '../config/env.js';
import {
  AuditLog,
  Notification,
  PaymentRecord,
  RepairMessage,
  RepairRequest,
  RepairShop,
  ShopMembership,
  User
} from '../models/index.js';
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

function cookieHeader(map: Record<string, string>) {
  return [ACCESS_COOKIE, CSRF_COOKIE]
    .filter((n) => map[n])
    .map((n) => `${n}=${map[n]}`)
    .join('; ');
}

type Session = { cookie: string; csrf: string; user: { id?: string; email?: string } };

async function main() {
  if (env.useMemoryDb) throw new Error('Refuse memory mode — Atlas only.');
  await connectDb();
  assert(getDbMode() === 'atlas', 'dbMode atlas');
  const app = createApp();
  const stamp = Date.now();
  const results: string[] = [];
  const password = 'SecurePass1';
  const passwordHash = await bcrypt.hash(password, 12);

  // Best-effort cleanup of prior interrupted audit runs (verify domain only).
  const staleUsers = await User.find({ email: /@repairconnect\.verify$/i }).select('_id');
  const staleIds = staleUsers.map((u) => u._id);
  if (staleIds.length) {
    const staleShops = await RepairShop.find({ email: /@repairconnect\.verify$/i }).select('_id');
    const staleShopIds = staleShops.map((s) => s._id);
    await RepairMessage.deleteMany({ shop: { $in: staleShopIds } });
    await PaymentRecord.deleteMany({ shop: { $in: staleShopIds } });
    await Notification.deleteMany({ user: { $in: staleIds } });
    await RepairRequest.deleteMany({ shop: { $in: staleShopIds } });
    await ShopMembership.deleteMany({
      $or: [{ user: { $in: staleIds } }, { shop: { $in: staleShopIds } }]
    });
    await RepairShop.deleteMany({ _id: { $in: staleShopIds } });
    await User.deleteMany({ _id: { $in: staleIds } });
  }

  const shopA = await RepairShop.create({
    name: `Audit Shop A ${stamp}`,
    code: `AA${String(stamp).slice(-6)}`,
    address: '1 Audit',
    city: 'Lahore',
    region: 'Punjab',
    phone: '+92-42-100',
    email: `audit.a.${stamp}@repairconnect.verify`,
    isActive: true
  });
  const shopB = await RepairShop.create({
    name: `Audit Shop B ${stamp}`,
    code: `BB${String(stamp).slice(-6)}`,
    address: '2 Audit',
    city: 'Karachi',
    region: 'Sindh',
    phone: '+92-21-100',
    email: `audit.b.${stamp}@repairconnect.verify`,
    isActive: true
  });

  const [custA, custB, adminA, adminB, mechA] = await User.create([
    { email: `audit.ca.${stamp}@repairconnect.verify`, passwordHash, name: 'Cust A', role: 'customer' },
    { email: `audit.cb.${stamp}@repairconnect.verify`, passwordHash, name: 'Cust B', role: 'customer' },
    { email: `audit.aa.${stamp}@repairconnect.verify`, passwordHash, name: 'Admin A', role: 'shop_admin' },
    { email: `audit.ab.${stamp}@repairconnect.verify`, passwordHash, name: 'Admin B', role: 'shop_admin' },
    { email: `audit.ma.${stamp}@repairconnect.verify`, passwordHash, name: 'Mech A', role: 'mechanic' }
  ]);
  await ShopMembership.create([
    { user: adminA._id, shop: shopA._id, role: 'shop_admin', isActive: true },
    { user: mechA._id, shop: shopA._id, role: 'mechanic', isActive: true },
    { user: adminB._id, shop: shopB._id, role: 'shop_admin', isActive: true }
  ]);

  const emails = [custA.email, custB.email, adminA.email, adminB.email, mechA.email];
  let repairId: string | null = null;

  async function cleanup() {
    if (repairId) {
      await RepairMessage.deleteMany({ repairRequest: repairId });
      await PaymentRecord.deleteMany({ repairRequest: repairId });
      await Notification.deleteMany({ repairRequest: repairId });
      await RepairRequest.deleteMany({ _id: repairId });
    }
    await RepairMessage.deleteMany({ shop: { $in: [shopA._id, shopB._id] } });
    await PaymentRecord.deleteMany({ shop: { $in: [shopA._id, shopB._id] } });
    await Notification.deleteMany({ user: { $in: [custA._id, custB._id, adminA._id] } });
    await ShopMembership.deleteMany({ shop: { $in: [shopA._id, shopB._id] } });
    await RepairShop.deleteMany({ _id: { $in: [shopA._id, shopB._id] } });
    await User.deleteMany({ email: { $in: emails } });
  }

  try {
    async function login(email: string): Promise<Session> {
      const res = await request(app).post('/api/v1/auth/login').send({ email, password });
      assert(res.status === 200, `login ${email}`);
      const map = cookieMap(res);
      assert(map[ACCESS_COOKIE], 'access cookie');
      const csrf = res.body.data.csrfToken || map[CSRF_COOKIE];
      assert(csrf, 'csrf token');
      return { cookie: cookieHeader(map), csrf: String(csrf), user: res.body.data.user };
    }

    function auth(session: Session) {
      return {
        Cookie: session.cookie,
        'X-CSRF-Token': session.csrf
      };
    }

    const aCust = await login(custA.email);
    const bCust = await login(custB.email);
    const aAdmin = await login(adminA.email);
    const bAdmin = await login(adminB.email);
    const aMech = await login(mechA.email);

    const created = await request(app)
      .post('/api/v1/repairs')
      .set(auth(aCust))
      .send({
        shopId: String(shopA._id),
        deviceType: 'Phone',
        brand: 'Samsung',
        model: 'S21',
        problemDescription: `Atlas audit lifecycle repair ${stamp}`
      });
    assert(
      created.status === 201,
      `create repair got ${created.status} ${JSON.stringify(created.body)}`
    );
    repairId = created.body.data._id as string;

    await request(app)
      .post(`/api/v1/repairs/${repairId}/assign`)
      .set(auth(aAdmin))
      .send({ mechanicId: String(mechA._id) })
      .expect(200);

    await request(app)
      .post(`/api/v1/repairs/${repairId}/messages`)
      .set(auth(aAdmin))
      .send({ body: `Visible ${stamp}`, visibility: 'customer_visible', messageType: 'status_update' })
      .expect(201);
    await request(app)
      .post(`/api/v1/repairs/${repairId}/messages`)
      .set(auth(aAdmin))
      .send({ body: `Secret ${stamp}`, visibility: 'internal' })
      .expect(201);

    const custMsgs = await request(app)
      .get(`/api/v1/repairs/${repairId}/messages`)
      .set(auth(aCust))
      .expect(200);
    assert(
      (custMsgs.body.data as Array<{ body: string }>).every((m) => !m.body.includes('Secret')),
      'internal hidden from customer'
    );
    assert(
      (custMsgs.body.data as Array<{ body: string }>).some((m) => m.body.includes(`Visible ${stamp}`)),
      'customer sees visible message'
    );
    results.push('PASS internal messages hidden from customer');

    assert(
      (await request(app).get(`/api/v1/repairs/${repairId}`).set(auth(bCust))).status === 403,
      'customer B blocked from A repair'
    );
    results.push('PASS customer isolation');

    assert(
      (await request(app).get(`/api/v1/repairs/${repairId}`).set(auth(bAdmin))).status === 403,
      'shop B blocked from shop A repair'
    );
    results.push('PASS shop isolation');

    assert(
      (
        await request(app)
          .post(`/api/v1/repairs/${repairId}/complete`)
          .set(auth(aCust))
          .send({ workPerformed: 'nope enough chars', finalCost: 1 })
      ).status === 403,
      'customer cannot complete'
    );
    assert(
      (
        await request(app)
          .post('/api/v1/documents/payments')
          .set(auth(aCust))
          .send({ repairId, amount: 1, method: 'cash', confirmedReceived: true })
      ).status === 403,
      'customer cannot pay'
    );
    assert(
      (
        await request(app)
          .post(`/api/v1/repairs/${repairId}/close`)
          .set(auth(aCust))
          .send({ notes: 'nope' })
      ).status === 403,
      'customer cannot close'
    );
    results.push('PASS customer cannot complete/pay/close');

    await request(app)
      .post(`/api/v1/repairs/${repairId}/diagnosis`)
      .set(auth(aMech))
      .send({ findings: 'Battery swollen', recommendedActions: 'Replace battery' })
      .expect(201);
    const est = await request(app)
      .post(`/api/v1/repairs/${repairId}/estimates`)
      .set(auth(aMech))
      .send({ laborCost: 1000, partsCost: 4000 });
    assert(est.status === 201, `estimate ${est.status}`);
    await request(app)
      .post(`/api/v1/repairs/estimates/${est.body.data._id}/decision`)
      .set(auth(aCust))
      .send({ decision: 'approved' })
      .expect(200);
    await request(app)
      .post(`/api/v1/repairs/${repairId}/parts-not-required`)
      .set(auth(aMech))
      .send({ notes: 'battery in stock' })
      .expect(200);
    await request(app).post(`/api/v1/repairs/${repairId}/start`).set(auth(aMech)).expect(200);
    await request(app)
      .post(`/api/v1/repairs/${repairId}/complete`)
      .set(auth(aMech))
      .send({ workPerformed: 'Battery replaced and tested', finalCost: 5000 })
      .expect(200);

    assert(
      (
        await request(app)
          .post('/api/v1/documents/payments')
          .set(auth(aAdmin))
          .send({ repairId, amount: 1000, method: 'cash', confirmedReceived: false })
      ).status === 400,
      'unconfirmed payment rejected'
    );
    results.push('PASS unconfirmed payment rejected');

    const idem = `atlas-audit-${stamp}`;
    const p1 = await request(app)
      .post('/api/v1/documents/payments')
      .set(auth(aAdmin))
      .send({ repairId, amount: 2000, method: 'cash', confirmedReceived: true, idempotencyKey: idem });
    assert(p1.status === 201, `partial payment ${p1.status}`);
    const p1dup = await request(app)
      .post('/api/v1/documents/payments')
      .set(auth(aAdmin))
      .send({ repairId, amount: 2000, method: 'cash', confirmedReceived: true, idempotencyKey: idem });
    assert(p1dup.status === 201 && String(p1dup.body.data._id) === String(p1.body.data._id), 'idempotent dup');
    assert(
      (await PaymentRecord.countDocuments({ repairRequest: repairId, entryType: 'payment' })) === 1,
      'no duplicate ledger'
    );
    results.push('PASS duplicate payment idempotency');

    const over = await request(app)
      .post('/api/v1/documents/payments')
      .set(auth(aAdmin))
      .send({
        repairId,
        amount: 99999,
        method: 'jazzcash',
        reference: 'X',
        confirmedReceived: true
      });
    assert(over.status === 409 && over.body.error.code === 'EXCEEDS_BALANCE', 'overpay blocked');
    results.push('PASS concurrent/overpay cannot exceed balance');

    const p2 = await request(app)
      .post('/api/v1/documents/payments')
      .set(auth(aAdmin))
      .send({
        repairId,
        amount: 3000,
        method: 'easypaisa',
        reference: `EP-${stamp}`,
        confirmedReceived: true,
        idempotencyKey: `${idem}-ep`
      });
    assert(p2.status === 201, `easypaisa remainder ${p2.status}`);

    assert(
      (
        await request(app)
          .post('/api/v1/documents/issue')
          .set(auth(aAdmin))
          .send({ repairId, docType: 'payment_receipt' })
      ).status >= 400,
      'receipt without paymentId rejected'
    );
    const goodReceipt = await request(app)
      .post('/api/v1/documents/issue')
      .set(auth(aAdmin))
      .send({ repairId, docType: 'payment_receipt', paymentId: p2.body.data._id });
    assert(goodReceipt.status === 201, `receipt for confirmed payment ${goodReceipt.status}`);
    results.push('PASS receipts only for confirmed payments');

    assert(
      (
        await request(app)
          .post(`/api/v1/repairs/${repairId}/close`)
          .set(auth(aAdmin))
          .send({ notes: 'early' })
      ).status === 409,
      'close without collection blocked'
    );

    await request(app)
      .post(`/api/v1/repairs/${repairId}/collect`)
      .set(auth(aAdmin))
      .send({ notes: 'collected' })
      .expect(200);

    const { reversePayment } = await import('../services/documents.js');
    await reversePayment({
      user: {
        id: String(adminA._id),
        email: adminA.email,
        role: 'shop_admin',
        name: adminA.name,
        preferredLanguage: 'en',
        shopIds: [String(shopA._id)]
      },
      paymentId: String(p2.body.data._id),
      reason: 'Audit reversal test'
    });

    const summaryAfterRev = await request(app)
      .get(`/api/v1/repairs/${repairId}/payments`)
      .set(auth(aAdmin))
      .expect(200);
    assert(summaryAfterRev.body.data.outstanding > 0, 'reversal restores outstanding');
    assert(
      Math.abs(summaryAfterRev.body.data.outstanding - 3000) < 0.01,
      `outstanding equals reversed amount got ${summaryAfterRev.body.data.outstanding}`
    );
    assert(
      Math.abs(summaryAfterRev.body.data.amountPaid - 2000) < 0.01,
      `amountPaid keeps cash partial got ${summaryAfterRev.body.data.amountPaid}`
    );
    results.push('PASS payment reversal restores balance');

    assert(
      (
        await request(app)
          .post('/api/v1/documents/issue')
          .set(auth(aAdmin))
          .send({ repairId, docType: 'payment_receipt', paymentId: p2.body.data._id })
      ).status === 409,
      'reversed payment cannot issue receipt'
    );
    results.push('PASS reversed payment blocked from receipt');

    assert(
      (
        await request(app)
          .post(`/api/v1/repairs/${repairId}/close`)
          .set(auth(aAdmin))
          .send({ notes: 'close', waiveOutstanding: true, waiveReason: 'no' })
      ).status === 400,
      'short waive reason rejected'
    );
    results.push('PASS short waive reason rejected');

    const due = summaryAfterRev.body.data.outstanding as number;
    await request(app)
      .post('/api/v1/documents/payments')
      .set(auth(aAdmin))
      .send({
        repairId,
        amount: due,
        method: 'cash',
        confirmedReceived: true,
        idempotencyKey: `${idem}-final`
      })
      .expect(201);

    await request(app)
      .post(`/api/v1/repairs/${repairId}/close`)
      .set(auth(aAdmin))
      .send({ notes: 'closed after settle', caseSummary: `Audit close ${stamp}` })
      .expect(200);
    results.push('PASS close after settle');

    assert(
      (
        await request(app)
          .patch(`/api/v1/repairs/${repairId}/workspace`)
          .set(auth(aAdmin))
          .send({ customerNotes: 'x' })
      ).status === 409,
      'closed immutable'
    );
    results.push('PASS closed case ordinary mutation blocked');

    assert(
      (
        await request(app)
          .post(`/api/v1/repairs/${repairId}/reopen`)
          .set(auth(aAdmin))
          .send({ reason: 'no' })
      ).status === 400,
      'short reopen reason rejected'
    );
    const reopen = await request(app)
      .post(`/api/v1/repairs/${repairId}/reopen`)
      .set(auth(aAdmin))
      .send({ reason: 'Customer returned with follow-up issue' });
    assert(reopen.status === 200, `reopen ok ${reopen.status}`);
    assert(
      (await AuditLog.findOne({ action: 'repair.reopen', entityId: repairId })),
      'reopen audit exists'
    );
    results.push('PASS reopen requires reason + audit');

    assert(
      (await Notification.find({ user: custA._id, repairRequest: repairId })).length > 0,
      'customer notifications created'
    );
    results.push('PASS customer notifications generated');

    const publicIds = {
      repairId,
      msgCount: await RepairMessage.countDocuments({ repairRequest: repairId }),
      payCount: await PaymentRecord.countDocuments({ repairRequest: repairId })
    };
    await disconnectDb();
    await connectDb();
    assert(getDbMode() === 'atlas', 'reconnect atlas');
    assert(await RepairRequest.findById(repairId), 'repair persisted');
    assert(
      (await RepairMessage.countDocuments({ repairRequest: repairId })) === publicIds.msgCount,
      'messages persisted'
    );
    assert(
      (await PaymentRecord.countDocuments({ repairRequest: repairId })) === publicIds.payCount,
      'payments persisted'
    );
    results.push('PASS persistence after reconnect');

    const list = await request(app)
      .get('/api/v1/repairs?includePayments=1&limit=20')
      .set(auth(aAdmin))
      .expect(200);
    assert(
      (list.body.data as Array<{ paymentSummary?: unknown }>).some((r) => r.paymentSummary),
      'includePayments batch summaries'
    );
    results.push('PASS batch payment summaries (no N+1 required)');

    await cleanup();
    repairId = null;
    results.push('PASS cleaned isolated audit records');

    console.log(JSON.stringify({ ok: true, dbMode: getDbMode(), results }, null, 2));
  } catch (err) {
    try {
      await cleanup();
    } catch {
      /* best-effort */
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
