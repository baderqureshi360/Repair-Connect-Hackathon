import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app.js';
import { User } from '../models/index.js';

const app = createApp();

describe('Language preference isolation', () => {
  it('keeps language preferences independent between users', async () => {
    const passwordHash = await bcrypt.hash('Password123!', 10);
    await User.create([
      {
        email: 'lang1@test.com',
        passwordHash,
        name: 'Lang One',
        role: 'customer',
        preferredLanguage: 'en'
      },
      {
        email: 'lang2@test.com',
        passwordHash,
        name: 'Lang Two',
        role: 'customer',
        preferredLanguage: 'en'
      }
    ]);

    const login1 = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'lang1@test.com', password: 'Password123!' });
    const login2 = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'lang2@test.com', password: 'Password123!' });

    const t1 = login1.body.data.token;
    const t2 = login2.body.data.token;

    const patch1 = await request(app)
      .patch('/api/v1/auth/me/language')
      .set('Authorization', `Bearer ${t1}`)
      .send({ preferredLanguage: 'ur' });
    expect(patch1.status).toBe(200);
    expect(patch1.body.data.preferredLanguage).toBe('ur');

    const me2 = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${t2}`);
    expect(me2.body.data.preferredLanguage).toBe('en');

    const me1 = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${t1}`);
    expect(me1.body.data.preferredLanguage).toBe('ur');
  });
});
