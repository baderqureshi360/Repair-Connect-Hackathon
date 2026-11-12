import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      $lib: path.resolve('./src/lib')
    }
  },
  test: {
    include: ['src/**/*.{test,spec}.{js,ts}'],
    exclude: ['tests/**', 'node_modules/**', '.svelte-kit/**'],
    passWithNoTests: true
  }
});
