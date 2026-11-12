import { env } from './config/env.js';
import { app } from './httpApp.js';
import { ensureDbReady } from './bootstrapApp.js';
import { connectDb, disconnectDb, getDbMode } from './config/db.js';
import { seedDatabase } from './scripts/seedData.js';
import { startOutboxProcessor } from './services/outbox.js';
import { attachSvelteKitHandler } from './web/attachSvelteKit.js';
import type { Server } from 'node:http';

const isVercel = Boolean(process.env.VERCEL);

/**
 * Shared Express app for:
 * - Vercel (default export — no listen / no outbox interval)
 * - Persistent hosts (listen + optional SvelteKit mount + outbox interval)
 */
export default app;

async function main() {
  if (isVercel) {
    // Vercel loads this module and uses `export default app`.
    // Do not call listen() or start setInterval outbox here.
    console.log('[server] Vercel mode: exporting Express app (serverless)');
    return;
  }

  await ensureDbReady();
  const { mode } = await connectDb();

  if (env.isProd) {
    if (mode !== 'atlas') {
      throw new Error('[server] FATAL: Production must use Atlas/remote MongoDB.');
    }
    console.log('[server] Production mode: seed disabled, memory DB disabled');
  } else if (env.allowAutoSeedMemory || env.seedOnStart) {
    const result = await seedDatabase({ clear: env.allowAutoSeedMemory && !env.seedOnStart });
    console.log('[seed]', result);
  }

  const serveWeb = process.env.SERVE_WEB !== 'false';
  if (serveWeb) {
    await attachSvelteKitHandler(app);
  } else {
    console.log('[server] SERVE_WEB=false — API-only mode');
  }

  // Persistent process only — incompatible with idle serverless instances.
  startOutboxProcessor(env.isProd ? 3000 : 4000);

  const host = process.env.HOST || '0.0.0.0';
  const server: Server = app.listen(env.port, host, () => {
    console.log(`[server] RepairConnect on http://${host}:${env.port}`);
    console.log(`[server] DB mode: ${getDbMode()}`);
    console.log(`[server] Swagger docs at http://${host}:${env.port}/api/docs`);
    console.log('[server] Outbox processor started');
  });

  let shuttingDown = false;
  async function gracefulShutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] ${signal} received — graceful shutdown`);
    const forceTimer = setTimeout(() => {
      console.error('[server] Forced exit after shutdown timeout');
      process.exit(1);
    }, 15_000);
    forceTimer.unref();

    server.close(async (err) => {
      if (err) console.error('[server] HTTP close error', err);
      try {
        await disconnectDb();
        console.log('[server] DB disconnected');
      } catch (e) {
        console.error('[server] DB disconnect error', e);
      }
      process.exit(err ? 1 : 0);
    });
  }

  process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});
