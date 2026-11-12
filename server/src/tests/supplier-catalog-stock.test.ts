import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app.js';
import {
  Part,
  RepairShop,
  ShopMembership,
  SupplierBusiness,
  SupplierCatalogItem,
  SupplierStockMovement,
  User
} from '../models/index.js';

const app = createApp();

function supplierPayload(suffix: string) {
  const email = `cat.supplier.${suffix}@example.com`;
  return {
    contactPerson: 'Catalog Supplier',
    email,
    phone: '+92-300-3330001',
    password: 'SecurePass1',
    confirmPassword: 'SecurePass1',
    businessName: `Catalog Hub ${suffix}`,
    address: '20 Catalog Street',
    city: 'Lahore',
    region: 'Punjab',
    description: 'Wholesale catalog for Phase 2 stock tests covering screens and batteries.',
    partCategories: ['screens_displays', 'batteries'] as const,
    supportedBrands: ['Samsung', 'Apple'],
    deliveryCities: ['Lahore', 'Islamabad'],
    termsAccepted: true as const
  };
}

async function loginToken(email: string, password: string) {
  const login = await request(app).post('/api/v1/auth/login').send({ email, password });
  expect(login.status).toBe(200);
  return login.body.data as { token: string; user: { id: string; role: string } };
}

async function approveSupplier(suffix: string) {
  const payload = supplierPayload(suffix);
  const reg = await request(app).post('/api/v1/public/supplier-applications/register').send(payload);
  expect(reg.status).toBe(201);

  const opsEmail = `ops.cat.${suffix}@repairconnect.platform`;
  const opsHash = await bcrypt.hash('OperatorPass1', 12);
  await User.create({
    email: opsEmail,
    passwordHash: opsHash,
    name: 'Ops',
    role: 'platform_operator',
    accountStatus: 'active',
    isActive: true
  });
  const ops = await loginToken(opsEmail, 'OperatorPass1');
  const approve = await request(app)
    .post(`/api/v1/platform/supplier-applications/${reg.body.data.id}/approve`)
    .set('Authorization', `Bearer ${ops.token}`)
    .send({ remarks: 'ok' });
  expect(approve.status).toBe(200);

  const supplier = await loginToken(payload.email, payload.password);
  const business = await SupplierBusiness.findOne({ businessEmail: payload.email });
  return { payload, supplier, business: business!, publicId: reg.body.data.id };
}

async function createShopAdmin(suffix: string, city = 'Lahore') {
  const email = `admin.cat.${suffix}@example.com`;
  const passwordHash = await bcrypt.hash('SecurePass1', 12);
  const admin = await User.create({
    email,
    passwordHash,
    name: 'Admin',
    role: 'shop_admin',
    accountStatus: 'active',
    isActive: true
  });
  const shop = await RepairShop.create({
    name: `Shop ${suffix}`,
    code: `C${suffix.slice(-8)}`.toUpperCase().slice(0, 12),
    address: '1 A',
    city,
    region: 'Punjab',
    phone: '+92-42-1',
    email,
    isActive: true
  });
  await ShopMembership.create({ user: admin._id, shop: shop._id, role: 'shop_admin', isActive: true });
  return { shop, login: await loginToken(email, 'SecurePass1') };
}

describe('Supplier catalog + stock Phase 2', () => {
  it('supports catalog CRUD, ownership isolation, and archive/delete rules', async () => {
    const a = await approveSupplier(`a-${Date.now()}`);
    const b = await approveSupplier(`b-${Date.now()}`);

    const created = await request(app)
      .post('/api/v1/supplier/catalog')
      .set('Authorization', `Bearer ${a.supplier.token}`)
      .send({
        name: 'OLED Screen A',
        sku: `SKU-A-${Date.now()}`,
        manufacturerPartNumber: 'MPN-A-1',
        category: 'screens_displays',
        brand: 'Samsung',
        compatibleModels: ['Galaxy S21'],
        description: 'Original quality OLED',
        condition: 'oem',
        warranty: '90 days',
        unitPrice: 15000,
        quantityAvailable: 10,
        minOrderQuantity: 2,
        leadTimeDays: 3
      });
    expect(created.status).toBe(201);
    expect(created.body.data.stockStatus).toBe('in_stock');
    expect(created.body.data.quantityAvailable).toBe(10);
    const itemId = created.body.data.id;

    const dupSku = await request(app)
      .post('/api/v1/supplier/catalog')
      .set('Authorization', `Bearer ${a.supplier.token}`)
      .send({
        name: 'Other',
        sku: created.body.data.sku,
        category: 'batteries',
        unitPrice: 1,
        quantityAvailable: 1
      });
    expect(dupSku.status).toBe(409);
    expect(dupSku.body.error.code).toBe('DUPLICATE_SKU');

    const crossGet = await request(app)
      .get(`/api/v1/supplier/catalog/${itemId}`)
      .set('Authorization', `Bearer ${b.supplier.token}`);
    expect(crossGet.status).toBe(404);

    const crossPatch = await request(app)
      .patch(`/api/v1/supplier/catalog/${itemId}`)
      .set('Authorization', `Bearer ${b.supplier.token}`)
      .send({ unitPrice: 1 });
    expect(crossPatch.status).toBe(404);

    const updated = await request(app)
      .patch(`/api/v1/supplier/catalog/${itemId}`)
      .set('Authorization', `Bearer ${a.supplier.token}`)
      .send({ unitPrice: 14000, isActive: true });
    expect(updated.status).toBe(200);
    expect(updated.body.data.unitPrice).toBe(14000);

    const deactivate = await request(app)
      .post(`/api/v1/supplier/catalog/${itemId}/activate`)
      .set('Authorization', `Bearer ${a.supplier.token}`)
      .send({ isActive: false });
    expect(deactivate.status).toBe(200);
    expect(deactivate.body.data.isActive).toBe(false);

    const hardDeleteEarly = await request(app)
      .delete(`/api/v1/supplier/catalog/${itemId}`)
      .set('Authorization', `Bearer ${a.supplier.token}`);
    expect(hardDeleteEarly.status).toBe(409);

    const archive = await request(app)
      .post(`/api/v1/supplier/catalog/${itemId}/archive`)
      .set('Authorization', `Bearer ${a.supplier.token}`);
    expect(archive.status).toBe(200);
    expect(archive.body.data.isArchived).toBe(true);

    const hardDelete = await request(app)
      .delete(`/api/v1/supplier/catalog/${itemId}`)
      .set('Authorization', `Bearer ${a.supplier.token}`);
    expect(hardDelete.status).toBe(200);
    expect(hardDelete.body.data.deleted).toBe(true);
  });

  it('updates stock safely, prevents negative stock, and records movements', async () => {
    const a = await approveSupplier(`stock-${Date.now()}`);
    const created = await request(app)
      .post('/api/v1/supplier/catalog')
      .set('Authorization', `Bearer ${a.supplier.token}`)
      .send({
        name: 'Battery Pack',
        sku: `BAT-${Date.now()}`,
        category: 'batteries',
        unitPrice: 3000,
        quantityAvailable: 5,
        lowStockThreshold: 5
      });
    expect(created.status).toBe(201);
    expect(created.body.data.stockStatus).toBe('low_stock');
    const itemId = created.body.data.id;
    const version = created.body.data.stockVersion;

    const receive = await request(app)
      .post(`/api/v1/supplier/catalog/${itemId}/stock`)
      .set('Authorization', `Bearer ${a.supplier.token}`)
      .send({
        action: 'receive',
        quantity: 10,
        expectedQuantity: 5,
        expectedVersion: version
      });
    expect(receive.status).toBe(200);
    expect(receive.body.data.item.quantityAvailable).toBe(15);
    expect(receive.body.data.item.stockStatus).toBe('in_stock');

    const conflict = await request(app)
      .post(`/api/v1/supplier/catalog/${itemId}/stock`)
      .set('Authorization', `Bearer ${a.supplier.token}`)
      .send({
        action: 'receive',
        quantity: 1,
        expectedQuantity: 5,
        expectedVersion: version
      });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('STOCK_CONFLICT');

    const writeOff = await request(app)
      .post(`/api/v1/supplier/catalog/${itemId}/stock`)
      .set('Authorization', `Bearer ${a.supplier.token}`)
      .send({
        action: 'write_off',
        quantity: 100,
        expectedQuantity: 15,
        expectedVersion: receive.body.data.item.stockVersion
      });
    expect(writeOff.status).toBe(409);
    expect(writeOff.body.error.code).toBe('INSUFFICIENT_STOCK');

    const setZero = await request(app)
      .post(`/api/v1/supplier/catalog/${itemId}/stock`)
      .set('Authorization', `Bearer ${a.supplier.token}`)
      .send({
        action: 'set',
        quantity: 0,
        expectedQuantity: 15,
        expectedVersion: receive.body.data.item.stockVersion
      });
    expect(setZero.status).toBe(200);
    expect(setZero.body.data.item.stockStatus).toBe('out_of_stock');

    const movements = await request(app)
      .get(`/api/v1/supplier/catalog/${itemId}/stock-movements`)
      .set('Authorization', `Bearer ${a.supplier.token}`);
    expect(movements.status).toBe(200);
    expect(movements.body.data.length).toBeGreaterThanOrEqual(2);

    const dbMoves = await SupplierStockMovement.countDocuments({ catalogItem: itemId });
    expect(dbMoves).toBeGreaterThanOrEqual(2);
  });

  it('lists marketplace products with city/filters and hides inactive suppliers', async () => {
    const suffix = `mkt-${Date.now()}`;
    const a = await approveSupplier(suffix);
    const admin = await createShopAdmin(suffix, 'Lahore');

    const item = await request(app)
      .post('/api/v1/supplier/catalog')
      .set('Authorization', `Bearer ${a.supplier.token}`)
      .send({
        name: 'Galaxy Screen Pro',
        sku: `GSP-${Date.now()}`,
        manufacturerPartNumber: 'MPN-GSP',
        category: 'screens_displays',
        brand: 'Samsung',
        unitPrice: 12000,
        quantityAvailable: 8,
        minOrderQuantity: 1,
        leadTimeDays: 2
      });
    expect(item.status).toBe(201);

    const products = await request(app)
      .get('/api/v1/marketplace/suppliers/products?city=Lahore&q=Galaxy&category=screens_displays&brand=Samsung&minPrice=10000&maxPrice=15000')
      .set('Authorization', `Bearer ${admin.login.token}`);
    expect(products.status).toBe(200);
    expect(products.body.data.items.some((p: { name: string }) => p.name === 'Galaxy Screen Pro')).toBe(true);

    const karachi = await request(app)
      .get('/api/v1/marketplace/suppliers/products?city=Karachi&q=Galaxy')
      .set('Authorization', `Bearer ${admin.login.token}`);
    expect(karachi.status).toBe(200);
    expect(karachi.body.data.items.some((p: { name: string }) => p.name === 'Galaxy Screen Pro')).toBe(false);

    // Suspend supplier → products disappear
    const opsEmail = `ops.hide.${suffix}@repairconnect.platform`;
    await User.create({
      email: opsEmail,
      passwordHash: await bcrypt.hash('OperatorPass1', 12),
      name: 'Ops2',
      role: 'platform_operator',
      accountStatus: 'active',
      isActive: true
    });
    const ops = await loginToken(opsEmail, 'OperatorPass1');
    const suspend = await request(app)
      .post(`/api/v1/platform/supplier-applications/${a.publicId}/suspend`)
      .set('Authorization', `Bearer ${ops.token}`)
      .send({ reason: 'Temporary hold for review' });
    expect(suspend.status).toBe(200);

    const hidden = await request(app)
      .get('/api/v1/marketplace/suppliers/products?city=Lahore&q=Galaxy')
      .set('Authorization', `Bearer ${admin.login.token}`);
    expect(hidden.body.data.items.some((p: { name: string }) => p.name === 'Galaxy Screen Pro')).toBe(false);

    // Shop inventory Part records remain untouched by supplier catalog
    const partCountBefore = await Part.countDocuments({});
    await SupplierCatalogItem.create({
      supplierBusiness: a.business._id,
      name: 'Should not touch shop parts',
      category: 'batteries',
      unitPrice: 1,
      quantityAvailable: 1,
      stockStatus: 'in_stock',
      inStock: true,
      isActive: true
    });
    const partCountAfter = await Part.countDocuments({});
    expect(partCountAfter).toBe(partCountBefore);
  });

  it('denies shop_admin from mutating supplier catalog/stock', async () => {
    const suffix = `deny-${Date.now()}`;
    const a = await approveSupplier(suffix);
    const admin = await createShopAdmin(suffix);
    const created = await request(app)
      .post('/api/v1/supplier/catalog')
      .set('Authorization', `Bearer ${a.supplier.token}`)
      .send({
        name: 'Protected Item',
        sku: `PROT-${Date.now()}`,
        category: 'batteries',
        unitPrice: 100,
        quantityAvailable: 3
      });
    const itemId = created.body.data.id;

    const patch = await request(app)
      .patch(`/api/v1/supplier/catalog/${itemId}`)
      .set('Authorization', `Bearer ${admin.login.token}`)
      .send({ unitPrice: 1 });
    expect(patch.status).toBe(403);

    const stock = await request(app)
      .post(`/api/v1/supplier/catalog/${itemId}/stock`)
      .set('Authorization', `Bearer ${admin.login.token}`)
      .send({ action: 'set', quantity: 0 });
    expect(stock.status).toBe(403);
  });
});
