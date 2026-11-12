import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app.js';
import { User, RepairShop } from '../models/index.js';
import { repairCreateSchema } from '../validators/schemas.js';
import { formatZodValidationMessage } from '../middleware/validate.js';
import { parseFlexibleDateTime } from '../validators/dateTime.js';

describe('Repair create validation (datetime-local + messages)', () => {
  it('parses HTML datetime-local into ISO UTC', () => {
    const iso = parseFlexibleDateTime('2026-11-20T15:30');
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Number.isNaN(new Date(iso!).getTime())).toBe(false);
  });

  it('accepts datetime-local appointmentAt in repairCreateSchema', () => {
    const result = repairCreateSchema.safeParse({
      shopId: '507f1f77bcf86cd799439011',
      deviceType: 'Laptop',
      brand: 'Dell',
      model: 'XPS 15',
      serialNumber: '',
      accessories: '',
      problemDescription: 'Screen flickering and battery drain',
      appointmentAt: '2026-11-20T15:30',
      photos: []
    });
    expect(result.success, JSON.stringify(result.success ? {} : result.error.flatten())).toBe(true);
    if (result.success) {
      expect(result.data.appointmentAt).toMatch(/Z$/);
      expect(result.data.serialNumber).toBeUndefined();
      expect(result.data.accessories).toBeUndefined();
    }
  });

  it('rejects garbage appointment times with a clear field message', () => {
    const result = repairCreateSchema.safeParse({
      shopId: '507f1f77bcf86cd799439011',
      deviceType: 'Laptop',
      brand: 'Dell',
      model: 'XPS 15',
      problemDescription: 'Screen flickering and battery drain',
      appointmentAt: 'not-a-real-datetime'
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = formatZodValidationMessage(result.error);
      expect(message.toLowerCase()).toContain('appointment');
      expect(message).not.toBe('Validation failed');
    }
  });

  it('creates a repair when appointmentAt is datetime-local via API', async () => {
    const app = createApp();
    const password = 'Password123!';
    const shop = await RepairShop.create({
      name: 'Validation Shop',
      code: `VAL${Date.now().toString(36).toUpperCase()}`,
      city: 'Karachi',
      address: '1 Test St',
      phone: '03001234567',
      isActive: true,
      serviceCategories: ['computers_laptops']
    });
    await User.create({
      email: 'repair.validation@auth.test',
      passwordHash: await bcrypt.hash(password, 10),
      name: 'Repair Validation',
      role: 'customer'
    });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'repair.validation@auth.test', password });
    expect(login.status).toBe(200);
    const token = login.body.data.token as string | undefined;
    const csrf = login.body.data.csrfToken as string;
    const cookies = login.headers['set-cookie'];

    const res = await request(app)
      .post('/api/v1/repairs')
      .set('Cookie', Array.isArray(cookies) ? cookies.join('; ') : String(cookies || ''))
      .set('X-CSRF-Token', csrf)
      .set(token ? { Authorization: `Bearer ${token}` } : {})
      .send({
        shopId: shop._id.toString(),
        deviceType: 'Laptop',
        brand: 'Lenovo',
        model: 'T14',
        serialNumber: '',
        accessories: '',
        problemDescription: 'Keyboard keys sticking after spill',
        appointmentAt: '2026-12-01T10:15',
        idempotencyKey: `val-${Date.now()}`
      });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.appointmentAt).toBeTruthy();
  });

  it('returns field-specific validation message instead of bare Validation failed', async () => {
    const app = createApp();
    const password = 'Password123!';
    await User.create({
      email: 'repair.validation2@auth.test',
      passwordHash: await bcrypt.hash(password, 10),
      name: 'Repair Validation 2',
      role: 'customer'
    });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'repair.validation2@auth.test', password });
    const csrf = login.body.data.csrfToken as string;
    const cookies = login.headers['set-cookie'];
    const token = login.body.data.token as string | undefined;

    const res = await request(app)
      .post('/api/v1/repairs')
      .set('Cookie', Array.isArray(cookies) ? cookies.join('; ') : String(cookies || ''))
      .set('X-CSRF-Token', csrf)
      .set(token ? { Authorization: `Bearer ${token}` } : {})
      .send({
        shopId: '507f1f77bcf86cd799439011',
        deviceType: 'Laptop',
        brand: 'Dell',
        model: 'XPS',
        problemDescription: 'bad',
        appointmentAt: 'totally-invalid'
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(String(res.body.error.message)).not.toBe('Validation failed');
    expect(String(res.body.error.message).length).toBeGreaterThan(20);
  });
});
