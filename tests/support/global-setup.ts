import type { TestProject } from 'vitest/node';
import { createDatabase, databaseUrl, dropDatabase, migrate, randomDbName } from './db.js';
import { SEED_PASSWORD, SEED_SECRET, T0, testCrypto } from './env.js';
import { PrismaClient } from '@prisma/client';
import { seedFixtures } from '../../prisma/fixtures.js';

declare module 'vitest' {
  export interface ProvidedContext {
    templateDb: string;
  }
}

/** Builds one migrated + seeded template database per run; each test file clones it. */
export default async function setup(project: TestProject) {
  const template = randomDbName('rf_test_tpl');
  await createDatabase(template);
  migrate(template);
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl(template) });
  try {
    await seedFixtures(prisma, { now: new Date(T0.getTime() - 3 * 3600_000), seedPassword: SEED_PASSWORD, seedSecret: SEED_SECRET, crypto: testCrypto() });
  } finally {
    await prisma.$disconnect();
  }
  project.provide('templateDb', template);
  return async () => {
    await dropDatabase(template);
  };
}
