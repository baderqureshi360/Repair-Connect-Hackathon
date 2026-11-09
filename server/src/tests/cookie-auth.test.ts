import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app.js';
import { User } from '../models/index.js';
import { ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE } from '../utils/cookies.js';

const app = createApp();
const password = 'Password123!';

function cookieMap(res: request.Response): Record<string, string> {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out: Record<string, string> = {};
  for (const entry of list) {
    const [pair] = entry.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) out[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return out;
}

function cookieHeader(map: Record<string, string>, names: string[]) {
  return names.filter((n) => map[n]).map((n) => `${n}=${map[n]}`).join('; ');
}

describe('HttpOnly cookie auth + CSRF', () => {
  it('sets HttpOnly access/refresh cookies and readable CSRF on login', async () => {
    const passwordHash = await bcrypt.hash(password, 10);
    await User.create({
      email: 'cookie@auth.test',
      passwordHash,
      name: 'Cookie User',
      role: 'customer'
    });

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'cookie@auth.test', password });

    expect(login.status).toBe(200);
    expect(login.body.data.token).toBeTruthy(); // test-env Bearer helper only
    expect(login.body.data.csrfToken).toBeTruthy();

    const raw = login.headers['set-cookie'] as string[];
    expect(raw.some((c) => c.startsWith(`${ACCESS_COOKIE}=`) && /HttpOnly/i.test(c))).toBe(true);
    expect(raw.some((c) => c.startsWith(`${REFRESH_COOKIE}=`) && /HttpOnly/i.test(c))).toBe(true);
    expect(raw.some((c) => c.startsWith(`${CSRF_COOKIE}=`) && !/HttpOnly/i.test(c))).toBe(true);
    expect(raw.every((c) => /SameSite=Lax/i.test(c))).toBe(true);

    const cookies = cookieMap(login);
    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', cookieHeader(cookies, [ACCESS_COOKIE, CSRF_COOKIE]));
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe('cookie@auth.test');
  });

  it('rejects cookie-authenticated mutations without CSRF', async () => {
    const passwordHash = await bcrypt.hash(password, 10);
    await User.create({
      email: 'csrf@auth.test',
      passwordHash,
      name: 'Csrf User',
      role: 'customer'
    });

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'csrf@auth.test', password });
    const cookies = cookieMap(login);

    const denied = await request(app)
      .patch('/api/v1/auth/me/language')
      .set('Cookie', cookieHeader(cookies, [ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE]))
      .send({ preferredLanguage: 'ur' });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('CSRF_REJECTED');

    const ok = await request(app)
      .patch('/api/v1/auth/me/language')
      .set('Cookie', cookieHeader(cookies, [ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE]))
      .set('X-CSRF-Token', cookies[CSRF_COOKIE])
      .send({ preferredLanguage: 'ur' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.preferredLanguage).toBe('ur');
  });

  it('allows Bearer clients without CSRF header', async () => {
    const passwordHash = await bcrypt.hash(password, 10);
    await User.create({
      email: 'bearer@auth.test',
      passwordHash,
      name: 'Bearer User',
      role: 'customer'
    });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'bearer@auth.test', password });
    const token = login.body.data.token as string;

    const ok = await request(app)
      .patch('/api/v1/auth/me/language')
      .set('Authorization', `Bearer ${token}`)
      .send({ preferredLanguage: 'en' });
    expect(ok.status).toBe(200);
  });

  it('refreshes session and logout clears cookies', async () => {
    const passwordHash = await bcrypt.hash(password, 10);
    await User.create({
      email: 'refresh@auth.test',
      passwordHash,
      name: 'Refresh User',
      role: 'customer'
    });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'refresh@auth.test', password });
    let cookies = cookieMap(login);

    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(cookies, [REFRESH_COOKIE, CSRF_COOKIE, ACCESS_COOKIE]))
      .set('X-CSRF-Token', cookies[CSRF_COOKIE]);
    expect(refresh.status).toBe(200);
    expect(refresh.body.data.csrfToken).toBeTruthy();
    cookies = { ...cookies, ...cookieMap(refresh) };

    const logout = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookieHeader(cookies, [ACCESS_COOKIE, REFRESH_COOKIE, CSRF_COOKIE]))
      .set('X-CSRF-Token', cookies[CSRF_COOKIE]);
    expect(logout.status).toBe(200);

    const cleared = logout.headers['set-cookie'] as string[];
    expect(
      cleared.some(
        (c) =>
          c.startsWith(`${ACCESS_COOKIE}=`) &&
          (/Max-Age=0/i.test(c) || /Expires=/i.test(c))
      )
    ).toBe(true);

    // Browser would drop cookies after Max-Age=0; request without session cookies.
    const me = await request(app).get('/api/v1/auth/me');
    expect(me.status).toBe(401);
  });
});
