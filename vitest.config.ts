import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/services/**/*.ts', 'src/ingest/**/*.ts'],
      exclude: ['src/services/jira.ts', 'src/services/twg.ts', 'src/services/demo.ts', 'src/services/app.ts'],
      thresholds: { lines: 90, functions: 90 },
    },
  },
});
