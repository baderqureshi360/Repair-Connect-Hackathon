/**
 * Safe backfill: assign serviceCategories only when a shop has none yet,
 * using description / supportedDevices / historical repair deviceType hints.
 * Does NOT invent ratings or fabricate shops. Does NOT set RepairRequest.source.
 *
 * Usage: npx tsx src/scripts/backfillShopCategories.ts
 */
import { connectDb, disconnectDb } from '../config/db.js';
import { RepairRequest, RepairShop } from '../models/index.js';
import { SERVICE_CATEGORIES, type ServiceCategoryId } from '../constants/serviceCategories.js';

function inferFromText(text: string): ServiceCategoryId[] {
  const lower = text.toLowerCase();
  const found = new Set<ServiceCategoryId>();
  for (const cat of SERVICE_CATEGORIES) {
    if (cat.deviceHints.some((h) => lower.includes(h))) found.add(cat.id);
  }
  return [...found];
}

async function main() {
  await connectDb();
  const shops = await RepairShop.find({
    $or: [{ serviceCategories: { $exists: false } }, { serviceCategories: { $size: 0 } }]
  });

  let updated = 0;
  for (const shop of shops) {
    const deviceTypes = await RepairRequest.distinct('deviceType', { shop: shop._id });
    const inferred = new Set<ServiceCategoryId>([
      ...inferFromText([shop.description, shop.name, ...(shop.supportedDevices || [])].join(' ')),
      ...inferFromText(deviceTypes.join(' '))
    ]);

    // Only write when we have a real signal from shop copy or actual repairs.
    if (inferred.size === 0) continue;

    shop.serviceCategories = [...inferred];
    if (!shop.supportedDevices?.length && deviceTypes.length) {
      shop.supportedDevices = deviceTypes.map(String).filter(Boolean).slice(0, 20);
    }
    await shop.save();
    updated += 1;
    console.log(`[backfill] ${shop.code}: ${[...inferred].join(', ')}`);
  }

  console.log(`[backfill] done. shops updated=${updated} scanned=${shops.length}`);
  await disconnectDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
