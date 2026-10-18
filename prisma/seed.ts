/**
 * Guarded fictional-data seed. Idempotent: running it twice creates no duplicates.
 * Refuses to run unless DEMO_MODE=true, and in production additionally requires
 * SEED_CONFIRM_FICTIONAL=yes. Prints counts only, never secrets.
 * `--once` (used at startup) skips a database that has already been seeded.
 */
import { loadConfig } from '../apps/api/src/config.js';
import { createPrisma } from '../apps/api/src/db.js';
import { createCrypto } from '../apps/api/src/lib/crypto.js';
import { seedFixtures, seedFixturesOnce } from './fixtures.js';

async function main() {
  const config = loadConfig();
  if (!config.demoMode) {
    console.error('Refusing to seed: DEMO_MODE is not true. Fixtures are fictional demo data only.');
    process.exit(1);
  }
  if (config.isProduction && process.env.SEED_CONFIRM_FICTIONAL !== 'yes') {
    console.error('Refusing to seed a production environment without SEED_CONFIRM_FICTIONAL=yes.');
    process.exit(1);
  }
  const seedPassword = process.env.SEED_PASSWORD;
  const seedSecret = process.env.SEED_SECRET;
  if (!seedPassword || seedPassword.length < 10 || !seedSecret || seedSecret.length < 16) {
    console.error('Refusing to seed: SEED_PASSWORD (10+ chars) and SEED_SECRET (16+ chars) must be set.');
    process.exit(1);
  }
  const prisma = createPrisma(config.databaseUrl);
  try {
    const opts = { now: new Date(), seedPassword, seedSecret, crypto: createCrypto(config) };
    const summary = process.argv.includes('--once') ? await seedFixturesOnce(prisma, opts) : await seedFixtures(prisma, opts);
    console.log(summary ? `Seed complete (fictional fixtures): ${JSON.stringify(summary)}` : 'Seed skipped: this database was already seeded.');
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((e: unknown) => {
  console.error(`Seed failed: ${e instanceof Error ? e.name : 'error'}`);
  process.exit(1);
});
