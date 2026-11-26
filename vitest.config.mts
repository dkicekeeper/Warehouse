import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // One real database is shared by every file; the in-process one is per worker.
    fileParallelism: !process.env.TEST_DATABASE_URL,
  },
});
