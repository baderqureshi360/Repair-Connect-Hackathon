/**
 * Isolated backup → restore probe for Phase 6.
 *
 * Uses a dedicated database name (never the production `repairconnect` DB).
 * Does NOT run mongodump against production. Safe to run with Atlas credentials
 * that can create a temporary database on the same cluster.
 *
 * Usage:
 *   npx tsx src/scripts/probeBackupRestore.ts
 *
 * Env:
 *   MONGODB_URI — Atlas/remote URI (required unless USE_MEMORY_DB=true)
 *   BACKUP_PROBE_DB — override DB name (default: repairconnect_p6_backup_probe)
 */
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { redactMongoUri } from '../config/loadEnv.js';

const PROBE_DB = (process.env.BACKUP_PROBE_DB || 'repairconnect_p6_backup_probe').trim();
const FORBIDDEN = new Set(['repairconnect', 'admin', 'local', 'config']);

async function main() {
  if (FORBIDDEN.has(PROBE_DB.toLowerCase())) {
    throw new Error(
      `[backup-probe] Refusing to use protected database name "${PROBE_DB}". Choose an isolated probe DB.`
    );
  }
  if (!env.mongodbUri && !env.useMemoryDb) {
    throw new Error('[backup-probe] MONGODB_URI required (or USE_MEMORY_DB=true for local memory probe).');
  }

  const uri = env.useMemoryDb
    ? (
        await (async () => {
          const { MongoMemoryReplSet } = await import('mongodb-memory-server');
          const rs = await MongoMemoryReplSet.create({
            replSet: { count: 1, storageEngine: 'wiredTiger' }
          });
          (globalThis as { __p6ProbeRs?: typeof rs }).__p6ProbeRs = rs;
          return rs.getUri(PROBE_DB);
        })()
      )
    : env.mongodbUri;

  console.log(`[backup-probe] Connecting ${redactMongoUri(uri || '')} db=${PROBE_DB}`);
  await mongoose.connect(uri!, { dbName: PROBE_DB });
  const db = mongoose.connection.db!;
  if (db.databaseName !== PROBE_DB) {
    throw new Error(`[backup-probe] Connected to unexpected DB ${db.databaseName}`);
  }

  const probeId = `p6-probe-${Date.now()}`;
  const sourceCol = db.collection('p6_backup_source');
  const archiveCol = db.collection('p6_backup_archive');
  const restoreCol = db.collection('p6_backup_restored');

  await sourceCol.deleteMany({});
  await archiveCol.deleteMany({});
  await restoreCol.deleteMany({});

  const docs = [
    { probeId, kind: 'payment', amount: -1000, note: 'cash' },
    { probeId, kind: 'credit_note', amount: -500, note: 'not cash' },
    { probeId, kind: 'goods_received', amount: 1500, note: 'grn' }
  ];
  await sourceCol.insertMany(docs);

  // Backup: copy source → archive (stand-in for mongodump snapshot of this isolated DB)
  const snapshot = await sourceCol.find({ probeId }).toArray();
  expect(snapshot.length === 3, 'backup source count');
  await archiveCol.insertMany(snapshot.map(({ _id, ...rest }) => rest));

  // Simulate disaster: wipe source
  await sourceCol.deleteMany({ probeId });
  expect((await sourceCol.countDocuments({ probeId })) === 0, 'source wiped');

  // Restore: archive → restore collection, then back into source
  const archived = await archiveCol.find({ probeId }).toArray();
  expect(archived.length === 3, 'archive count');
  await restoreCol.insertMany(archived.map(({ _id, ...rest }) => rest));
  const restored = await restoreCol.find({ probeId }).toArray();
  await sourceCol.insertMany(restored.map(({ _id, ...rest }) => rest));

  const after = await sourceCol.find({ probeId }).sort({ kind: 1 }).toArray();
  expect(after.length === 3, 'restored count');
  const cash = after.find((d) => d.kind === 'payment');
  const credit = after.find((d) => d.kind === 'credit_note');
  expect(cash?.amount === -1000, 'payment amount');
  expect(credit?.amount === -500, 'credit note amount');
  expect(cash?.note === 'cash' && credit?.note === 'not cash', 'kind labels preserved');

  // Cleanup isolated probe data (drop only the probe DB collections we created)
  await sourceCol.drop().catch(() => undefined);
  await archiveCol.drop().catch(() => undefined);
  await restoreCol.drop().catch(() => undefined);

  console.log('[backup-probe] PASS — isolated backup and restore verified');
  console.log(
    JSON.stringify(
      {
        success: true,
        database: PROBE_DB,
        productionDbTouched: false,
        documentsRestored: 3,
        note: 'Operational Atlas backups still rely on Atlas Continuous Backup / snapshots; this probe validates restore mechanics on an isolated DB only.'
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
  const rs = (globalThis as { __p6ProbeRs?: { stop: () => Promise<void> } }).__p6ProbeRs;
  if (rs) await rs.stop();
}

function expect(cond: boolean, label: string) {
  if (!cond) throw new Error(`[backup-probe] Assertion failed: ${label}`);
}

main().catch(async (err) => {
  console.error('[backup-probe] FAIL', err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
