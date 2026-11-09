import { env } from '../config/env.js';
import { connectDb, disconnectDb, getDbMode } from '../config/db.js';
import { seedDatabase } from './seedData.js';

async function seed() {
  if (env.isProd) {
    throw new Error('[seed] FATAL: Demo seeding is forbidden in production.');
  }
  console.log(`[seed] envFile=${env.envFile || 'none'} dbTarget=${env.useMemoryDb ? 'memory' : 'atlas'}`);
  if (!env.useMemoryDb && !env.mongodbUri) {
    throw new Error(
      'Atlas mode requires MONGODB_URI. Set it in the monorepo root .env and USE_MEMORY_DB=false.'
    );
  }

  await connectDb();
  console.log(`[seed] connected mode=${getDbMode()}`);
  const result = await seedDatabase({ clear: true });
  console.log('Seed complete.', result);
  console.log('Accounts (password: Password123!):');
  console.log('  customer@repairconnect.local');
  console.log('  mechanic@repairconnect.local');
  console.log('  parts@repairconnect.local');
  console.log('  admin@repairconnect.local');
  await disconnectDb();
}

seed().catch(async (err) => {
  console.error(err);
  try {
    await disconnectDb();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
