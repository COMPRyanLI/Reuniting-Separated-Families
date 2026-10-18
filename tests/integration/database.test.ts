import { describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../apps/api/src/app.js';
import { createCrypto } from '../../apps/api/src/lib/crypto.js';
import { silentLogger } from '../../apps/api/src/lib/logger.js';
import { seedFixtures, seedFixturesOnce } from '../../prisma/fixtures.js';
import { assertDisposableName, createDatabase, databaseUrl, dropDatabase, migrate, migratePartial, migrationNames, randomDbName } from '../support/db.js';
import { SEED_PASSWORD, SEED_SECRET, T0, testConfig, testCrypto } from '../support/env.js';
import { Client, ids, useHarness } from '../support/harness.js';

const h = useHarness();

describe('DB-01 migrate empty database and seed twice', () => {
  it('second seed creates no duplicate accounts, memberships, cases or assignments', async () => {
    const name = randomDbName();
    await createDatabase(name);
    try {
      migrate(name);
      const prisma = new PrismaClient({ datasourceUrl: databaseUrl(name) });
      try {
        const opts = { now: T0, seedPassword: SEED_PASSWORD, seedSecret: SEED_SECRET, crypto: testCrypto() };
        const first = await seedFixturesOnce(prisma, opts);
        const counts1 = await countAll(prisma);
        const second = await seedFixtures(prisma, opts);
        const counts2 = await countAll(prisma);
        expect(first?.accounts).toBeGreaterThan(0);
        expect(second).toEqual(first);
        expect(counts2).toEqual(counts1);
        // Startup seeding (--once) leaves an already seeded database alone.
        expect(await seedFixturesOnce(prisma, opts)).toBeNull();
      } finally {
        await prisma.$disconnect();
      }
    } finally {
      await dropDatabase(name);
    }
  }, 120_000);
});

async function countAll(prisma: PrismaClient) {
  return {
    accounts: await prisma.account.count(),
    persons: await prisma.person.count(),
    memberships: await prisma.staffMembership.count(),
    cases: await prisma.assistanceCase.count(),
    assignments: await prisma.caseAssignment.count(),
    shelters: await prisma.shelter.count(),
    credentials: await prisma.assistanceCredential.count(),
  };
}

describe('DB-02 constraints reject invalid core records', () => {
  it('rejects a person referencing a nonexistent incident', async () => {
    await expect(
      h.prisma.person.create({ data: { incidentId: randomUUID(), alias: 'Ghost', createdAt: T0 } }),
    ).rejects.toThrow();
  });

  it('rejects a duplicate normalized username', async () => {
    await expect(
      h.prisma.account.create({ data: { normalizedUsername: 'maya', passwordHash: 'x', createdAt: T0 } }),
    ).rejects.toThrow();
  });

  it('rejects a case assignment that uses a membership from another incident', async () => {
    const before = await h.prisma.caseAssignment.count();
    await expect(
      h.prisma.caseAssignment.create({
        data: {
          caseId: ids.case('sam'),
          incidentId: ids.incident('demo-hurricane-1'),
          membershipId: ids.membership('worker.x'),
          staffAccountId: ids.account('worker.x'),
          purposes: ['ASSIST'],
          startsAt: T0,
          assignedByAccountId: ids.account('coord.a'),
        },
      }),
    ).rejects.toThrow();
    // Same attempt claiming the other incident also fails (case is in incident 1).
    await expect(
      h.prisma.caseAssignment.create({
        data: {
          caseId: ids.case('sam'),
          incidentId: ids.incident('demo-boundary-2'),
          membershipId: ids.membership('worker.x'),
          staffAccountId: ids.account('worker.x'),
          purposes: ['ASSIST'],
          startsAt: T0,
          assignedByAccountId: ids.account('coord.a'),
        },
      }),
    ).rejects.toThrow();
    expect(await h.prisma.caseAssignment.count()).toBe(before);
  });

  it('rejects an assignment whose membership belongs to a different staff account', async () => {
    await expect(
      h.prisma.caseAssignment.create({
        data: {
          caseId: ids.case('sam'),
          incidentId: ids.incident('demo-hurricane-1'),
          membershipId: ids.membership('worker.b'),
          staffAccountId: ids.account('worker.a2'),
          purposes: ['ASSIST'],
          startsAt: T0,
          assignedByAccountId: ids.account('coord.a'),
        },
      }),
    ).rejects.toThrow();
  });

  it('leaves no partial records when a multi-row transaction fails', async () => {
    const before = await h.prisma.account.count();
    await expect(
      h.prisma.$transaction(async (tx) => {
        const acct = await tx.account.create({ data: { normalizedUsername: 'partial.user', passwordHash: 'x', createdAt: T0 } });
        await tx.person.create({ data: { accountId: acct.id, incidentId: randomUUID(), alias: 'Partial', createdAt: T0 } });
      }),
    ).rejects.toThrow();
    expect(await h.prisma.account.count()).toBe(before);
    expect(await h.prisma.account.findUnique({ where: { normalizedUsername: 'partial.user' } })).toBeNull();
  });
});

describe('DB-03 persistence across restart and guarded reset', () => {
  it('an account created through the API survives an application restart', async () => {
    const c = h.client();
    const reg = await c.post('/api/v1/auth/register', { username: 'restart.tester', password: 'long enough passphrase', alias: 'RT' });
    expect(reg.status).toBe(201);

    // Simulate a restart: new database client and new app instance on the same database.
    const prisma2 = new PrismaClient({ datasourceUrl: databaseUrl(h.dbName) });
    try {
      const config = testConfig(databaseUrl(h.dbName));
      const app2 = createApp({ config, prisma: prisma2, clock: h.clock, crypto: createCrypto(config), logger: silentLogger });
      const c2 = new Client(app2);
      const login = await c2.post('/api/v1/auth/login', { username: 'restart.tester', password: 'long enough passphrase' });
      expect(login.status).toBe(200);
      const session = await c2.get('/api/v1/auth/session');
      expect(session.body.person.alias).toBe('RT');
      // Seeded case/person relations also persist.
      const sam = await prisma2.assistanceCase.findUnique({ where: { id: ids.case('sam') }, include: { person: true } });
      expect(sam?.person.alias).toBe('Sam');
    } finally {
      await prisma2.$disconnect();
    }
  });

  it('upgrading a synthetic database from the first migration to the current schema keeps valid data', async () => {
    const names = migrationNames();
    expect(names.length).toBeGreaterThanOrEqual(2);
    const name = randomDbName();
    await createDatabase(name);
    try {
      migratePartial(name, 1);
      const prisma = new PrismaClient({ datasourceUrl: databaseUrl(name) });
      try {
        const incident = await prisma.incident.create({ data: { slug: 'upgrade-test', label: 'Upgrade (fictional)' } });
        const account = await prisma.account.create({ data: { normalizedUsername: 'old.schema.user', passwordHash: 'x', createdAt: T0 } });
        await prisma.person.create({ data: { accountId: account.id, incidentId: incident.id, alias: 'Old Schema', createdAt: T0 } });
        migrate(name); // apply the remaining migrations; no reset
        const person = await prisma.person.findFirstOrThrow({ where: { alias: 'Old Schema' } });
        expect(person.accountId).toBe(account.id);
        expect(await prisma.checkIn.count()).toBe(0); // later table exists and is usable
        const applied = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
        expect(Number(applied[0]!.n)).toBe(names.length);
      } finally {
        await prisma.$disconnect();
      }
    } finally {
      await dropDatabase(name);
    }
  }, 120_000);

  it('the reset/drop utility refuses non-test database names', () => {
    expect(() => assertDisposableName('rf_dev')).toThrow();
    expect(() => assertDisposableName('postgres')).toThrow();
    expect(() => assertDisposableName('rf_test_ok_123')).not.toThrow();
  });
});
