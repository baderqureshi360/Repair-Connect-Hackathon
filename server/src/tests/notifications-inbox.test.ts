import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app.js';
import {
  Notification,
  Part,
  RepairShop,
  ShopMembership,
  User
} from '../models/index.js';
import {
  createRepairRequest,
  submitEstimate,
  assignMechanic,
  addDiagnosis
} from '../services/repairs.js';
import { adjustStock } from '../services/inventory.js';
import { processOutboxBatch } from '../services/outbox.js';
import type { AuthUser } from '../middleware/auth.js';

const app = createApp();
const password = 'SecurePass1';

async function login(email: string) {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.data.token as string;
}

describe('Centralized notifications inbox', () => {
  it('generates role-targeted events, enforces recipient isolation, and supports read/unread', async () => {
    const passwordHash = await bcrypt.hash(password, 12);
    const stamp = Date.now();
    const shop = await RepairShop.create({
      name: `Notif Shop ${stamp}`,
      code: `NF${String(stamp).slice(-6)}`,
      address: '1 N',
      city: 'Lahore',
      region: 'Punjab',
      phone: '+92-42-9',
      email: `nf.shop.${stamp}@test.com`,
      isActive: true
    });

    const [customerA, customerB, admin, mechanic, parts] = await User.create([
      { email: `nf.ca.${stamp}@test.com`, passwordHash, name: 'Cust A', role: 'customer' },
      { email: `nf.cb.${stamp}@test.com`, passwordHash, name: 'Cust B', role: 'customer' },
      { email: `nf.a.${stamp}@test.com`, passwordHash, name: 'Admin', role: 'shop_admin' },
      { email: `nf.m.${stamp}@test.com`, passwordHash, name: 'Mech', role: 'mechanic' },
      { email: `nf.p.${stamp}@test.com`, passwordHash, name: 'Parts', role: 'parts_coordinator' }
    ]);

    await ShopMembership.create([
      { user: admin._id, shop: shop._id, role: 'shop_admin', isActive: true },
      { user: mechanic._id, shop: shop._id, role: 'mechanic', isActive: true },
      { user: parts._id, shop: shop._id, role: 'parts_coordinator', isActive: true }
    ]);

    const repair = await createRepairRequest({
      customerId: String(customerA._id),
      shopId: String(shop._id),
      deviceType: 'Phone',
      brand: 'Samsung',
      model: 'A14',
      problemDescription: 'Notification inbox isolation and role targeting case'
    });
    await processOutboxBatch(30);

    // Shop admin gets new repair; customer gets tracking_repair_received; other customer none
    expect(
      await Notification.countDocuments({ user: admin._id, type: 'new_repair_request' })
    ).toBeGreaterThanOrEqual(1);
    expect(
      await Notification.countDocuments({ user: customerA._id, type: 'tracking_repair_received' })
    ).toBeGreaterThanOrEqual(1);
    expect(await Notification.countDocuments({ user: customerB._id })).toBe(0);

    const shopId = String(shop._id);
    const adminUser = {
      id: String(admin._id),
      role: 'shop_admin',
      email: admin.email,
      name: admin.name,
      preferredLanguage: 'en',
      shopIds: [shopId]
    } as AuthUser;
    await assignMechanic({
      repairId: String(repair._id),
      mechanicId: String(mechanic._id),
      admin: adminUser
    });
    await processOutboxBatch(20);

    expect(
      await Notification.countDocuments({ user: mechanic._id, type: 'repair_assigned' })
    ).toBeGreaterThanOrEqual(1);

    const mechUser = {
      id: String(mechanic._id),
      role: 'mechanic',
      email: mechanic.email,
      name: mechanic.name,
      preferredLanguage: 'en',
      shopIds: [shopId]
    } as AuthUser;
    await addDiagnosis({
      repairId: String(repair._id),
      mechanic: mechUser,
      findings: 'Screen damaged',
      recommendedActions: 'Replace screen'
    });
    await submitEstimate({
      repairId: String(repair._id),
      mechanic: mechUser,
      laborCost: 500,
      partsCost: 200,
      notes: 'Public estimate note'
    });
    await processOutboxBatch(30);

    // Customer gets estimate_ready once (no duplicate tracking_estimate_prepared)
    expect(
      await Notification.countDocuments({ user: customerA._id, type: 'estimate_ready' })
    ).toBe(1);
    expect(
      await Notification.countDocuments({
        user: customerA._id,
        type: { $in: ['tracking_estimate_prepared', 'tracking_estimate_revised'] }
      })
    ).toBe(0);
    expect(
      await Notification.countDocuments({ user: admin._id, type: 'pending_approval' })
    ).toBeGreaterThanOrEqual(1);

    // Low stock → parts coordinator + shop admin
    const part = await Part.create({
      shop: shop._id,
      sku: `NF-${stamp}`,
      name: 'Screen',
      quantityAvailable: 3,
      quantityReserved: 0,
      reorderLevel: 2,
      unitCost: 1000
    });
    await adjustStock({
      partId: String(part._id),
      quantityDelta: -2,
      reason: 'Test drawdown for low stock notification',
      userId: String(parts._id)
    });
    await processOutboxBatch(20);

    expect(await Notification.countDocuments({ user: admin._id, type: 'low_stock' })).toBeGreaterThanOrEqual(
      1
    );
    // Actor excluded from low_stock fan-out
    expect(await Notification.countDocuments({ user: parts._id, type: 'low_stock' })).toBe(0);

    const customerToken = await login(customerA.email);
    const otherToken = await login(customerB.email);
    const adminToken = await login(admin.email);

    const mine = await request(app)
      .get('/api/v1/notifications?limit=20')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(mine.body.data.unread).toBeGreaterThan(0);
    const myIds = new Set((mine.body.data.items as { _id: string }[]).map((i) => i._id));

    // Recipient isolation: cannot mark another user's notification
    const adminNotif = await Notification.findOne({ user: admin._id }).sort({ createdAt: -1 });
    expect(adminNotif).toBeTruthy();
    await request(app)
      .post(`/api/v1/notifications/${adminNotif!._id}/read`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(404);
    expect(myIds.has(String(adminNotif!._id))).toBe(false);

    const outsider = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);
    expect(outsider.body.data.items).toHaveLength(0);
    expect(outsider.body.data.unread).toBe(0);

    const first = mine.body.data.items[0];
    await request(app)
      .post(`/api/v1/notifications/${first._id}/read`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);

    await request(app)
      .post('/api/v1/notifications/read-all')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);

    const after = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(after.body.data.unread).toBe(0);
    expect((after.body.data.items as { isRead: boolean }[]).every((i) => i.isRead)).toBe(true);

    // Admin inbox still independent
    const adminInbox = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(adminInbox.body.data.unread).toBeGreaterThan(0);
  });

  it('dedupes identical notify deliveries for the same event key', async () => {
    const passwordHash = await bcrypt.hash(password, 12);
    const stamp = Date.now();
    const user = await User.create({
      email: `nf.dup.${stamp}@test.com`,
      passwordHash,
      name: 'Dup',
      role: 'customer'
    });
    const { notify } = await import('../services/notifications.js');
    await notify({
      user: user._id,
      type: 'payment_received',
      title: 'Payment',
      message: '100',
      dedupeKey: `nf-dup-${stamp}`
    });
    await notify({
      user: user._id,
      type: 'payment_received',
      title: 'Payment',
      message: '100',
      dedupeKey: `nf-dup-${stamp}`
    });
    await processOutboxBatch(10);
    expect(await Notification.countDocuments({ user: user._id, type: 'payment_received' })).toBe(1);
  });
});
