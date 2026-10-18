import { describe, expect, it, inject } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../../apps/api/src/app.js';
import { createCrypto } from '../../apps/api/src/lib/crypto.js';
import { FixedClock } from '../../apps/api/src/lib/clock.js';
import { silentLogger } from '../../apps/api/src/lib/logger.js';
import { exportLedger, markRestoreStarted, replayLedger } from '../../apps/api/src/services/restore.js';
import { createDatabase, databaseUrl, dropDatabase, randomDbName } from '../support/db.js';
import { SEED_PASSWORD, T0, TEST_ORIGIN, testConfig } from '../support/env.js';
import { Client } from '../support/harness.js';
import { API, deliveredRequest, drain, key, outgoing, respond } from '../support/flows.js';
import type { Harness } from '../support/harness.js';

function build(dbName: string, clock: FixedClock) {
  const config = testConfig(databaseUrl(dbName), { RATE_LIMIT_LOGIN_IP: '100000', RATE_LIMIT_REQUESTS_PER_HOUR: '1000' });
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl(dbName) });
  const deps = { config, prisma, clock, crypto: createCrypto(config), logger: silentLogger };
  return { deps, prisma, app: createApp(deps) };
}

async function login(app: ReturnType<typeof createApp>, username: string, password = SEED_PASSWORD) {
  const c = new Client(app);
  const res = await c.post(`${API}/auth/login`, { username, password });
  c.csrf = res.body.csrfToken;
  return c;
}

describe('DATA-03 restoring a pre-deletion/pre-revocation backup and replaying the ledger', () => {
  it('serves nothing until the ledger is replayed, then deleted and revoked data stay unavailable', async () => {
    const live = randomDbName();
    const backup = randomDbName();
    const clock = new FixedClock(T0);
    await createDatabase(live, inject('templateDb'));
    try {
      let L = build(live, clock);
      const h = { deps: L.deps, prisma: L.prisma, clock } as unknown as Harness;
      const leo = await login(L.app, 'leo');
      const maya = await login(L.app, 'maya');
      const victimReg = await new Client(L.app).post(`${API}/auth/register`, { username: 'restore.victim', password: 'long enough passphrase', alias: 'SENTINEL_RESTORE_ALIAS' });
      expect(victimReg.status).toBe(201);
      const victim = await login(L.app, 'restore.victim', 'long enough passphrase');
      const r = await deliveredRequest(h, maya, leo, 'pre-backup');
      await respond(leo, r.id, r.version, { scope: 'SAFETY_MESSAGE', message: 'SENTINEL_RESTORE_MSG' });
      await drain(h);
      const responseId = (await outgoing(maya)).find((o) => o.id === r.id)!.responseId!;
      await victim.post(`${API}/me/check-ins`, { areaId: undefined, shelterId: (await L.prisma.shelter.findFirstOrThrow()).id, observedAt: clock.now().toISOString() }, { 'Idempotency-Key': key() });

      // Synthetic backup: an isolated copy of the database at this moment.
      await L.prisma.$disconnect();
      await createDatabase(backup, live);
      L = build(live, clock);

      // After the backup: Leo revokes the grant and the victim deletes their account.
      const leo2 = await login(L.app, 'leo');
      const grantId = (await leo2.get(`${API}/me/grants`)).body.grants.find((g: { status: string }) => g.status === 'ACTIVE').grantId;
      expect((await leo2.post(`${API}/grants/${grantId}/revoke`)).status).toBe(200);
      const victim2 = await login(L.app, 'restore.victim', 'long enough passphrase');
      expect((await victim2.delete(`${API}/me`, { password: 'long enough passphrase', confirm: true })).status).toBe(204);
      const ledger = await exportLedger(L.deps);
      expect(JSON.stringify(ledger)).not.toMatch(/SENTINEL|alias|message/i);
      await L.prisma.$disconnect();

      // Restore the backup: it is gated until the ledger is replayed.
      const B = build(backup, clock);
      await markRestoreStarted(B.deps);
      expect((await request(B.app).get('/api/health/ready')).status).toBe(503);
      const blocked = await request(B.app).post(`${API}/auth/login`).set('Origin', TEST_ORIGIN).send({ username: 'maya', password: SEED_PASSWORD });
      expect(blocked.status).toBe(503);
      expect(JSON.stringify(blocked.body)).not.toContain('SENTINEL');

      const summary = await replayLedger(B.deps, ledger);
      expect(summary.deletionsApplied).toBeGreaterThanOrEqual(1);
      expect(summary.grantRevocationsApplied).toBeGreaterThanOrEqual(1);
      expect((await request(B.app).get('/api/health/ready')).status).toBe(200);

      const mayaB = await login(B.app, 'maya');
      expect((await mayaB.get(`${API}/responses/${responseId}`)).status).toBe(404);
      expect((await new Client(B.app).post(`${API}/auth/login`, { username: 'restore.victim', password: 'long enough passphrase' })).status).toBe(401);
      const victimRow = await B.prisma.person.findFirstOrThrow({ where: { account: { normalizedUsername: 'restore.victim' } } });
      expect(victimRow.deletedAt).not.toBeNull();
      expect(victimRow.alias).toBe('');
      expect(await B.prisma.checkIn.count({ where: { personId: victimRow.id } })).toBe(0);
      await B.prisma.$disconnect();
    } finally {
      await dropDatabase(backup);
      await dropDatabase(live);
    }
  }, 120_000);
});
