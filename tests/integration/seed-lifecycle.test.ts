import { describe, expect, it } from 'vitest';
import { runRetention } from '../../apps/api/src/jobs/retention.js';
import { HOUR } from '../../apps/api/src/lib/clock.js';
import { demoSecret, seedFixtures, seedFixturesOnce } from '../../prisma/fixtures.js';
import { SEED_PASSWORD, SEED_SECRET } from '../support/env.js';
import { ids, useHarness } from '../support/harness.js';
import { API } from '../support/flows.js';

const h = useHarness();

/** Self-deletes Leo and has Ana's worker delete Ana at her request, then lets retention run. */
async function deleteSeededPeople() {
  const leo = await h.login('leo');
  expect((await leo.delete(`${API}/me`, { password: SEED_PASSWORD, confirm: true })).status).toBe(204);
  const wB = await h.loginStaff('wB');
  expect((await wB.post(`${API}/staff/cases/${ids.case('ana')}/verify`, { assistanceSecret: demoSecret(SEED_SECRET, 'assist:ana') })).status).toBe(200);
  expect((await wB.delete(`${API}/staff/cases/${ids.case('ana')}/person`, { confirm: true })).status).toBe(204);
  h.clock.advance(HOUR);
  await runRetention(h.deps);
}

async function deletedContent() {
  return {
    leoCheckIns: await h.prisma.checkIn.count({ where: { personId: ids.person('leo') } }),
    anaCheckIns: await h.prisma.checkIn.count({ where: { personId: ids.assisted('ana') } }),
    anaCredentials: await h.prisma.assistanceCredential.count({ where: { personId: ids.assisted('ana') } }),
  };
}

const PURGED = { leoCheckIns: 0, anaCheckIns: 0, anaCredentials: 0 };

describe('DB-01 seeding after deletion: fixtures never recreate purged content', () => {
  it('re-running the fixture seed skips deleted people: their check-ins and assistance credentials stay purged', async () => {
    await deleteSeededPeople();
    expect(await deletedContent()).toEqual(PURGED);
    const samCredentials = await h.prisma.assistanceCredential.count({ where: { personId: ids.assisted('sam') } });

    await seedFixtures(h.prisma, { now: h.clock.now(), seedPassword: SEED_PASSWORD, seedSecret: SEED_SECRET, crypto: h.deps.crypto });

    expect(await deletedContent()).toEqual(PURGED);
    const ana = await h.prisma.person.findUniqueOrThrow({ where: { id: ids.assisted('ana') } });
    expect(ana.deletedAt).not.toBeNull();
    expect(ana.alias).toBe('');
    expect(ana.encryptedMatchingClue).toBeNull();
    expect((await h.client().post(`${API}/auth/login`, { username: 'leo', password: SEED_PASSWORD })).status).toBe(401);
    // People who were not deleted keep their fixtures.
    expect(await h.prisma.assistanceCredential.count({ where: { personId: ids.assisted('sam') } })).toBe(samCredentials);
    expect((await h.client().post(`${API}/auth/login`, { username: 'maya', password: SEED_PASSWORD })).status).toBe(200);
  });

  it('startup seeding runs once per database: an initialized database is left untouched', async () => {
    // Same database as the previous test: Sam (assisted, worker A) is deleted here.
    const wA = await h.loginStaff('wA');
    expect((await wA.post(`${API}/staff/cases/${ids.case('sam')}/verify`, { assistanceSecret: demoSecret(SEED_SECRET, 'assist:sam') })).status).toBe(200);
    expect((await wA.delete(`${API}/staff/cases/${ids.case('sam')}/person`, { confirm: true })).status).toBe(204);
    h.clock.advance(HOUR);
    await runRetention(h.deps);
    const samContent = async () => ({
      checkIns: await h.prisma.checkIn.count({ where: { personId: ids.assisted('sam') } }),
      credentials: await h.prisma.assistanceCredential.count({ where: { personId: ids.assisted('sam') } }),
    });
    expect(await samContent()).toEqual({ checkIns: 0, credentials: 0 });

    expect(await seedFixturesOnce(h.prisma, { now: h.clock.now(), seedPassword: SEED_PASSWORD, seedSecret: SEED_SECRET, crypto: h.deps.crypto })).toBeNull();

    expect(await samContent()).toEqual({ checkIns: 0, credentials: 0 });
  });
});
