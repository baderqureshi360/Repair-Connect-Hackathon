/**
 * Re-exports the `src/app.ts` singleton.
 * Vercel selects `src/app.ts` first because that file imports Express.
 */
export { app as default } from './httpApp.js';
