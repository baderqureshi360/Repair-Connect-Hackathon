import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import expressApp, { createApp } from '../app.js';
import { app as singleton } from '../httpApp.js';
import { User } from '../models/index.js';
import { ACCESS_COOKIE, CSRF_COOKIE } from '../utils/cookies.js';
import { env } from '../config/env.js';
import { connectDb, getDbMode } from '../config/db.js';

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

describe('Vercel dual-project deployment guards', () => {
  const previousCron = process.env.CRON_SECRET;
  const frontendOrigin = env.clientUrl;

  beforeEach(() => {
    process.env.CRON_SECRET = 'vercel-cron-test-secret-min-16';
  });

  afterEach(() => {
    if (previousCron === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousCron;
  });

  it('reuses mongoose connection across ensureReady-style connect calls', async () => {
    const a = await connectDb();
    const b = await connectDb();
    expect(a.mode).toBe(b.mode);
    expect(getDbMode()).not.toBe('disconnected');
  });

  it('allows credentialed CORS for configured frontend origin and rejects others', async () => {
    const app = createApp();
    const allowed = await request(app)
      .options('/api/v1/auth/login')
      .set('Origin', frontendOrigin)
      .set('Access-Control-Request-Method', 'POST');
    expect(allowed.headers['access-control-allow-origin']).toBe(frontendOrigin);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const denied = await request(app)
      .options('/api/v1/auth/login')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('keeps API CSRF enforcement for cookie sessions', async () => {
    const app = createApp();
    const password = 'Password123!';
    await User.create({
      email: 'vercel.csrf@auth.test',
      passwordHash: await bcrypt.hash(password, 10),
      name: 'Vercel Csrf',
      role: 'customer'
    });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', frontendOrigin)
      .send({ email: 'vercel.csrf@auth.test', password });
    expect(login.status).toBe(200);
    const cookies = cookieMap(login);

    const denied = await request(app)
      .patch('/api/v1/auth/me/language')
      .set('Origin', frontendOrigin)
      .set('Cookie', cookieHeader(cookies, [ACCESS_COOKIE, CSRF_COOKIE]))
      .send({ preferredLanguage: 'ur' });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('CSRF_REJECTED');
  });

  it('rejects outbox cron without bearer secret and accepts with CRON_SECRET', async () => {
    const app = createApp();
    const unauthorized = await request(app).post('/api/cron/outbox');
    expect(unauthorized.status).toBe(401);

    const okRes = await request(app)
      .post('/api/cron/outbox')
      .set('Authorization', 'Bearer vercel-cron-test-secret-min-16');
    expect(okRes.status).toBe(200);
    expect(okRes.body.success).toBe(true);
    expect(typeof okRes.body.data.delivered).toBe('number');
  });

  it('health remains public for Vercel probes', async () => {
    const app = createApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.data.service).toBe('repairconnect-api');
  });

  it('default export is the shared Express app Vercel invokes', async () => {
    expect(expressApp).toBe(singleton);
    expect(typeof expressApp).toBe('function');
    expect(typeof expressApp.listen).toBe('function');
    const res = await request(expressApp).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.data.service).toBe('repairconnect-api');
  });

  it('documents cross-site cookie requirement for split Vercel hosts', () => {
    expect(['lax', 'none', 'strict']).toContain(env.cookieSameSite);
  });
});
