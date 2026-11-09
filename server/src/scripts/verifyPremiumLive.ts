/**
 * Live Atlas API smoke for premium features against a running server.
 * Uses seed accounts. Does not wipe production collections.
 *
 * Usage (API already running on :5000 with Atlas):
 *   npx tsx src/scripts/verifyPremiumLive.ts
 */
const API = process.env.API_URL || 'http://localhost:5000';
const PASS = 'Password123!';

async function json(path: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

async function login(email: string) {
  const res = await fetch(`${API}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASS })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`login failed ${email}: ${res.status}`);
  // Prefer HttpOnly cookie JWT; fall back to test-only body.token if present.
  const setCookies =
    typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const access = setCookies.find((c) => c.startsWith('rc_access='));
  const fromCookie = access?.split(';')[0]?.slice('rc_access='.length);
  const token = fromCookie || body?.data?.token;
  if (!token) throw new Error(`login missing access token for ${email}`);
  return token as string;
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const health = await json('/health');
  assert(health.body?.data?.dbMode === 'atlas', `Expected atlas dbMode, got ${health.body?.data?.dbMode}`);
  console.log('OK: health atlas');

  const customer = await login('customer@repairconnect.local');
  const parts = await login('parts@repairconnect.local');
  const admin = await login('admin@repairconnect.local');
  const mechanic = await login('mechanic@repairconnect.local');
  console.log('OK: seed logins');

  const shops = await json('/api/v1/shops');
  const shopId = shops.body?.data?.[0]?._id;
  assert(shopId, 'No shops available');

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (tomorrow.getDay() === 0) tomorrow.setDate(tomorrow.getDate() + 1);
  const date = tomorrow.toISOString().slice(0, 10);

  const slots = await json(`/api/v1/appointments/slots?shopId=${shopId}&date=${date}`);
  assert(slots.res.ok, `slots failed ${slots.res.status}`);
  assert(Array.isArray(slots.body.data.slots), 'slots missing');
  console.log('OK: appointment slots', slots.body.data.slots.length);

  let appointmentId: string | null = null;
  if (slots.body.data.slots[0]) {
    const book = await json('/api/v1/appointments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customer}` },
      body: JSON.stringify({ shopId, startsAt: slots.body.data.slots[0], notes: 'live-verify' })
    });
    assert(book.res.ok, `book failed ${book.res.status} ${JSON.stringify(book.body)}`);
    appointmentId = book.body.data._id;
    const dup = await json('/api/v1/appointments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customer}` },
      body: JSON.stringify({ shopId, startsAt: slots.body.data.slots[0], notes: 'dup' })
    });
    assert(dup.res.status === 409, `expected 409 double book, got ${dup.res.status}`);
    console.log('OK: double-booking prevented');
  } else {
    console.log('WARN: no slots available for tomorrow; skipped booking');
  }

  const repair = await json('/api/v1/repairs', {
    method: 'POST',
    headers: { Authorization: `Bearer ${customer}`, 'Idempotency-Key': `live-${Date.now()}` },
    body: JSON.stringify({
      shopId,
      deviceType: 'Laptop',
      brand: 'Lenovo',
      model: 'ThinkPad',
      serialNumber: `LIVE-${Date.now()}`,
      accessories: 'Charger',
      problemDescription: 'Live premium verification repair request',
      photos: [{ url: 'data:image/png;base64,iVBORw0KGgo=', kind: 'device' }]
    })
  });
  assert(repair.res.ok, `repair create failed ${repair.res.status} ${JSON.stringify(repair.body)}`);
  assert(repair.body.data.trackingToken, 'missing trackingToken');
  console.log('OK: repair with trackingToken', repair.body.data.referenceNumber);

  const track = await json(`/api/v1/public/track/${repair.body.data.trackingToken}`);
  assert(track.res.ok, `public track failed ${track.res.status}`);
  assert(!JSON.stringify(track.body).includes('customer@repairconnect.local'), 'PII leaked in public track');
  console.log('OK: public track sanitized');

  const prefs = await json('/api/v1/auth/me/notifications', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${customer}` },
    body: JSON.stringify({ repairUpdates: true, partsAlerts: true })
  });
  assert(prefs.res.ok, `prefs failed ${prefs.res.status}`);
  console.log('OK: notification prefs');

  const report = await json('/api/v1/reports/operations', {
    headers: { Authorization: `Bearer ${admin}` }
  });
  assert(report.res.ok, `report failed ${report.res.status}`);
  assert(typeof report.body.data.totalReceived === 'number', 'report missing totals');
  console.log('OK: admin operations report totalReceived=', report.body.data.totalReceived);

  const inv = await json('/api/v1/parts?limit=5', { headers: { Authorization: `Bearer ${parts}` } });
  assert(inv.res.ok, `parts list failed ${inv.res.status}`);
  const partId = inv.body?.data?.[0]?._id;
  if (partId) {
    const badAdjust = await json(`/api/v1/parts/${partId}/adjust`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${parts}` },
      body: JSON.stringify({ quantityDelta: -1, reason: 'no' })
    });
    assert(badAdjust.res.status === 400, `expected adjust reason validation 400, got ${badAdjust.res.status}`);
    console.log('OK: adjust requires meaningful reason');
  }

  const suppliers = await json('/api/v1/suppliers', { headers: { Authorization: `Bearer ${parts}` } });
  assert(suppliers.res.ok, `suppliers failed ${suppliers.res.status}`);
  console.log('OK: suppliers list', (suppliers.body.data || []).length);

  const transfers = await json('/api/v1/transfers', { headers: { Authorization: `Bearer ${parts}` } });
  assert(transfers.res.ok, `transfers failed ${transfers.res.status}`);
  console.log('OK: transfers list');

  // mechanic unauthorized on admin report
  const mechReport = await json('/api/v1/reports/operations', {
    headers: { Authorization: `Bearer ${mechanic}` }
  });
  assert(mechReport.res.status === 403, `mechanic should be forbidden on reports, got ${mechReport.res.status}`);
  console.log('OK: report role authorization');

  if (appointmentId) {
    const cancel = await json(`/api/v1/appointments/${appointmentId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${customer}` },
      body: JSON.stringify({ reason: 'live-verify cleanup' })
    });
    // may 409 if cancel policy blocks; still log
    console.log('OK: appointment cancel attempt status=', cancel.res.status);
  }

  console.log('PREMIUM_LIVE_VERIFY_PASSED');
}

main().catch((err) => {
  console.error('PREMIUM_LIVE_VERIFY_FAILED', err);
  process.exit(1);
});
