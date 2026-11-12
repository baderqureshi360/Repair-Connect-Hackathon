/**
 * Send an intentional test exception to Sentry (verifies DSN wiring).
 *
 *   SENTRY_DSN=https://...@o....ingest.sentry.io/... npm run monitor:smoke -w server
 *
 * Does not start the HTTP server. Does not log the DSN.
 */
import { captureTestException } from '../observability/sentry.js';

async function main() {
  const marker = `repairconnect-monitor-smoke-${Date.now()}`;
  const eventId = await captureTestException(
    `[RepairConnect] intentional monitoring smoke: ${marker}`
  );
  console.log(
    JSON.stringify(
      {
        success: true,
        eventId,
        marker,
        note: 'Confirm this event appears in the Sentry project Issues feed within ~1 minute.'
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error('[monitor:smoke] FAIL', err instanceof Error ? err.message : err);
  process.exit(1);
});
