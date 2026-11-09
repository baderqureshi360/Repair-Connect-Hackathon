import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/tests/setup.ts'],
    testTimeout: 60000,
    hookTimeout: 120000,
    env: {
      NODE_ENV: 'test',
      USE_MEMORY_DB: 'true',
      JWT_SECRET: 'test-secret-repairconnect-min-32-chars!!',
      MONGODB_URI: '',
      PROVISIONING_API_KEY: 'test-provisioning-key-32chars!!'
    }
  }
});
