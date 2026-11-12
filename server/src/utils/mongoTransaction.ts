import mongoose, { type ClientSession } from 'mongoose';
import { AppError } from './errors.js';

const TRANSIENT = new Set([
  'TransientTransactionError',
  'UnknownTransactionCommitResult',
  'WriteConflict'
]);

function errorLabels(err: unknown): Set<string> {
  const labels = (err as { errorLabels?: string[] })?.errorLabels;
  return new Set(Array.isArray(labels) ? labels : []);
}

function isTransientTxnError(err: unknown): boolean {
  const labels = errorLabels(err);
  if ([...labels].some((l) => TRANSIENT.has(l))) return true;
  const code = (err as { code?: number }).code;
  // 112 = WriteConflict
  if (code === 112) return true;
  const msg = String((err as Error)?.message || err || '');
  // mongodb-memory-server under parallel Vitest workers can briefly fail lock acquisition
  return /Unable to acquire \w+ lock/i.test(msg) || /LockTimeout/i.test(msg);
}

function isTransactionUnsupported(err: unknown): boolean {
  const msg = String((err as Error)?.message || err || '');
  const code = (err as { code?: number }).code;
  // 20 = IllegalOperation (transactions require replica set)
  return (
    code === 20 ||
    /transaction numbers are only allowed/i.test(msg) ||
    /Transaction numbers are only allowed/i.test(msg) ||
    /replica set/i.test(msg) && /transaction/i.test(msg)
  );
}

/**
 * Run work inside a MongoDB multi-document transaction.
 * Retries transient write conflicts. Never falls back to non-transactional execution.
 */
export async function withMongoTransaction<T>(
  work: (session: ClientSession) => Promise<T>,
  opts?: { maxRetries?: number }
): Promise<T> {
  const maxRetries = opts?.maxRetries ?? 8;
  const session = await mongoose.startSession();
  let attempt = 0;
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      attempt += 1;
      try {
        let result!: T;
        await session.withTransaction(
          async () => {
            result = await work(session);
          },
          {
            readConcern: { level: 'snapshot' },
            writeConcern: { w: 'majority' },
            readPreference: 'primary'
          }
        );
        return result;
      } catch (err) {
        if (isTransactionUnsupported(err)) {
          throw new AppError(
            'Atomic payments require MongoDB transactions (replica set / Atlas). Refusing non-atomic fallback.',
            503,
            'TRANSACTIONS_REQUIRED',
            { cause: String((err as Error)?.message || err) }
          );
        }
        if (err instanceof AppError) throw err;
        if (isTransientTxnError(err) && attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 25 * attempt));
          continue;
        }
        throw err;
      }
    }
  } finally {
    await session.endSession();
  }
}

export type { ClientSession };
