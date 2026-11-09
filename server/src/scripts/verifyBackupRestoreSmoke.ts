/**
 * Non-destructive backup/restore smoke.
 * Prefer mongodump availability check + application-level round-trip of an isolated document.
 * Never drops production collections.
 *
 * Usage: npx tsx src/scripts/verifyBackupRestoreSmoke.ts
 */
import { execFileSync } from 'node:child_process';
import { connectDb, disconnectDb, getDbMode } from '../config/db.js';
import { env } from '../config/env.js';
import { RepairShop } from '../models/index.js';

function hasBin(bin: string) {
  try {
    execFileSync(bin, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (env.isProd) throw new Error('Refuse running this smoke under NODE_ENV=production.');
  await connectDb();
  if (getDbMode() !== 'atlas') throw new Error('Atlas required for backup smoke');

  const tools = {
    mongodump: hasBin('mongodump'),
    mongorestore: hasBin('mongorestore')
  };

  const stamp = Date.now();
  const shop = await RepairShop.create({
    name: `Backup Smoke ${stamp}`,
    code: `BK${String(stamp).slice(-6)}`,
    address: 'Backup Lane',
    city: 'Lahore',
    region: 'Punjab',
    phone: '+92-42-0',
    email: `backup.smoke.${stamp}@repairconnect.verify`,
    isActive: true
  });

  try {
    // Application-level durability check (simulates backup artifact integrity).
    const exported = shop.toObject();
    await RepairShop.deleteOne({ _id: shop._id });
    const missing = await RepairShop.findById(shop._id);
    if (missing) throw new Error('Expected document deleted before restore simulation');

    await RepairShop.create({
      ...exported,
      _id: shop._id
    });
    const restored = await RepairShop.findById(shop._id);
    if (!restored || restored.email !== shop.email) {
      throw new Error('Restore simulation failed');
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          dbMode: getDbMode(),
          tools,
          mode: 'mongoose-export-import-roundtrip',
          atlasCloudBackupRequired: true,
          verifiedShopId: String(shop._id),
          guidance: 'Enable Atlas Cloud Backup in production; see docs/BACKUP_RESTORE.md'
        },
        null,
        2
      )
    );
  } finally {
    await RepairShop.deleteOne({ _id: shop._id, email: /@repairconnect\.verify$/i });
    await disconnectDb();
  }
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
