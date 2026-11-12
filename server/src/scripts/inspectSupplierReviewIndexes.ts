/**
 * Inspect SupplierReview collection indexes and review record shape on Atlas.
 * Usage: npx tsx src/scripts/inspectSupplierReviewIndexes.ts
 */
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { connectDb, disconnectDb, getDbMode } from '../config/db.js';

async function main() {
  await connectDb();
  console.log(`[inspect] dbMode=${getDbMode()} uriConfigured=${Boolean(env.mongodbUri)}`);

  const col = mongoose.connection.db!.collection('supplierreviews');
  const indexes = await col.indexes();
  console.log('INDEXES:', JSON.stringify(indexes, null, 2));

  const count = await col.countDocuments();
  console.log('COUNT:', count);

  const missingPo = await col.countDocuments({
    $or: [{ purchaseOrder: { $exists: false } }, { purchaseOrder: null }]
  });
  console.log('MISSING_PO:', missingPo);

  const missingShopOrSupplier = await col.countDocuments({
    $or: [
      { shop: { $exists: false } },
      { shop: null },
      { supplierBusiness: { $exists: false } },
      { supplierBusiness: null }
    ]
  });
  console.log('MISSING_SHOP_OR_SUPPLIER:', missingShopOrSupplier);

  const sample = await col
    .find({})
    .project({
      publicId: 1,
      supplierBusiness: 1,
      shop: 1,
      purchaseOrder: 1,
      purchaseOrderPublicId: 1,
      status: 1,
      isVerified: 1,
      isGenuine: 1
    })
    .limit(10)
    .toArray();
  console.log('SAMPLE:', JSON.stringify(sample, null, 2));

  const dupPo = await col
    .aggregate([
      { $match: { purchaseOrder: { $exists: true, $ne: null } } },
      { $group: { _id: '$purchaseOrder', n: { $sum: 1 }, ids: { $push: '$_id' } } },
      { $match: { n: { $gt: 1 } } }
    ])
    .toArray();
  console.log('DUP_PO:', JSON.stringify(dupPo, null, 2));

  const legacyShopSupplier = indexes.find(
    (idx) =>
      idx.key &&
      Object.keys(idx.key).length === 2 &&
      idx.key.supplierBusiness === 1 &&
      idx.key.shop === 1 &&
      idx.unique
  );
  console.log('LEGACY_UNIQUE_SHOP_SUPPLIER:', legacyShopSupplier ? JSON.stringify(legacyShopSupplier) : 'none');

  const poUnique = indexes.find(
    (idx) => idx.key && idx.key.purchaseOrder === 1 && Object.keys(idx.key).length === 1 && idx.unique
  );
  console.log('PO_UNIQUE:', poUnique ? JSON.stringify(poUnique) : 'none');

  await disconnectDb();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await disconnectDb();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
