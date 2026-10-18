import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixtureId } from '../../prisma/fixtures.js';
import { MINUTE, HOUR } from '../../apps/api/src/lib/clock.js';
import { ids, useHarness } from '../support/harness.js';

const h = useHarness();
const API = '/api/v1';
const areaId = (label: string) => fixtureId(`area:demo-hurricane-1:${label}`);
const key = () => `k-${randomUUID()}`;
const iso = (d: Date) => d.toISOString();

describe('public shelter and area lists', () => {
  it('lists public shelters for the active incident only, with no resident data', async () => {
    const res = await h.client().get(`${API}/shelters`);
    expect(res.status).toBe(200);
    const names = res.body.shelters.map((s: { name: string }) => s.name);
    expect(names).toContain('Riverside Community Center');
    expect(names).not.toContain('Bayview Hall'); // incident 2
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/resident|person|alias|count/i);
    const areas = await h.client().get(`${API}/areas`);
    expect(areas.body.areas.map((a: { label: string }) => a.label)).toContain('Downtown');
  });
});

describe('CHECK-01 own shelter and area reports', () => {
  it('creates and lists own shelter and area reports', async () => {
    const noor = await h.login('noor');
    const a = await noor.post(`${API}/me/check-ins`, { shelterId: ids.shelter('A'), observedAt: iso(h.clock.now()) }, { 'Idempotency-Key': key() });
    expect(a.status).toBe(201);
    expect(a.body.checkIn.place).toMatchObject({ kind: 'SHELTER', shelterName: 'Riverside Community Center', areaLabel: 'North Riverside' });
    expect(a.body.checkIn.source).toBe('self_report');
    const b = await noor.post(`${API}/me/check-ins`, { areaId: areaId('East Marsh'), observedAt: iso(h.clock.now()) }, { 'Idempotency-Key': key() });
    expect(b.status).toBe(201);
    expect(b.body.checkIn.place).toEqual({ kind: 'AREA', areaLabel: 'East Marsh', areaId: areaId('East Marsh') });
    const list = await noor.get(`${API}/me/check-ins`);
    expect(list.body.checkIns.map((c: { id: string }) => c.id)).toEqual(expect.arrayContaining([a.body.checkIn.id, b.body.checkIn.id]));
    const stored = await h.prisma.checkIn.findUniqueOrThrow({ where: { id: a.body.checkIn.id } });
    expect(stored.personId).toBe(ids.person('noor'));
    expect(stored.authorAccountId).toBe(ids.account('noor'));
  });

  it('rejects spoofed subjects, precise-location fields and mismatched places', async () => {
    const maya = await h.login('maya');
    const bad = [
      { personId: ids.person('leo'), shelterId: ids.shelter('A'), observedAt: iso(h.clock.now()) },
      { shelterId: ids.shelter('A'), observedAt: iso(h.clock.now()), latitude: 29.7, longitude: -95.3 },
      { shelterId: ids.shelter('A'), observedAt: iso(h.clock.now()), accuracyMeters: 5 },
      { shelterId: ids.shelter('B'), areaId: areaId('Downtown'), observedAt: iso(h.clock.now()) },
      { shelterId: ids.shelter('X'), observedAt: iso(h.clock.now()) }, // other incident
      { areaId: randomUUID(), observedAt: iso(h.clock.now()) },
      { observedAt: iso(h.clock.now()) },
    ];
    for (const body of bad) {
      const res = await maya.post(`${API}/me/check-ins`, body, { 'Idempotency-Key': key() });
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
    expect(await h.prisma.checkIn.count({ where: { personId: ids.person('maya') } })).toBe(0);
    // Acting on another person's report is a neutral 404.
    const leoReport = fixtureId('checkin:leo-shelter-b');
    expect((await maya.post(`${API}/me/check-ins/${leoReport}/depart`)).status).toBe(404);
    const stillActive = await h.prisma.checkIn.findUniqueOrThrow({ where: { id: leoReport } });
    expect(stillActive.state).toBe('ACTIVE');
  });

  it('requires authentication', async () => {
    expect((await h.client().get(`${API}/me/check-ins`)).status).toBe(401);
  });
});

describe('CHECK-02 observation time rules', () => {
  it('rejects reports more than five minutes in the future and accepts small clock skew', async () => {
    const evan = await h.login('evan');
    const future = await evan.post(`${API}/me/check-ins`, { areaId: areaId('Downtown'), observedAt: iso(new Date(h.clock.now().getTime() + 6 * MINUTE)) }, { 'Idempotency-Key': key() });
    expect(future.status).toBe(422);
    const skew = await evan.post(`${API}/me/check-ins`, { areaId: areaId('Downtown'), observedAt: iso(new Date(h.clock.now().getTime() + 4 * MINUTE)) }, { 'Idempotency-Key': key() });
    expect(skew.status).toBe(201);
  });

  it('orders by observation time, so a late backdated entry does not become the latest report', async () => {
    const c = h.client();
    const reg = await c.post(`${API}/auth/register`, { username: 'backdater', password: 'long enough passphrase', alias: 'BD' });
    c.csrf = reg.body.session.csrfToken;
    const recent = await c.post(`${API}/me/check-ins`, { shelterId: ids.shelter('B'), observedAt: iso(new Date(h.clock.now().getTime() - HOUR)) }, { 'Idempotency-Key': key() });
    h.clock.advance(MINUTE);
    const backdated = await c.post(`${API}/me/check-ins`, { areaId: areaId('Airport Road'), observedAt: iso(new Date(h.clock.now().getTime() - 50 * HOUR)), entryOrigin: 'PAPER' }, { 'Idempotency-Key': key() });
    expect(backdated.status).toBe(201);
    expect(backdated.body.checkIn.entryOrigin).toBe('PAPER');
    expect(new Date(backdated.body.checkIn.receivedAt).getTime()).toBeGreaterThan(new Date(backdated.body.checkIn.observedAt).getTime());
    const list = await c.get(`${API}/me/check-ins`);
    expect(list.body.checkIns[0].id).toBe(recent.body.checkIn.id);
    expect(list.body.checkIns[1].id).toBe(backdated.body.checkIn.id);
  });
});

describe('CHECK-03 supersede and depart keep history explicit', () => {
  it('marks the old report historical and stores the new one separately', async () => {
    const c = h.client();
    const reg = await c.post(`${API}/auth/register`, { username: 'mover', password: 'long enough passphrase', alias: 'Mover' });
    c.csrf = reg.body.session.csrfToken;
    const first = await c.post(`${API}/me/check-ins`, { shelterId: ids.shelter('A'), observedAt: iso(h.clock.now()) }, { 'Idempotency-Key': key() });
    const correction = await c.post(`${API}/me/check-ins`, { shelterId: ids.shelter('D'), observedAt: iso(h.clock.now()), supersedesId: first.body.checkIn.id }, { 'Idempotency-Key': key() });
    expect(correction.status).toBe(201);
    const list = (await c.get(`${API}/me/check-ins`)).body.checkIns as { id: string; state: string; supersedesId: string | null }[];
    expect(list.find((x) => x.id === first.body.checkIn.id)?.state).toBe('SUPERSEDED');
    expect(list.find((x) => x.id === correction.body.checkIn.id)).toMatchObject({ state: 'ACTIVE', supersedesId: first.body.checkIn.id });
    // A superseded report cannot be superseded again.
    const again = await c.post(`${API}/me/check-ins`, { areaId: areaId('Downtown'), observedAt: iso(h.clock.now()), supersedesId: first.body.checkIn.id }, { 'Idempotency-Key': key() });
    expect(again.status).toBe(409);
    // Departure adds no destination.
    const before = await h.prisma.checkIn.count();
    const dep = await c.post(`${API}/me/check-ins/${correction.body.checkIn.id}/depart`);
    expect(dep.status).toBe(200);
    expect(dep.body.checkIn.state).toBe('DEPARTED');
    expect(await h.prisma.checkIn.count()).toBe(before);
    // Superseding someone else's report is rejected.
    const foreign = await c.post(`${API}/me/check-ins`, { areaId: areaId('Downtown'), observedAt: iso(h.clock.now()), supersedesId: fixtureId('checkin:leo-shelter-b') }, { 'Idempotency-Key': key() });
    expect(foreign.status).toBe(404);
  });
});

describe('CHECK-04 versioned privacy edits and idempotent check-ins', () => {
  it('accepts one of two concurrent privacy edits with the same expected version', async () => {
    const c = h.client();
    const reg = await c.post(`${API}/auth/register`, { username: 'racer', password: 'long enough passphrase', alias: 'Racer' });
    c.csrf = reg.body.session.csrfToken;
    const me = await c.get(`${API}/me`);
    expect(me.body.requestMode).toBe('CODE_ONLY');
    const v = me.body.version;
    const [r1, r2] = await Promise.all([
      c.patch(`${API}/me/privacy`, { requestMode: 'CLOSED', expectedVersion: v }),
      c.patch(`${API}/me/privacy`, { requestMode: 'ASSISTED', expectedVersion: v }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const winner = r1.status === 200 ? 'CLOSED' : 'ASSISTED';
    const person = await h.prisma.person.findUniqueOrThrow({ where: { id: reg.body.session.person.id } });
    expect(person.requestMode).toBe(winner);
    const consents = await h.prisma.consentRecord.findMany({ where: { personId: person.id, action: 'PRIVACY_CHANGE' } });
    expect(consents).toHaveLength(1);
    expect(consents[0]!.detail).toBe(winner);
    const loser = r1.status === 409 ? r1 : r2;
    expect(JSON.stringify(loser.body)).not.toContain(winner);
  });

  it('retrying a check-in with the same key yields one record; a different payload with that key is a conflict', async () => {
    const c = await h.login('noor');
    const k = key();
    const body = { areaId: areaId('Airport Road'), observedAt: iso(h.clock.now()) };
    const results = await Promise.all([0, 1, 2, 3, 4].map(() => c.post(`${API}/me/check-ins`, body, { 'Idempotency-Key': k })));
    const created = results.map((r) => r.body.checkIn?.id);
    expect(results.every((r) => r.status === 201 || r.status === 200)).toBe(true);
    expect(new Set(created).size).toBe(1);
    expect(await h.prisma.checkIn.count({ where: { id: created[0] } })).toBe(1);
    const changed = await c.post(`${API}/me/check-ins`, { ...body, areaId: areaId('Downtown') }, { 'Idempotency-Key': k });
    expect(changed.status).toBe(409);
    const missingKey = await c.post(`${API}/me/check-ins`, body);
    expect(missingKey.status).toBe(422);
  });

  it('profile alias update also uses expectedVersion', async () => {
    const c = await h.login('evan');
    const me = await c.get(`${API}/me`);
    const ok = await c.patch(`${API}/me`, { alias: 'Evan T.', expectedVersion: me.body.version });
    expect(ok.status).toBe(200);
    const stale = await c.patch(`${API}/me`, { alias: 'Evan X', expectedVersion: me.body.version });
    expect(stale.status).toBe(409);
  });

  it('closed or private profiles still use their own account without a location', async () => {
    const c = await h.login('evan');
    const me = await c.get(`${API}/me`);
    expect((await c.patch(`${API}/me/privacy`, { requestMode: 'CLOSED', expectedVersion: me.body.version })).status).toBe(200);
    expect((await c.get(`${API}/me`)).status).toBe(200);
    expect((await c.get(`${API}/me/check-ins`)).status).toBe(200);
  });
});
