/**
 * Vercel-recognized Express entry (`src/server.ts`).
 * Same singleton as `src/index.ts` — do not create a second app instance.
 */
export { app as default } from './httpApp.js';
