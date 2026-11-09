import { beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';

process.env.NODE_ENV = 'test';
process.env.USE_MEMORY_DB = 'true';
process.env.JWT_SECRET = 'test-secret-repairconnect-min-32-chars!!';
process.env.MONGODB_URI = '';
process.env.SEED_ON_START = 'false';
process.env.PROVISIONING_API_KEY = 'test-provisioning-key-32chars!!';

// Ensure root .env discovery runs after test env vars are set (dotenv will not override them).
await import('../config/loadEnv.js').then((m) => m.loadRootEnv());

const { connectDb, disconnectDb } = await import('../config/db.js');

beforeAll(async () => {
  await connectDb();
}, 600000);

afterAll(async () => {
  await disconnectDb();
}, 120000);

beforeEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
});
