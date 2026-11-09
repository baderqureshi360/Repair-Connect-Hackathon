import { env } from './config/env.js';
import { createApp } from './app.js';
import { connectDb, getDbMode } from './config/db.js';
import { seedDatabase } from './scripts/seedData.js';
import { startOutboxProcessor } from './services/outbox.js';

async function main() {
  const { mode } = await connectDb();

  if (env.isProd) {
    if (mode !== 'atlas') {
      throw new Error('[server] FATAL: Production must use Atlas/remote MongoDB.');
    }
    console.log('[server] Production mode: seed disabled, memory DB disabled');
  } else if (env.allowAutoSeedMemory || env.seedOnStart) {
    // Demo seed only outside production, and only when explicitly opted in
    const result = await seedDatabase({ clear: env.allowAutoSeedMemory && !env.seedOnStart });
    console.log('[seed]', result);
  }

  const app = createApp();
  startOutboxProcessor(env.isProd ? 3000 : 4000);
  app.listen(env.port, () => {
    console.log(`[server] RepairConnect API on http://localhost:${env.port}`);
    console.log(`[server] DB mode: ${getDbMode()}`);
    console.log(`[server] Swagger docs at http://localhost:${env.port}/api/docs`);
    console.log('[server] Outbox processor started');
  });
}

main().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});
