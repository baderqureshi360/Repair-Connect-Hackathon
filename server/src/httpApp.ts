import { createBootstrappedApp } from './bootstrapApp.js';

/** Singleton Express application used by Vercel export and persistent listen. */
export const app = createBootstrappedApp();
