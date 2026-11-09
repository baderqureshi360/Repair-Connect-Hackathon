import { describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../app.js';
import { Part, RepairShop, ShopMembership, StockTransfer, User } from '../models/index.js';
import { canonicalizeTransferStatus, transferStatusAliases } from '../services/readiness.js';

const app = createApp();
const password = 'Password123!';

describe('Legacy transfer status aliases', () => {
  it('maps approved/dispatched to canonical statuses', () => {
    expect(canonicalizeTransferStatus('approved')).toBe('awaiting_transfer');
    expect(canonicalizeTransferStatus('dispatched')).toBe('in_transit');
    expect(canonicalizeTransferStatus('awaiting_transfer')).toBe('awaiting_transfer');
    expect(canonicalizeTransferStatus('in_transit')).toBe('in_transit');
    expect(transferStatusAliases('approved')).toEqual(['awaiting_transfer', 'approved']);
    expect(transferStatusAliases('dispatched')).toEqual(['in_transit', 'dispatched']);
  });

  it('serializes historical approved/dispatched records with canonical mapping', async () => {
    const passwordHash = await bcrypt.hash(password, 10);
    const shopA = await RepairShop.create({
      name: 'Legacy A',
      code: 'LEGA',
      address: '1 A',
      city: 'Lahore',
      phone: '1'
    });
    const shopB = await RepairShop.create({
      name: 'Legacy B',
      code: 'LEGB',
      address: '2 B',
      city: 'Karachi',
      phone: '2'
    });
    const [parts] = await User.create([
      { email: 'leg-p@test.com', passwordHash, name: 'Parts', role: 'parts_coordinator' }
    ]);
    await ShopMembership.create([
      { user: parts._id, shop: shopA._id, role: 'parts_coordinator' },
      { user: parts._id, shop: shopB._id, role: 'parts_coordinator' }
    ]);
    const fromPart = await Part.create({
      shop: shopA._id,
      sku: 'LEG-1',
      name: 'Legacy Part',
      quantityAvailable: 5,
      quantityReserved: 0,
      reorderLevel: 0,
      unitCost: 10
    });

    // Historical records written with legacy statuses
    await StockTransfer.create({
      partSku: 'LEG-1',
      partName: 'Legacy Part',
      fromShop: shopA._id,
      toShop: shopB._id,
      fromPart: fromPart._id,
      quantity: 1,
      status: 'approved',
      requestedBy: parts._id,
      history: [{ status: 'approved', at: new Date(), by: parts._id, note: 'legacy' }]
    });
    await StockTransfer.create({
      partSku: 'LEG-1',
      partName: 'Legacy Part',
      fromShop: shopA._id,
      toShop: shopB._id,
      fromPart: fromPart._id,
      quantity: 1,
      status: 'dispatched',
      requestedBy: parts._id,
      history: [{ status: 'dispatched', at: new Date(), by: parts._id, note: 'legacy' }]
    });

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'leg-p@test.com', password });
    const token = login.body.data.token;

    const list = await request(app)
      .get('/api/v1/transfers')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);

    const approved = list.body.data.find((t: { status: string }) => t.status === 'approved');
    const dispatched = list.body.data.find((t: { status: string }) => t.status === 'dispatched');
    expect(approved.canonicalStatus).toBe('awaiting_transfer');
    expect(approved.statusAliases).toContain('approved');
    expect(dispatched.canonicalStatus).toBe('in_transit');
    expect(dispatched.statusAliases).toContain('dispatched');

    // New transfer still uses canonical awaiting_transfer after approve
    const created = await request(app)
      .post('/api/v1/transfers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fromPartId: fromPart._id.toString(),
        toShopId: shopB._id.toString(),
        quantity: 1
      });
    const approve = await request(app)
      .post(`/api/v1/transfers/${created.body.data._id}/approve`)
      .set('Authorization', `Bearer ${token}`);
    expect(approve.body.data.status).toBe('awaiting_transfer');
    expect(approve.body.data.canonicalStatus).toBe('awaiting_transfer');
  });
});
