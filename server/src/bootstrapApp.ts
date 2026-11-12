import { createApp, type CreateAppOptions } from './app.js';
import { connectDb } from './config/db.js';
import { initSentry } from './observability/sentry.js';
import type { Express } from 'express';

let readyPromise: Promise<void> | null = null;

/**
 * Cold-start safe bootstrap for serverless (Vercel) and persistent hosts.
 * Reuses mongoose connection when already connected (see connectDb).
 */
export function ensureDbReady(): Promise<void> {
  if (!readyPromise) {
    readyPromise = (async () => {
      await initSentry();
      await connectDb();
    })().catch((err) => {
      readyPromise = null;
      throw err;
    });
  }
  return readyPromise;
}

export function createBootstrappedApp(options: Omit<CreateAppOptions, 'ensureReady'> = {}): Express {
  return createApp({
    ...options,
    ensureReady: ensureDbReady
  });
}
