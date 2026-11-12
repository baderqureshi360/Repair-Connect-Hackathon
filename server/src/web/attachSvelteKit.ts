import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Express, RequestHandler } from 'express';
import { env } from '../config/env.js';

export type SvelteKitHandlerModule = {
  handler: RequestHandler;
};

/**
 * Resolve adapter-node output relative to the monorepo root.
 * Works from tsx (src/) and compiled dist/.
 */
export function resolveClientHandlerPath(rootDir = env.rootDir): string {
  return path.join(rootDir, 'client', 'build', 'handler.js');
}

/**
 * Dynamically import adapter-node `handler.js` and mount it last on the Express app.
 * Does not start the standalone adapter-node HTTP server.
 */
export async function attachSvelteKitHandler(app: Express): Promise<boolean> {
  const handlerPath = resolveClientHandlerPath();
  if (!fs.existsSync(handlerPath)) {
    if (env.isProd && process.env.SERVE_WEB === 'true') {
      throw new Error(
        `[server] FATAL: SERVE_WEB=true but missing ${handlerPath}. Run: npm run build -w client`
      );
    }
    console.warn(`[server] SvelteKit handler not found at ${handlerPath} — API-only mode`);
    return false;
  }

  const mod = (await import(pathToFileURL(handlerPath).href)) as SvelteKitHandlerModule;
  if (typeof mod.handler !== 'function') {
    throw new Error(`[server] FATAL: ${handlerPath} did not export a handler function`);
  }

  app.use(mod.handler);
  console.log(`[server] SvelteKit handler mounted from ${handlerPath}`);
  return true;
}
