import { describe, it, expect } from 'vitest';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { createApp } from '../app.js';
import { User } from '../models/index.js';
import { ACCESS_COOKIE, CSRF_COOKIE } from '../utils/cookies.js';

function stubWebHandler(req: Request, res: Response, _next: NextFunction) {
  if (req.path.startsWith('/_app/') || req.path.endsWith('.js') || req.path.endsWith('.css')) {
    res.status(200).type('application/javascript').send('/* asset */');
    return;
  }
  res.status(200).type('html').send('<!doctype html><html><body>RepairConnect web</body></html>');
}

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

describe('Combined Express + web handler', () => {
  const app = createApp({ webHandler: stubWebHandler });

  it('serves frontend homepage through Express', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('RepairConnect web');
  });

  it('serves a SvelteKit-style frontend route', async () => {
    const res = await request(app).get('/login');
    expect(res.status).toBe(200);
    expect(res.text).toContain('RepairConnect web');
  });

  it('serves static-like asset paths via web handler', async () => {
    const res = await request(app).get('/_app/immutable/entry/start.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('asset');
  });

  it('keeps existing API health endpoint', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.service).toBe('repairconnect-api');
  });

  it('returns JSON 404 for unknown /api/* routes', async () => {
    const res = await request(app).get('/api/v1/does-not-exist-xyz');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('still enforces API CSRF on cookie-authenticated mutations', async () => {
    const password = 'Password123!';
    const passwordHash = await bcrypt.hash(password, 10);
    await User.create({
      email: 'combined.csrf@auth.test',
      passwordHash,
      name: 'Combined Csrf',
      role: 'customer'
    });

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'combined.csrf@auth.test', password });
    expect(login.status).toBe(200);
    const cookies = cookieMap(login);

    const denied = await request(app)
      .patch('/api/v1/auth/me/language')
      .set('Cookie', cookieHeader(cookies, [ACCESS_COOKIE, CSRF_COOKIE]))
      .send({ preferredLanguage: 'ur' });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('CSRF_REJECTED');
  });

  it('does not apply API CSRF rejection to non-API web POSTs', async () => {
    const password = 'Password123!';
    const passwordHash = await bcrypt.hash(password, 10);
    await User.create({
      email: 'combined.webpost@auth.test',
      passwordHash,
      name: 'Combined WebPost',
      role: 'customer'
    });

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'combined.webpost@auth.test', password });
    const cookies = cookieMap(login);

    const res = await request(app)
      .post('/login')
      .set('Cookie', cookieHeader(cookies, [ACCESS_COOKIE, CSRF_COOKIE]))
      .send('name=value');
    expect(res.status).toBe(200);
    expect(res.text).toContain('RepairConnect web');
    expect(res.body?.error?.code).not.toBe('CSRF_REJECTED');
  });
});
