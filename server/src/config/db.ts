import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { env } from './env.js';
import { redactMongoUri } from './loadEnv.js';

let memoryReplSet: MongoMemoryReplSet | null = null;

export async function connectDb(): Promise<{ uri: string; mode: 'atlas' | 'memory' }> {
  if (mongoose.connection.readyState === 1) {
    return {
      uri: env.mongodbUri || 'memory',
      mode: env.useMemoryDb ? 'memory' : 'atlas'
    };
  }

  if (env.isProd && env.useMemoryDb) {
    throw new Error('[db] FATAL: Refusing to start with in-memory database in production.');
  }

  // Hard guard: never silently use memory when Atlas mode was selected
  if (!env.useMemoryDb && !env.mongodbUri) {
    throw new Error(
      `[db] FATAL: Atlas mode selected but MONGODB_URI is empty (env file: ${env.envFile || 'not loaded'}).`
    );
  }

  let uri = env.mongodbUri;
  let mode: 'atlas' | 'memory' = 'atlas';

  if (env.useMemoryDb) {
    if (env.isProd) {
      throw new Error('[db] FATAL: In-memory MongoDB is disabled in production.');
    }
    memoryReplSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' }
    });
    uri = memoryReplSet.getUri('repairconnect');
    mode = 'memory';
    console.warn(
      '[db] Using EXPLICIT in-memory MongoDB (USE_MEMORY_DB=true or test). Not for production.'
    );
  } else {
    console.log(`[db] Connecting to Atlas/remote ${redactMongoUri(uri)}`);
  }

  mongoose.set('strictQuery', true);
  // Fail loudly instead of hanging forever when Atlas/DNS is unreachable (local Vite proxy then ECONNREFUSED).
  await mongoose.connect(uri, {
    dbName: 'repairconnect',
    serverSelectionTimeoutMS: 20_000,
    connectTimeoutMS: 20_000
  });
  console.log(`[db] Connected (${mode})`);
  return { uri, mode };
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
  if (memoryReplSet) {
    await memoryReplSet.stop();
    memoryReplSet = null;
  }
}

export function getDbMode(): 'atlas' | 'memory' | 'disconnected' {
  if (mongoose.connection.readyState !== 1) return 'disconnected';
  return memoryReplSet ? 'memory' : 'atlas';
}
