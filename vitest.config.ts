import { defineConfig } from 'vitest/config';

// Three projects: pure unit tests, real-PostgreSQL integration tests, and the
// security/authorization regression suite (also real PostgreSQL).
export default defineConfig({
  test: {
    passWithNoTests: false,
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['tests/support/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 120_000,
          pool: 'forks',
        },
      },
      {
        test: {
          name: 'security',
          include: ['tests/security/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['tests/support/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 120_000,
          pool: 'forks',
        },
      },
    ],
  },
});
