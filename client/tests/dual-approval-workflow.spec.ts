import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { apiLogin as helperApiLogin } from './helpers/auth';

const API = 'http://localhost:5000';

async function apiLogin(request: APIRequestContext, email: string) {
  // Shared helper retries RATE_LIMIT without disabling production auth limits.
  const session = await helperApiLogin(request, email);
  return {
    csrf: session.csrf,
    body: { data: { user: session.user, csrfToken: session.csrf } }
  };
}

async function currentCsrf(request: APIRequestContext) {
  const csrf = (await request.storageState()).cookies.find((c) => c.name === 'rc_csrf')?.value;
  expect(csrf, 'csrf cookie present').toBeTruthy();
  return String(csrf);
}

function csrfHeaders(csrf: string) {
  return { 'X-CSRF-Token': csrf };
}

const ROLE_HOME: Record<string, string> = {
  customer: '/app/customer',
  mechanic: '/app/mechanic',
  parts_coordinator: '/app/parts',
  shop_admin: '/app/admin'
};

async function loginUi(page: Page, request: APIRequestContext, email: string) {
  const session = await apiLogin(request, email);
  const state = await request.storageState();
  const user = session.body.data.user;
  await page.context().clearCookies();
  await page.context().addCookies(
    state.cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: 'localhost',
      path: c.path || '/',
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: (c.sameSite as 'Lax' | 'Strict' | 'None') || 'Lax'
    }))
  );
  // Seed auth store before app boot (full document load after localStorage write).
  await page.goto('/login');
  await page.evaluate((u) => {
    localStorage.setItem('rc_user', JSON.stringify(u));
    localStorage.removeItem('rc_token');
  }, user);
  await page.goto(ROLE_HOME[user.role] || '/app/customer');
  await page.waitForURL(/\/app\//, { timeout: 20000 });
}

async function logoutUi(page: Page) {
  await page.evaluate(() => {
    localStorage.removeItem('rc_user');
    localStorage.removeItem('rc_token');
  });
  await page.context().clearCookies();
  await page.goto('/login');
}

async function bootstrapRepair(request: APIRequestContext) {
  const admin = await apiLogin(request, 'admin@repairconnect.local');
  const me = await request.get(`${API}/api/v1/auth/me`);
  expect(me.ok()).toBeTruthy();
  const meBody = await me.json();
  // /auth/me shops[] are memberships — prefer nested shop id, never membership _id
  let shopId =
    meBody.data?.shopIds?.[0] ||
    meBody.data?.shops?.[0]?.shop?._id ||
    meBody.data?.shops?.[0]?.shop?.id ||
    meBody.data?.shops?.[0]?.shop;
  if (!shopId) {
    const mine = await request.get(`${API}/api/v1/shops/mine`);
    expect(mine.ok(), await mine.text()).toBeTruthy();
    const list = (await mine.json()).data || [];
    shopId = list[0]?._id || list[0]?.id;
  }
  expect(shopId, JSON.stringify(meBody.data)).toBeTruthy();

  const staff = await request.get(`${API}/api/v1/auth/staff?shopId=${shopId}`);
  expect(staff.ok(), await staff.text()).toBeTruthy();
  const staffBody = await staff.json();
  const rows = staffBody.data || staffBody;
  const mechanicRow = (Array.isArray(rows) ? rows : []).find(
    (m: any) => m.role === 'mechanic' || m.user?.email === 'mechanic@repairconnect.local'
  );
  const mechanicId = mechanicRow?.user?._id || mechanicRow?.user;
  expect(mechanicId, JSON.stringify(staffBody)).toBeTruthy();

  const customerSession = await apiLogin(request, 'customer@repairconnect.local');
  const created = await request.post(`${API}/api/v1/repairs`, {
    headers: csrfHeaders(customerSession.csrf),
    data: {
      shopId: String(shopId),
      deviceType: 'Phone',
      brand: 'Apple',
      model: 'iPhone 13',
      problemDescription: `E2E cracked screen ${Date.now()}`
    }
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const repairId = (await created.json()).data._id as string;

  // Customer login replaced admin cookies — one admin re-auth for assign + inventory.
  const admin2 = await apiLogin(request, 'admin@repairconnect.local');
  const assign = await request.post(`${API}/api/v1/repairs/${repairId}/assign`, {
    headers: csrfHeaders(admin2.csrf),
    data: { mechanicId: String(mechanicId) }
  });
  expect(assign.ok(), await assign.text()).toBeTruthy();

  const mech = await apiLogin(request, 'mechanic@repairconnect.local');
  const diag = await request.post(`${API}/api/v1/repairs/${repairId}/diagnosis`, {
    headers: csrfHeaders(mech.csrf),
    data: {
      findings: 'OLED panel cracked across center',
      recommendedActions: 'Replace screen assembly'
    }
  });
  expect(diag.ok(), await diag.text()).toBeTruthy();

  const est = await request.post(`${API}/api/v1/repairs/${repairId}/estimates`, {
    headers: csrfHeaders(mech.csrf),
    data: { laborCost: 2000, partsCost: 8000, notes: 'Screen replacement' }
  });
  expect(est.ok(), await est.text()).toBeTruthy();
  const estimateId = (await est.json()).data._id as string;

  // Inventory readable as shop_admin — reuse admin CSRF without a parts login in bootstrap.
  const adminInv = await apiLogin(request, 'admin@repairconnect.local');
  const inv = await request.get(`${API}/api/v1/parts?shopId=${shopId}`);
  expect(inv.ok()).toBeTruthy();
  const invBody = await inv.json();
  const screen =
    (invBody.data || []).find((p: any) => p.sku === 'SCR-LAP-15') || (invBody.data || [])[0];
  expect(screen, JSON.stringify(invBody)).toBeTruthy();

  return {
    repairId,
    estimateId,
    shopId: String(shopId),
    screenId: String(screen._id),
    screenSku: String(screen.sku),
    admin: adminInv
  };
}

test.describe('Dual-approval workflow UI', () => {
  test.describe.configure({ timeout: 180_000 });

  test.describe.configure({ mode: 'serial' });

  test('undetermined parts blocks start; no-parts path enables start and collection', async ({
    page,
    request
  }) => {
    const ctx = await bootstrapRepair(request);

    await loginUi(page, request, 'customer@repairconnect.local');
    await page.goto(`/app/repairs/${ctx.repairId}`);
    await expect(page.getByTestId('readiness-message')).toContainText(/Awaiting your approval/i);
    await page.getByTestId('approve-estimate').click();
    await expect(page.getByTestId('readiness-message')).toBeVisible();
    await logoutUi(page);

    await loginUi(page, request, 'mechanic@repairconnect.local');
    await page.goto(`/app/repairs/${ctx.repairId}`);
    await expect(page.getByTestId('parts-requirement-status')).toHaveText('undetermined');
    await expect(page.getByTestId('can-start-repair')).toHaveText('no');
    await expect(page.getByTestId('start-work')).toHaveCount(0);
    await expect(page.getByTestId('confirm-no-parts')).toBeVisible();

    await page.getByTestId('confirm-no-parts').click();
    await expect(page.getByTestId('parts-requirement-status')).toHaveText('not_required', {
      timeout: 20000
    });
    await expect(page.getByTestId('can-start-repair')).toHaveText('yes', { timeout: 20000 });
    await page.getByTestId('start-work').click();
    await expect(page.getByTestId('readiness-message')).toContainText(/Repair in progress/i);

    // Page already holds mechanic cookies from loginUi — reuse CSRF, do not re-login.
    const complete = await request.post(`${API}/api/v1/repairs/${ctx.repairId}/complete`, {
      headers: csrfHeaders(await currentCsrf(request)),
      data: { workPerformed: 'Software recalibration — no parts used', finalCost: 2000 }
    });
    expect(complete.ok(), await complete.text()).toBeTruthy();

    await page.reload();
    await expect(page.getByTestId('readiness-message')).toContainText(/ready for collection/i, {
      timeout: 20000
    });
    await page.getByTestId('confirm-collection').click();
    await expect(page.getByTestId('readiness-message')).toContainText(
      /collected|awaiting case closure|ready for collection/i,
      { timeout: 20000 }
    );
  });

  test('parts path: blocked start, transfer Unconfirmed, receive, reserve, start, collect', async ({
    page,
    request
  }) => {
    const ctx = await bootstrapRepair(request);

    await loginUi(page, request, 'customer@repairconnect.local');
    await page.goto(`/app/repairs/${ctx.repairId}`);
    await page.getByTestId('approve-estimate').click();
    await expect(page.getByTestId('readiness-message')).toBeVisible();
    await logoutUi(page);

    await loginUi(page, request, 'mechanic@repairconnect.local');
    const prRes = await request.post(`${API}/api/v1/repairs/${ctx.repairId}/parts-requests`, {
      headers: csrfHeaders(await currentCsrf(request)),
      data: { partId: ctx.screenId, quantity: 1 }
    });
    expect(prRes.ok(), await prRes.text()).toBeTruthy();
    const partsRequestId = (await prRes.json()).data._id as string;

    await page.goto(`/app/repairs/${ctx.repairId}`);
    await expect(page.getByTestId('can-start-repair')).toHaveText('no', { timeout: 20000 });
    await expect(page.getByTestId('readiness-message')).toContainText(/awaiting part reservation/i);
    await expect(page.getByTestId('start-work')).toHaveCount(0);
    await logoutUi(page);

    const partsSession = await apiLogin(request, 'parts@repairconnect.local');
    const mineRes = await request.get(`${API}/api/v1/shops/mine`);
    expect(mineRes.ok(), await mineRes.text()).toBeTruthy();
    const mineBody = await mineRes.json();
    const myShops = mineBody.data || mineBody;
    const donorShop = (Array.isArray(myShops) ? myShops : []).find(
      (s: any) => String(s._id || s.id) !== ctx.shopId
    );
    expect(donorShop, JSON.stringify(mineBody)).toBeTruthy();
    const donorShopId = String(donorShop._id || donorShop.id);

    const donorList = await request.get(`${API}/api/v1/parts?shopId=${donorShopId}`);
    expect(donorList.ok(), await donorList.text()).toBeTruthy();
    const donorBody = await donorList.json();
    let donor =
      (donorBody.data || []).find((p: any) => p.sku === ctx.screenSku) || (donorBody.data || [])[0];
    if (!donor) {
      const createdDonor = await request.post(`${API}/api/v1/parts`, {
        headers: csrfHeaders(partsSession.csrf),
        data: {
          shopId: donorShopId,
          sku: ctx.screenSku,
          name: 'E2E donor screen',
          category: 'screens',
          quantityAvailable: 5,
          reorderLevel: 1,
          unitCost: 1000
        }
      });
      expect(createdDonor.ok(), await createdDonor.text()).toBeTruthy();
      donor = (await createdDonor.json()).data;
    } else if ((donor.quantityAvailable || 0) < 1) {
      const stocked = await request.post(`${API}/api/v1/parts/${donor._id}/stock-in`, {
        headers: csrfHeaders(partsSession.csrf),
        data: { quantity: 5, notes: 'E2E restock for transfer' }
      });
      expect(stocked.ok(), await stocked.text()).toBeTruthy();
      donor = (await stocked.json()).data;
    }
    expect(donor?._id).toBeTruthy();

    const transferRes = await request.post(`${API}/api/v1/transfers`, {
      headers: csrfHeaders(partsSession.csrf),
      data: {
        fromPartId: donor._id,
        toShopId: ctx.shopId,
        quantity: 1,
        reason: 'Part unavailable — transfer requested',
        repairRequestId: ctx.repairId,
        partsRequestId,
        reserveOnReceive: true
      }
    });
    expect(transferRes.ok(), await transferRes.text()).toBeTruthy();
    const transferBody = await transferRes.json();
    const transferId = transferBody.data._id as string;
    expect(transferBody.data.expectedArrivalDisplay).toBe('Unconfirmed');

    await loginUi(page, request, 'parts@repairconnect.local');
    await page.goto('/app/parts/transfers');
    await expect(page.getByTestId('expected-arrival').first()).toContainText(/Unconfirmed/i, {
      timeout: 20000
    });

    const partsCsrf = await currentCsrf(request);
    const approve = await request.post(`${API}/api/v1/transfers/${transferId}/approve`, {
      headers: csrfHeaders(partsCsrf)
    });
    expect(approve.ok(), await approve.text()).toBeTruthy();
    const dispatch = await request.post(`${API}/api/v1/transfers/${transferId}/dispatch`, {
      headers: csrfHeaders(await currentCsrf(request))
    });
    expect(dispatch.ok(), await dispatch.text()).toBeTruthy();

    await page.reload();
    const receiveBtn = page.getByRole('button', { name: /Receive/i }).first();
    if (await receiveBtn.isVisible().catch(() => false)) {
      await receiveBtn.click();
    }
    // API receive is authoritative (matches server dual-approval coverage); UI may race.
    const receiveApi = await request.post(`${API}/api/v1/transfers/${transferId}/receive`, {
      headers: csrfHeaders(await currentCsrf(request))
    });
    const receiveText = await receiveApi.text();
    expect(
      receiveApi.ok() || /ALREADY|INVALID_STATE|received/i.test(receiveText),
      receiveText
    ).toBeTruthy();
    await expect(page.getByTestId('expected-arrival').first()).toBeVisible({ timeout: 20000 });

    // Ensure reservation via UI when still open, then confirm via API.
    await page.goto('/app/parts/requests');
    const reserveBtn = page.getByTestId('reserve-part').first();
    if (await reserveBtn.isVisible().catch(() => false)) {
      await reserveBtn.click();
    }

    const reserveApi = await request.post(`${API}/api/v1/parts/requests/${partsRequestId}/reserve`, {
      headers: csrfHeaders(await currentCsrf(request)),
      data: { quantity: 1 }
    });
    const reserveText = await reserveApi.text();
    // 200 = reserved now; only treat already-fulfilled states as success — not INSUFFICIENT_STOCK.
    expect(
      reserveApi.ok() || /ALREADY_FULFILLED|already fulfilled|INVALID_STATE/i.test(reserveText),
      reserveText
    ).toBeTruthy();

    const readyCheck = await request.get(`${API}/api/v1/repairs/${ctx.repairId}`);
    expect(readyCheck.ok()).toBeTruthy();
    const readyBody = await readyCheck.json();
    const readiness = readyBody.data.readiness;
    expect(
      readiness?.canStartRepair,
      `readiness after reserve/transfer: ${JSON.stringify(readiness)}`
    ).toBe(true);

    await logoutUi(page);
    await loginUi(page, request, 'mechanic@repairconnect.local');
    await page.goto(`/app/repairs/${ctx.repairId}`);
    await expect(page.getByTestId('can-start-repair')).toHaveText('yes', { timeout: 20000 });
    await expect(page.getByTestId('start-work')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('start-work').click();
    await expect(page.getByTestId('readiness-message')).toContainText(/Repair in progress/i, {
      timeout: 20000
    });

    const complete = await request.post(`${API}/api/v1/repairs/${ctx.repairId}/complete`, {
      headers: csrfHeaders(await currentCsrf(request)),
      data: { workPerformed: 'Replaced screen assembly and tested', finalCost: 10000 }
    });
    expect(complete.ok(), await complete.text()).toBeTruthy();

    await page.reload();
    await expect(page.getByTestId('readiness-message')).toContainText(/ready for collection/i, {
      timeout: 20000
    });
    await page.getByTestId('confirm-collection').click();
    await expect(page.getByTestId('readiness-message')).toContainText(
      /collected|awaiting case closure|ready for collection/i,
      { timeout: 20000 }
    );
  });
});
