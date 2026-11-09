import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.js';
import { getDbMode } from './config/db.js';
import { errorHandler } from './middleware/errorHandler.js';
import { csrfProtection } from './middleware/csrf.js';
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

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: env.isProd
        ? {
            useDefaults: true,
            directives: buildCspDirectives()
          }
        : false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      referrerPolicy: { policy: 'no-referrer' }
    })
  );

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

  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use(csrfProtection);
  // Production: combined access logs without response bodies. Never log Authorization/cookies.
  app.use(
    morgan(env.nodeEnv === 'test' ? 'tiny' : env.isProd ? 'combined' : 'dev', {
      skip: (req) => req.path === '/health'
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

  app.use(errorHandler);
  return app;
}
