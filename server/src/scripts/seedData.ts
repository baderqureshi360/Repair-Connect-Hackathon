import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { Part, RepairShop, ShopMembership, User } from '../models/index.js';

export async function seedDatabase(options: { clear?: boolean } = {}) {
  if (env.isProd) {
    throw new Error('[seed] FATAL: seedDatabase cannot run in production.');
  }
  if (options.clear) {
    await Promise.all([
      User.deleteMany({}),
      RepairShop.deleteMany({}),
      ShopMembership.deleteMany({}),
      Part.deleteMany({})
    ]);
  }

  const existing = await User.findOne({ email: 'customer@repairconnect.local' });
  if (existing && !options.clear) {
    return { seeded: false, message: 'Seed data already present' };
  }

  const passwordHash = await bcrypt.hash('Password123!', 12);

  const shopA = await RepairShop.create({
    name: 'Lahore Tech Repair',
    code: 'LHR01',
    address: '12 Main Boulevard, Gulberg',
    city: 'Lahore',
    phone: '+92-42-111-0001',
    email: 'lhr@repairconnect.local',
    description: 'Laptop and mobile repair specialists',
    serviceCategories: ['computers_laptops', 'mobile_phones_tablets'],
    supportedBrands: ['Apple', 'Samsung', 'Dell', 'HP', 'Lenovo'],
    supportedDevices: ['Laptop', 'Phone', 'Tablet']
  });

  const shopB = await RepairShop.create({
    name: 'Karachi Device Hub',
    code: 'KHI01',
    address: '88 Shahrah-e-Faisal',
    city: 'Karachi',
    phone: '+92-21-111-0002',
    email: 'khi@repairconnect.local',
    description: 'Enterprise device repair',
    serviceCategories: ['computers_laptops', 'printers_office', 'other_electronics'],
    supportedBrands: ['Dell', 'HP', 'Lenovo', 'Epson'],
    supportedDevices: ['Laptop', 'Desktop', 'Printer']
  });

  const [customer, mechanic, partsCoord, admin, otherMechanic] = await User.create([
    {
      email: 'customer@repairconnect.local',
      passwordHash,
      name: 'Ayesha Khan',
      role: 'customer',
      preferredLanguage: 'en',
      phone: '+92-300-1111111'
    },
    {
      email: 'mechanic@repairconnect.local',
      passwordHash,
      name: 'Bilal Ahmed',
      role: 'mechanic',
      preferredLanguage: 'en',
      phone: '+92-300-2222222'
    },
    {
      email: 'parts@repairconnect.local',
      passwordHash,
      name: 'Sana Malik',
      role: 'parts_coordinator',
      preferredLanguage: 'ur',
      phone: '+92-300-3333333'
    },
    {
      email: 'admin@repairconnect.local',
      passwordHash,
      name: 'Omar Sheikh',
      role: 'shop_admin',
      preferredLanguage: 'en',
      phone: '+92-300-4444444'
    },
    {
      email: 'mechanic.khi@repairconnect.local',
      passwordHash,
      name: 'Hassan Raza',
      role: 'mechanic',
      preferredLanguage: 'en'
    }
  ]);

  await ShopMembership.create([
    { user: mechanic._id, shop: shopA._id, role: 'mechanic' },
    { user: partsCoord._id, shop: shopA._id, role: 'parts_coordinator' },
    { user: partsCoord._id, shop: shopB._id, role: 'parts_coordinator' },
    { user: admin._id, shop: shopA._id, role: 'shop_admin' },
    { user: otherMechanic._id, shop: shopB._id, role: 'mechanic' }
  ]);

  await Part.create([
    {
      shop: shopA._id,
      sku: 'SCR-LAP-15',
      name: '15-inch Laptop LCD Screen',
      description: 'Replacement screen for common 15" laptops',
      category: 'display',
      quantityAvailable: 0,
      quantityReserved: 0,
      reorderLevel: 2,
      unitCost: 8500,
      supplier: 'DisplayCo Pakistan',
      supplierSku: 'DC-15-LCD'
    },
    {
      shop: shopA._id,
      sku: 'BAT-LAP-60',
      name: 'Laptop Battery 60Wh',
      category: 'power',
      quantityAvailable: 5,
      quantityReserved: 0,
      reorderLevel: 2,
      unitCost: 4500,
      supplier: 'PowerCell'
    },
    {
      shop: shopA._id,
      sku: 'KB-LAP-US',
      name: 'Laptop Keyboard US Layout',
      category: 'input',
      quantityAvailable: 3,
      quantityReserved: 0,
      reorderLevel: 1,
      unitCost: 2200,
      supplier: 'KeyWorks'
    },
    {
      shop: shopB._id,
      sku: 'SCR-LAP-15',
      name: '15-inch Laptop LCD Screen',
      description: 'Donor stock for inter-shop transfer demos',
      category: 'display',
      quantityAvailable: 4,
      quantityReserved: 0,
      reorderLevel: 1,
      unitCost: 8500,
      supplier: 'DisplayCo Pakistan',
      supplierSku: 'DC-15-LCD'
    }
  ]);

  return {
    seeded: true,
    customerId: customer._id,
    shopA: shopA.code,
    shopB: shopB.code
  };
}
