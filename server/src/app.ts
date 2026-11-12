import express, { type Express, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmetModule from 'helmet';
import { contentSecurityPolicy } from 'helmet';
import type { HelmetOptions } from 'helmet';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.js';
import { getDbMode } from './config/db.js';
import { errorHandler } from './middleware/errorHandler.js';
import { csrfProtection } from './middleware/csrf.js';
import { fail, ok } from './utils/response.js';
import { processOutboxBatch } from './services/outbox.js';
import { swaggerSpec } from './swagger.js';
import authRoutes from './routes/auth.js';
import shopRoutes from './routes/shops.js';
import repairRoutes from './routes/repairs.js';
import partsRoutes from './routes/parts.js';
import notificationRoutes from './routes/notifications.js';
import appointmentRoutes from './routes/appointments.js';
import supplierRoutes from './routes/suppliers.js';
import transferRoutes from './routes/transfers.js';
import reportRoutes from './routes/reports.js';
import analyticsRoutes from './routes/analytics.js';
import documentsRoutes from './routes/documents.js';
import searchRoutes from './routes/search.js';
import publicRoutes from './routes/public.js';
import shopApplicationRoutes from './routes/shopApplications.js';
import platformShopApplicationRoutes from './routes/platformShopApplications.js';
import platformSupplierApplicationRoutes from './routes/platformSupplierApplications.js';
import platformSupplierReviewRoutes from './routes/platformSupplierReviews.js';
import supplierApplicationRoutes from './routes/supplierApplications.js';
import supplierPortalRoutes from './routes/supplierPortal.js';
import marketplaceSupplierRoutes from './routes/marketplaceSuppliers.js';
import supplierNetworkRoutes from './routes/supplierNetwork.js';
import { createBootstrappedApp } from './bootstrapApp.js';

/**
 * Helmet 8 is a dual package (`import` → index.mjs, `require` → index.cjs) with
 * `"types": "./index.d.cts"` and no `exports.types` condition. Under `moduleResolution:
 * NodeNext`, TypeScript often types the default binding as `typeof import("helmet")`
 * (a non-callable namespace) → TS2349. Runtime ESM default is the callable middleware.
 */
const helmet = helmetModule as unknown as ((options?: Readonly<HelmetOptions>) => RequestHandler) & {
  contentSecurityPolicy: typeof contentSecurityPolicy;
};

export type CreateAppOptions = {
  /** Optional web handler (adapter-node or test stub). Mounted after API routes. */
  webHandler?: RequestHandler;
  /** Awaited before handling requests (Mongo connect / Sentry on serverless cold start). */
  ensureReady?: () => Promise<void>;
};

function buildCspDirectives() {
  const client = env.clientUrl;
  return {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:'],
    connectSrc: ["'self'", client],
    fontSrc: ["'self'", 'data:'],
    objectSrc: ["'none'"],
    frameSrc: ["'none'"],
    frameAncestors: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'", client],
    upgradeInsecureRequests: env.isProd ? ([] as string[]) : null
  };
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();

  app.set('trust proxy', 1);

  if (options.ensureReady) {
    const ensureReady = options.ensureReady;
    app.use(async (_req, _res, next) => {
      try {
        await ensureReady();
        next();
      } catch (err) {
        next(err);
      }
    });
  }

  // Shared security headers for all responses. CSP is API-only so SvelteKit kit.csp
  // (and hooks.server.ts) remain authoritative for HTML.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      referrerPolicy: { policy: 'no-referrer' }
    })
  );

  if (env.isProd) {
    app.use(
      '/api',
      helmet.contentSecurityPolicy({
        useDefaults: true,
        directives: buildCspDirectives()
      })
    );
  }

  const allowedOrigins = new Set(
    [env.clientUrl, process.env.CLIENT_URL_ALT].filter(Boolean) as string[]
  );

  app.use(
    cors({
      origin(origin, callback) {
        // Allow non-browser / same-origin tooling (no Origin header).
        if (!origin || allowedOrigins.has(origin)) {
          return callback(null, true);
        }
        return callback(null, false);
      },
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'Idempotency-Key'],
      exposedHeaders: ['X-Request-Id']
    })
  );

  app.use(cookieParser());

  // JSON body parsing and double-submit CSRF apply to the API only so SvelteKit
  // form/body handling is not interfered with.
  app.use('/api', express.json({ limit: '2mb' }));
  app.use('/api', csrfProtection);

  // Production: combined access logs without response bodies. Never log Authorization/cookies.
  app.use(
    morgan(env.nodeEnv === 'test' ? 'tiny' : env.isProd ? 'combined' : 'dev', {
      skip: (req) => req.path === '/health' || req.path === '/ready'
    })
  );

  app.get('/health', (_req, res) => {
    res.json({
      success: true,
      data: {
        status: 'ok',
        service: 'repairconnect-api',
        env: env.nodeEnv,
        dbMode: getDbMode()
      }
    });
  });

  /** Readiness: process up + Mongo connected (for load balancers / orchestrators). */
  app.get('/ready', (_req, res) => {
    const dbMode = getDbMode();
    if (dbMode === 'disconnected') {
      return res.status(503).json({
        success: false,
        error: { message: 'Database not ready', code: 'NOT_READY' },
        data: { status: 'not_ready', dbMode }
      });
    }
    return res.json({
      success: true,
      data: {
        status: 'ready',
        service: 'repairconnect-api',
        env: env.nodeEnv,
        dbMode
      }
    });
  });

  // Swagger UI needs relaxed CSP on its own mount in production.
  app.use(
    '/api/docs',
    (_req: Request, res: Response, next: NextFunction) => {
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"
      );
      next();
    },
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, { explorer: true })
  );
  app.get('/api/docs.json', (_req, res) => res.json(swaggerSpec));

  app.use('/api/v1/public', publicRoutes);
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/shop-applications', shopApplicationRoutes);
  app.use('/api/v1/platform/shop-applications', platformShopApplicationRoutes);
  app.use('/api/v1/platform/supplier-applications', platformSupplierApplicationRoutes);
  app.use('/api/v1/platform/supplier-reviews', platformSupplierReviewRoutes);
  app.use('/api/v1/supplier-applications', supplierApplicationRoutes);
  app.use('/api/v1/supplier', supplierPortalRoutes);
  app.use('/api/v1/marketplace/suppliers', marketplaceSupplierRoutes);
  app.use('/api/v1/supplier-network', supplierNetworkRoutes);
  app.use('/api/v1/shops', shopRoutes);
  app.use('/api/v1/repairs', repairRoutes);
  app.use('/api/v1/parts', partsRoutes);
  app.use('/api/v1/notifications', notificationRoutes);
  app.use('/api/v1/appointments', appointmentRoutes);
  app.use('/api/v1/suppliers', supplierRoutes);
  app.use('/api/v1/transfers', transferRoutes);
  app.use('/api/v1/reports', reportRoutes);
  app.use('/api/v1/analytics', analyticsRoutes);
  app.use('/api/v1/documents', documentsRoutes);
  app.use('/api/v1/search', searchRoutes);

  /**
   * Vercel Cron (and manual ops) drain for transactional outbox.
   * Auth: Authorization Bearer CRON_SECRET (also skips CSRF via Bearer rule).
   * Serverless hosts must not rely on setInterval — see startOutboxProcessor gate.
   */
  app.post('/api/cron/outbox', async (req, res, next) => {
    try {
      const secret = (process.env.CRON_SECRET || '').trim();
      const auth = String(req.headers.authorization || '');
      if (!secret || auth !== `Bearer ${secret}`) {
        return fail(res, 'Unauthorized', 401, 'UNAUTHORIZED');
      }
      const delivered = await processOutboxBatch();
      return ok(res, { delivered });
    } catch (err) {
      return next(err);
    }
  });

  // Unknown API routes must not fall through to SvelteKit HTML.
  app.use('/api', (_req, res) => {
    return fail(res, 'Not found', 404, 'NOT_FOUND');
  });

  app.use(errorHandler);

  if (options.webHandler) {
    app.use(options.webHandler);
  }

  return app;
}

/**
 * Vercel Express entry detection prefers `src/app.ts` (it imports `express`) over
 * `src/index.ts` and `src/server.ts`. The default export must be this Express app.
 * One singleton: persistent `index.ts` re-exports it and is the only place that calls listen().
 */
export const app = createBootstrappedApp();
export default app;
