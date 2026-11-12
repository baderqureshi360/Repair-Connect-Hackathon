import type { Express, ErrorRequestHandler } from 'express';
import { env } from '../config/env.js';

let initialized = false;

/**
 * Optional Sentry for the Express API.
 * No-ops when SENTRY_DSN is unset — safe for local/dev without monitoring.
 * Never put DSNs in source control.
 */
export async function initSentry(): Promise<boolean> {
  if (initialized) return true;
  if (!env.sentryDsn) {
    if (env.isProd) {
      console.warn('[sentry] SENTRY_DSN unset — production exception monitoring disabled');
    }
    return false;
  }

  const Sentry = await import('@sentry/node');
  Sentry.init({
    dsn: env.sentryDsn,
    environment: env.sentryEnvironment,
    tracesSampleRate: Number.isFinite(env.sentryTracesSampleRate) ? env.sentryTracesSampleRate : 0,
    beforeSend(event) {
      // Strip cookies / auth headers if present on request contexts
      if (event.request) {
        delete event.request.cookies;
        if (event.request.headers) {
          const h = { ...event.request.headers };
          for (const key of Object.keys(h)) {
            if (/authorization|cookie|x-csrf|set-cookie/i.test(key)) {
              delete h[key];
            }
          }
          event.request.headers = h;
        }
      }
      return event;
    }
  });
  initialized = true;
  console.log(`[sentry] initialized env=${env.sentryEnvironment}`);
  return true;
}

export async function setupSentryExpress(app: Express): Promise<void> {
  if (!(await initSentry())) return;
  const Sentry = await import('@sentry/node');
  Sentry.setupExpressErrorHandler(app);
}

export function sentryErrorBridge(): ErrorRequestHandler {
  return (err, _req, _res, next) => {
    if (initialized) {
      void import('@sentry/node').then((Sentry) => {
        Sentry.captureException(err);
      });
    }
    next(err);
  };
}

export async function captureTestException(message: string): Promise<string | null> {
  if (!(await initSentry())) {
    throw new Error('SENTRY_DSN is not configured');
  }
  const Sentry = await import('@sentry/node');
  const eventId = Sentry.captureException(new Error(message));
  await Sentry.flush(5000);
  return eventId;
}
