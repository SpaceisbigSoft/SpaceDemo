// Interface test (plan 4.2+): starts the real app window with Electron and clicks through it.
// Run: npm run test:app (on Linux it needs a display: xvfb-run -a npm run test:app).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['app/test/**/*.e2e.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
