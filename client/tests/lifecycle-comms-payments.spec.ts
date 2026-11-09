import { test, expect, type APIRequestContext, type Browser, type Page } from '@playwright/test';

const API = 'http://localhost:5000';
const PASSWORD = 'Password123!';

/** One login per request context — respects production auth rate limits. */
async function apiLogin(request: APIRequestContext, email: string) {
  const existingCsrf = (await request.storageState()).cookies.find((c) => c.name === 'rc_csrf')
    ?.value;
  const res = await request.post(`${API}/api/v1/auth/login`, {
    headers: existingCsrf ? { 'X-CSRF-Token': existingCsrf } : undefined,
    data: { email, password: PASSWORD }
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const body = await res.json();
  const csrf =
    body.data?.csrfToken ||
    (await request.storageState()).cookies.find((c) => c.name === 'rc_csrf')?.value;
  expect(csrf).toBeTruthy();
  return { csrf: String(csrf), body, user: body.data.user };
}

async function currentCsrf(request: APIRequestContext) {
  const csrf = (await request.storageState()).cookies.find((c) => c.name === 'rc_csrf')?.value;
  expect(csrf, 'csrf cookie present').toBeTruthy();
  return String(csrf);
}

function csrfHeaders(csrf: string) {
  return { 'X-CSRF-Token': csrf };
}

async function seedSession(page: Page, request: APIRequestContext, email: string) {
  const session = await apiLogin(request, email);
  const state = await request.storageState();
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
  await page.goto('/login');
  await page.evaluate((u) => {
    localStorage.setItem('rc_user', JSON.stringify(u));
    localStorage.removeItem('rc_token');
  }, session.user);
  return session;
}

test.describe('Lifecycle communication + payments (two sessions)', () => {
  test.describe.configure({ mode: 'serial' });

  test('customer and shop admin complete messaging, payments, collection, close', async ({
    browser,
    request
  }: {
    browser: Browser;
    request: APIRequestContext;
  }) => {
    const stamp = Date.now();
    // Bootstrap: one admin login on shared request for shop/mechanic discovery
    await apiLogin(request, 'admin@repairconnect.local');
    const me = await request.get(`${API}/api/v1/auth/me`);
    const meBody = await me.json();
    const shopId =
      meBody.data?.shopIds?.[0] ||
      meBody.data?.shops?.[0]?.id ||
      meBody.data?.shops?.[0]?.shop?._id;
    expect(shopId).toBeTruthy();

    const staff = await request.get(`${API}/api/v1/auth/staff?shopId=${shopId}`);
    const staffBody = await staff.json();
    const rows = staffBody.data || staffBody;
    const mechanicRow = (Array.isArray(rows) ? rows : []).find(
      (m: any) => m.user?.email === 'mechanic@repairconnect.local' || m.role === 'mechanic'
    );
    const mechanicId = mechanicRow?.user?._id || mechanicRow?.user;
    expect(mechanicId).toBeTruthy();

    const customerCtx = await browser.newContext();
    const adminCtx = await browser.newContext();
    const mechanicCtx = await browser.newContext();
    const customerPage = await customerCtx.newPage();
    const adminPage = await adminCtx.newPage();
    const customerReq = customerCtx.request;
    const adminReq = adminCtx.request;
    const mechanicReq = mechanicCtx.request;

    // One login each — reuse cookies/CSRF for the rest of the flow
    const custSession = await seedSession(customerPage, customerReq, 'customer@repairconnect.local');
    let adminSession = await seedSession(adminPage, adminReq, 'admin@repairconnect.local');
    const mechSession = await apiLogin(mechanicReq, 'mechanic@repairconnect.local');

    const created = await customerReq.post(`${API}/api/v1/repairs`, {
      headers: csrfHeaders(custSession.csrf),
      data: {
        shopId: String(shopId),
        deviceType: 'Laptop',
        brand: 'Lenovo',
        model: 'ThinkPad',
        problemDescription: `Audit lifecycle keyboard failure ${stamp}`
      }
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const repairId = (await created.json()).data._id as string;

    adminSession = { ...adminSession, csrf: await currentCsrf(adminReq) };
    await adminReq
      .post(`${API}/api/v1/repairs/${repairId}/assign`, {
        headers: csrfHeaders(adminSession.csrf),
        data: { mechanicId: String(mechanicId) }
      })
      .then(async (r) => expect(r.ok(), await r.text()).toBeTruthy());

    const msg = await adminReq.post(`${API}/api/v1/repairs/${repairId}/messages`, {
      headers: csrfHeaders(adminSession.csrf),
      data: {
        body: `We received your device and started review (${stamp}).`,
        visibility: 'customer_visible',
        messageType: 'status_update'
      }
    });
    expect(msg.ok(), await msg.text()).toBeTruthy();

    await adminReq.post(`${API}/api/v1/repairs/${repairId}/messages`, {
      headers: csrfHeaders(adminSession.csrf),
      data: {
        body: `INTERNAL ONLY secret ${stamp}`,
        visibility: 'internal',
        messageType: 'general'
      }
    });

    await customerPage.goto(`/app/repairs/${repairId}`);
    await expect(customerPage.getByText(`We received your device and started review (${stamp})`)).toBeVisible({
      timeout: 20000
    });
    await expect(customerPage.getByText(`INTERNAL ONLY secret ${stamp}`)).toHaveCount(0);

    await mechanicReq
      .post(`${API}/api/v1/repairs/${repairId}/diagnosis`, {
        headers: csrfHeaders(mechSession.csrf),
        data: {
          findings: 'Keyboard matrix failed',
          recommendedActions: 'Replace keyboard'
        }
      })
      .then(async (r) => expect(r.ok(), await r.text()).toBeTruthy());

    const est = await mechanicReq.post(`${API}/api/v1/repairs/${repairId}/estimates`, {
      headers: csrfHeaders(mechSession.csrf),
      data: { laborCost: 1500, partsCost: 3500, notes: 'Keyboard kit' }
    });
    expect(est.ok(), await est.text()).toBeTruthy();
    const estimateId = (await est.json()).data._id as string;

    await customerPage.reload();
    await expect(customerPage.getByTestId('approve-estimate')).toBeVisible({ timeout: 20000 });
    const custCsrf = await currentCsrf(customerReq);
    const approve = await customerReq.post(`${API}/api/v1/repairs/estimates/${estimateId}/decision`, {
      headers: csrfHeaders(custCsrf),
      data: { decision: 'approved' }
    });
    expect(approve.ok(), await approve.text()).toBeTruthy();
    await customerPage.reload();
    await expect(customerPage.getByTestId('readiness-message')).toBeVisible({ timeout: 20000 });

    await mechanicReq
      .post(`${API}/api/v1/repairs/${repairId}/parts-not-required`, {
        headers: csrfHeaders(mechSession.csrf),
        data: { notes: 'Stock keyboard on hand' }
      })
      .then(async (r) => expect(r.ok(), await r.text()).toBeTruthy());
    await mechanicReq
      .post(`${API}/api/v1/repairs/${repairId}/start`, {
        headers: csrfHeaders(mechSession.csrf)
      })
      .then(async (r) => expect(r.ok(), await r.text()).toBeTruthy());

    await adminReq.post(`${API}/api/v1/repairs/${repairId}/customer-updates`, {
      headers: csrfHeaders(adminSession.csrf),
      data: { body: `Repair in progress update ${stamp}`, messageType: 'status_update' }
    });

    const complete = await mechanicReq.post(`${API}/api/v1/repairs/${repairId}/complete`, {
      headers: csrfHeaders(mechSession.csrf),
      data: {
        workPerformed: 'Replaced keyboard and tested',
        finalCost: 5000,
        completionSummary: `Repair completed summary ${stamp}`
      }
    });
    expect(complete.ok(), await complete.text()).toBeTruthy();

    await customerPage.reload();
    await expect(customerPage.getByTestId('customer-status')).toContainText(
      /Repair Completed|Ready for Collection|مرمت مکمل|وصولی کے لیے تیار/i,
      { timeout: 15000 }
    );
    await expect(customerPage.getByText(`Repair completed summary ${stamp}`)).toBeVisible();

    await adminPage.goto(`/app/repairs/${repairId}`);
    await expect(adminPage.getByTestId('payment-section')).toBeVisible({ timeout: 20000 });
    await adminPage.locator('#payAmt').fill('2000');
    await adminPage.locator('#payMethod').selectOption('cash');
    await adminPage.getByRole('button', { name: /Confirm payment received/i }).click();
    await expect(adminPage).toHaveURL(/\/app\/documents\//, { timeout: 20000 });

    await customerPage.reload();
    await expect(customerPage.getByText(/Outstanding|باقی|بقایا/i)).toBeVisible();
    await expect(customerPage.getByText(/3000/)).toBeVisible();

    await adminPage.goto(`/app/repairs/${repairId}`);
    await expect(adminPage.getByTestId('payment-section')).toBeVisible({ timeout: 20000 });
    await adminPage.locator('#payAmt').fill('3000');
    await adminPage.locator('#payMethod').selectOption('jazzcash');
    await adminPage.locator('#payRef').fill(`JC-AUDIT-${stamp}`);
    await adminPage.getByRole('button', { name: /Confirm payment received/i }).click();
    await expect(adminPage).toHaveURL(/\/app\/documents\//, { timeout: 20000 });

    await adminPage.goto(`/app/repairs/${repairId}`);
    await expect(adminPage.getByTestId('confirm-collection')).toBeVisible({ timeout: 20000 });
    await adminPage.getByTestId('confirm-collection').click();
    await expect(adminPage.getByTestId('close-case')).toBeVisible({ timeout: 15000 });
    await adminPage.getByTestId('close-case').click();

    await expect(adminPage.getByTestId('customer-status')).toContainText(/Closed|بند/i, {
      timeout: 20000
    });
    await customerPage.reload();
    await expect(customerPage.getByTestId('customer-status')).toContainText(/Closed|بند/i);
    await expect(customerPage.getByText(/Payment history|ادائیگی|PAY-/i).first()).toBeVisible();

    const custNegCsrf = await currentCsrf(customerReq);
    const custClose = await customerReq.post(`${API}/api/v1/repairs/${repairId}/close`, {
      headers: csrfHeaders(custNegCsrf),
      data: { notes: 'nope' }
    });
    expect(custClose.status()).toBe(403);
    const custPay = await customerReq.post(`${API}/api/v1/documents/payments`, {
      headers: csrfHeaders(custNegCsrf),
      data: { repairId, amount: 1, method: 'cash', confirmedReceived: true }
    });
    expect([401, 403]).toContain(custPay.status());

    const adminCsrf = await currentCsrf(adminReq);
    const mutate = await adminReq.patch(`${API}/api/v1/repairs/${repairId}/workspace`, {
      headers: csrfHeaders(adminCsrf),
      data: { customerNotes: 'edit closed' }
    });
    expect(mutate.status()).toBe(409);

    await customerCtx.close();
    await adminCtx.close();
    await mechanicCtx.close();
  });
});
