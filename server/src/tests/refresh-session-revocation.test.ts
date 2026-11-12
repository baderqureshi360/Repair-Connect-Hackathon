import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app.js';
import { RefreshSession, User } from '../models/index.js';
import { ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE } from '../utils/cookies.js';
import { hashRefreshToken } from '../services/refreshSessions.js';

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

async function createUser(email: string) {
  const passwordHash = await bcrypt.hash(password, 10);
  return User.create({
    email,
    passwordHash,
    name: 'Refresh Tester',
    role: 'customer',
    isActive: true,
    accountStatus: 'active'
  });
}

describe('Refresh session revocation & rotation', () => {
  it('stores only hashed refresh tokens on login', async () => {
    await createUser('hash.store@auth.test');
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'hash.store@auth.test', password });
    expect(login.status).toBe(200);
    const cookies = cookieMap(login);
    const raw = cookies[REFRESH_COOKIE];
    expect(raw).toBeTruthy();

    const sessions = await RefreshSession.find({});
    expect(sessions.length).toBe(1);
    expect(sessions[0].tokenHash).toBe(hashRefreshToken(raw));
    expect(JSON.stringify(sessions[0])).not.toContain(raw);
  });

  it('rotates refresh token and rejects the previous token (replay)', async () => {
    await createUser('rotate@auth.test');
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'rotate@auth.test', password });
    const first = cookieMap(login);
    const oldRefresh = first[REFRESH_COOKIE];

    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(first, [REFRESH_COOKIE, CSRF_COOKIE, ACCESS_COOKIE]))
      .set('X-CSRF-Token', first[CSRF_COOKIE]);
    expect(refresh.status).toBe(200);
    const second = { ...first, ...cookieMap(refresh) };
    expect(second[REFRESH_COOKIE]).toBeTruthy();
    expect(second[REFRESH_COOKIE]).not.toBe(oldRefresh);

    const replay = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE}=${oldRefresh}; ${CSRF_COOKIE}=${first[CSRF_COOKIE]}`)
      .set('X-CSRF-Token', first[CSRF_COOKIE]);
    expect(replay.status).toBe(401);
    expect(['TOKEN_REUSE', 'UNAUTHORIZED']).toContain(replay.body.error?.code);
  });

  it('logout revokes refresh so it cannot mint new access tokens', async () => {
    await createUser('logout.rev@auth.test');
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'logout.rev@auth.test', password });
    const cookies = cookieMap(login);

    const logout = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookieHeader(cookies, [ACCESS_COOKIE, REFRESH_COOKIE, CSRF_COOKIE]))
      .set('X-CSRF-Token', cookies[CSRF_COOKIE]);
    expect(logout.status).toBe(200);

    const after = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(cookies, [REFRESH_COOKIE, CSRF_COOKIE]))
      .set('X-CSRF-Token', cookies[CSRF_COOKIE]);
    expect(after.status).toBe(401);
  });

  it('password change revokes prior refresh sessions', async () => {
    await createUser('pwchange@auth.test');
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'pwchange@auth.test', password });
    const cookies = cookieMap(login);
    const priorRefresh = cookies[REFRESH_COOKIE];

    const change = await request(app)
      .post('/api/v1/auth/me/password')
      .set('Cookie', cookieHeader(cookies, [ACCESS_COOKIE, REFRESH_COOKIE, CSRF_COOKIE]))
      .set('X-CSRF-Token', cookies[CSRF_COOKIE])
      .send({ currentPassword: password, newPassword: 'NewPassword123!' });
    expect(change.status).toBe(200);
    const afterChange = { ...cookies, ...cookieMap(change) };

    const stale = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE}=${priorRefresh}; ${CSRF_COOKIE}=${cookies[CSRF_COOKIE]}`)
      .set('X-CSRF-Token', cookies[CSRF_COOKIE]);
    expect(stale.status).toBe(401);

    // New session from password change may refresh
    const fresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(afterChange, [REFRESH_COOKIE, CSRF_COOKIE, ACCESS_COOKIE]))
      .set('X-CSRF-Token', afterChange[CSRF_COOKIE] || cookies[CSRF_COOKIE]);
    expect(fresh.status).toBe(200);
  });

  it('password reset revokes all sessions', async () => {
    await createUser('pwreset@auth.test');
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'pwreset@auth.test', password });
    const cookies = cookieMap(login);

    const forgot = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'pwreset@auth.test' });
    expect(forgot.status).toBe(200);
    expect(forgot.body.data.resetToken).toBeTruthy();

    const reset = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: forgot.body.data.resetToken, newPassword: 'ResetPass123!' });
    expect(reset.status).toBe(200);

    const after = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(cookies, [REFRESH_COOKIE, CSRF_COOKIE]))
      .set('X-CSRF-Token', cookies[CSRF_COOKIE]);
    expect(after.status).toBe(401);

    const relogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'pwreset@auth.test', password: 'ResetPass123!' });
    expect(relogin.status).toBe(200);
  });

  it('deactivated account cannot refresh', async () => {
    const user = await createUser('deact@auth.test');
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'deact@auth.test', password });
    const cookies = cookieMap(login);

    user.isActive = false;
    await user.save();
    const { revokeAllUserSessions } = await import('../services/refreshSessions.js');
    await revokeAllUserSessions(user._id, 'account_deactivated');

    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(cookies, [REFRESH_COOKIE, CSRF_COOKIE]))
      .set('X-CSRF-Token', cookies[CSRF_COOKIE]);
    expect(refresh.status).toBe(401);
  });

  it('handles concurrent refresh safely (at most one successor session)', async () => {
    await createUser('concurrent@auth.test');
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'concurrent@auth.test', password });
    const cookies = cookieMap(login);

    const [a, b] = await Promise.all([
      request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieHeader(cookies, [REFRESH_COOKIE, CSRF_COOKIE, ACCESS_COOKIE]))
        .set('X-CSRF-Token', cookies[CSRF_COOKIE]),
      request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieHeader(cookies, [REFRESH_COOKIE, CSRF_COOKIE, ACCESS_COOKIE]))
        .set('X-CSRF-Token', cookies[CSRF_COOKIE])
    ]);

    const okCount = [a, b].filter((r) => r.status === 200).length;
    const failCount = [a, b].filter((r) => r.status === 401).length;
    expect(okCount).toBe(1);
    expect(failCount).toBe(1);

    const active = await RefreshSession.countDocuments({ revokedAt: null });
    expect(active).toBe(1);

    // Winner's new refresh still works
    const winner = [a, b].find((r) => r.status === 200)!;
    const nextCookies = { ...cookies, ...cookieMap(winner) };
    const follow = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(nextCookies, [REFRESH_COOKIE, CSRF_COOKIE, ACCESS_COOKIE]))
      .set('X-CSRF-Token', nextCookies[CSRF_COOKIE] || cookies[CSRF_COOKIE]);
    expect(follow.status).toBe(200);
  });
});
