/**
 * Safe, idempotent Atlas migration for SupplierReview uniqueness.
 *
 * Goal:
 *   - Keep unique one-review-per-PO index (`one_review_per_po` on `{ purchaseOrder: 1 }`).
 *   - Drop legacy unique `{ supplierBusiness: 1, shop: 1 }` which incorrectly blocks
 *     multiple verified reviews from the same shop across different POs.
 *   - Never delete review documents.
 *   - Abort if records are incompatible (missing purchaseOrder, or duplicate POs).
 *
 * Usage:
 *   npm run migrate:supplier-review-indexes -w server
 *
 * Dry-run (inspect only):
 *   npm run migrate:supplier-review-indexes -w server -- --dry-run
 */
import mongoose from 'mongoose';
import { connectDb, disconnectDb, getDbMode } from '../config/db.js';

const LEGACY_UNIQUE_NAME = 'supplierBusiness_1_shop_1';
const PO_UNIQUE_NAME = 'one_review_per_po';
const REDUNDANT_PO_NONUNIQUE = 'purchaseOrder_1';

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

async function main() {
  const dryRun = hasFlag('--dry-run');
  await connectDb();
  console.log(`[migrate:supplier-reviews] dbMode=${getDbMode()} dryRun=${dryRun}`);

  const col = mongoose.connection.db!.collection('supplierreviews');
  const before = await col.indexes();
  console.log('[migrate] indexes BEFORE:', JSON.stringify(before, null, 2));

  const total = await col.countDocuments();
  const missingPo = await col.countDocuments({
    $or: [{ purchaseOrder: { $exists: false } }, { purchaseOrder: null }]
  });
  const dupPo = await col
    .aggregate([
      { $match: { purchaseOrder: { $ne: null } } },
      { $group: { _id: '$purchaseOrder', n: { $sum: 1 }, ids: { $push: '$_id' } } },
      { $match: { n: { $gt: 1 } } }
    ])
    .toArray();

  console.log(`[migrate] reviewCount=${total} missingPurchaseOrder=${missingPo} duplicatePoGroups=${dupPo.length}`);

  if (missingPo > 0) {
    const samples = await col
      .find({ $or: [{ purchaseOrder: { $exists: false } }, { purchaseOrder: null }] })
      .project({ _id: 1, publicId: 1, supplierBusiness: 1, shop: 1, status: 1 })
      .limit(20)
      .toArray();
    console.error(
      '[migrate] ABORT: incompatible historical reviews lack purchaseOrder. Not deleting. Samples:',
      JSON.stringify(samples, null, 2)
    );
    await disconnectDb();
    process.exit(2);
  }

  if (dupPo.length > 0) {
    console.error(
      '[migrate] ABORT: duplicate purchaseOrder values block unique index. Not deleting. Groups:',
      JSON.stringify(dupPo, null, 2)
    );
    await disconnectDb();
    process.exit(2);
  }

  const hasPoUnique = before.some(
    (idx) =>
      idx.name === PO_UNIQUE_NAME ||
      (idx.unique &&
        idx.key &&
        Object.keys(idx.key).length === 1 &&
        (idx.key as { purchaseOrder?: number }).purchaseOrder === 1)
  );

  if (!hasPoUnique) {
    if (dryRun) {
      console.log(`[migrate] dry-run: would create unique index ${PO_UNIQUE_NAME}`);
    } else {
      console.log(`[migrate] creating unique index ${PO_UNIQUE_NAME}`);
      await col.createIndex({ purchaseOrder: 1 }, { unique: true, name: PO_UNIQUE_NAME, background: true });
    }
  } else {
    console.log(`[migrate] unique PO index already present — skip create`);
  }

  const legacy = before.find(
    (idx) =>
      idx.name === LEGACY_UNIQUE_NAME ||
      (idx.unique &&
        idx.key &&
        Object.keys(idx.key).length === 2 &&
        (idx.key as { supplierBusiness?: number }).supplierBusiness === 1 &&
        (idx.key as { shop?: number }).shop === 1)
  );

  if (legacy) {
    if (dryRun) {
      console.log(`[migrate] dry-run: would drop legacy unique index ${legacy.name}`);
    } else {
      console.log(`[migrate] dropping legacy unique index ${legacy.name}`);
      await col.dropIndex(legacy.name!);
    }
  } else {
    console.log('[migrate] legacy unique {supplierBusiness, shop} already absent — skip drop');
  }

  // Redundant non-unique purchaseOrder_1 is covered by one_review_per_po; drop if both exist.
  const afterCreate = dryRun ? before : await col.indexes();
  const hasNamedPoUnique = afterCreate.some((idx) => idx.name === PO_UNIQUE_NAME && idx.unique);
  const hasRedundant = afterCreate.some((idx) => idx.name === REDUNDANT_PO_NONUNIQUE && !idx.unique);
  if (hasNamedPoUnique && hasRedundant) {
    if (dryRun) {
      console.log(`[migrate] dry-run: would drop redundant non-unique ${REDUNDANT_PO_NONUNIQUE}`);
    } else {
      console.log(`[migrate] dropping redundant non-unique ${REDUNDANT_PO_NONUNIQUE}`);
      await col.dropIndex(REDUNDANT_PO_NONUNIQUE);
    }
  }

  const after = dryRun ? before : await col.indexes();
  console.log('[migrate] indexes AFTER:', JSON.stringify(after, null, 2));

  const legacyStill = after.find(
    (idx) =>
      idx.unique &&
      idx.key &&
      Object.keys(idx.key).length === 2 &&
      (idx.key as { supplierBusiness?: number }).supplierBusiness === 1 &&
      (idx.key as { shop?: number }).shop === 1
  );
  const poUniqueStill = after.find(
    (idx) =>
      idx.unique &&
      idx.key &&
      Object.keys(idx.key).length === 1 &&
      (idx.key as { purchaseOrder?: number }).purchaseOrder === 1
  );

  if (!dryRun) {
    if (legacyStill) {
      console.error('[migrate] FAIL: legacy unique shop+supplier index still present');
      await disconnectDb();
      process.exit(1);
    }
    if (!poUniqueStill) {
      console.error('[migrate] FAIL: unique purchaseOrder index missing after migration');
      await disconnectDb();
      process.exit(1);
    }
  }

  console.log(
    dryRun
      ? 'SUPPLIER_REVIEW_INDEX_MIGRATE_DRY_RUN_OK'
      : 'SUPPLIER_REVIEW_INDEX_MIGRATE_PASSED'
  );
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
