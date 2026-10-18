import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixtureId } from '../../prisma/fixtures.js';
import { ids, useHarness, type Client } from '../support/harness.js';
import { API, contactCode, deliveredRequest, drain, key, outgoing, respond } from '../support/flows.js';

const h = useHarness({ configOverrides: { RATE_LIMIT_REQUESTS_PER_HOUR: '1000' } });
const LEO_SHELTER_B = fixtureId('checkin:leo-shelter-b');
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const neutral = (b: { error: Record<string, unknown> }) => ({ ...b.error, requestId: 0 });

async function setup() {
  const leo = await h.login('leo');
  const maya = await h.login('maya');
  const evan = await h.login('evan');
  const r = await deliveredRequest(h, maya, leo, 'PRIV sentinel SENTINEL_INTRO_SEC');
  const res = await respond(leo, r.id, r.version, { scope: 'AREA', checkInId: LEO_SHELTER_B, message: 'SENTINEL_MSG_SEC' });
  expect(res.status).toBe(201);
  await drain(h);
  const responseId = (await outgoing(maya)).find((o) => o.id === r.id)!.responseId!;
  const mayaNote = (await maya.get(`${API}/notifications`)).body.notifications[0];
  return { leo, maya, evan, requestId: r.id, responseId, grantId: res.body.grantId as string, mayaNoteId: mayaNote.id as string };
}

describe('PRIV-02 own, other and nonexistent IDs on every protected object route', () => {
  it('authorized reads work; inaccessible and nonexistent IDs share one 404 envelope; anonymous gets 401', async () => {
    const s = await setup();
    const ghost = randomUUID();
    type Probe = { name: string; call: (c: Client, id: string) => Promise<{ status: number; body: { error: Record<string, unknown> } }>; owner: Client; ownId: string; ownStatus: number };
    const probes: Probe[] = [
      { name: 'GET request', call: (c, id) => c.get(`${API}/requests/${id}`), owner: s.maya, ownId: s.requestId, ownStatus: 200 },
      { name: 'GET response', call: (c, id) => c.get(`${API}/responses/${id}`), owner: s.maya, ownId: s.responseId, ownStatus: 200 },
      { name: 'withdraw', call: (c, id) => c.post(`${API}/requests/${id}/withdraw`), owner: s.maya, ownId: s.requestId, ownStatus: 409 },
      { name: 'respond', call: (c, id) => c.post(`${API}/requests/${id}/respond`, { scope: 'SAFETY_MESSAGE', statement: 'REPORTED_OK', expiresIn: '7d', expectedVersion: 1 }, { 'Idempotency-Key': key() }), owner: s.leo, ownId: s.requestId, ownStatus: 409 },
      { name: 'decline', call: (c, id) => c.post(`${API}/requests/${id}/decline`), owner: s.leo, ownId: s.requestId, ownStatus: 409 },
      { name: 'revoke grant', call: (c, id) => c.post(`${API}/grants/${id}/revoke`), owner: s.leo, ownId: s.grantId, ownStatus: 200 },
      { name: 'read notification', call: (c, id) => c.post(`${API}/notifications/${id}/read`), owner: s.maya, ownId: s.mayaNoteId, ownStatus: 200 },
      { name: 'depart check-in', call: (c, id) => c.post(`${API}/me/check-ins/${id}/depart`), owner: s.leo, ownId: fixtureId('checkin:leo-downtown'), ownStatus: 200 },
    ];
    for (const p of probes) {
      const other = await p.call(s.evan, p.ownId);
      const missing = await p.call(s.evan, ghost);
      const malformed = await p.call(s.evan, 'not-a-uuid');
      expect(other.status, `${p.name} other`).toBe(404);
      expect(neutral(other.body), p.name).toEqual(neutral(missing.body));
      expect(neutral(malformed.body), p.name).toEqual(neutral(missing.body));
      const anon = await p.call(h.client(), p.ownId);
      expect([401, 403], `${p.name} anonymous`).toContain(anon.status);
      if (anon.status === 403) expect(anon.body.error.code).toBe('CSRF_REJECTED');
      const own = await p.call(p.owner, p.ownId);
      expect(own.status, `${p.name} owner`).toBe(p.ownStatus);
    }
    // Requests are participant-specific: the requester cannot act as recipient and vice versa.
    expect((await s.maya.post(`${API}/requests/${s.requestId}/decline`)).status).toBe(404);
    expect((await s.leo.post(`${API}/requests/${s.requestId}/withdraw`)).status).toBe(404);
    // Anonymous GETs are 401 (not CSRF) for every read route.
    for (const path of [`/requests/${s.requestId}`, `/responses/${s.responseId}`, '/requests/outgoing', '/requests/incoming', '/me/grants', '/notifications', '/responses']) {
      expect((await h.client().get(`${API}${path}`)).status, path).toBe(401);
    }
  });
});

describe('PRIV-03 complete response bodies contain only approved fields', () => {
  it('area response and notifications carry no shelter, address, internal IDs, staff or history', async () => {
    const leo = await h.login('leo');
    const maya = await h.login('maya');
    const r = await deliveredRequest(h, maya, leo, 'scan me');
    await respond(leo, r.id, r.version, { scope: 'AREA', checkInId: LEO_SHELTER_B });
    const r2 = await deliveredRequest(h, maya, leo, 'safety only');
    await respond(leo, r2.id, r2.version, { scope: 'SAFETY_MESSAGE', message: 'ok' });
    await drain(h);
    const outs = await outgoing(maya);
    const areaBody = (await maya.get(`${API}/responses/${outs.find((o) => o.id === r.id)!.responseId}`)).body;
    const safetyBody = (await maya.get(`${API}/responses/${outs.find((o) => o.id === r2.id)!.responseId}`)).body;
    const areaText = JSON.stringify(areaBody);
    for (const forbidden of ['Hillcrest School Gym', '42 Sample Road', 'Downtown', 'personId', 'caseId', 'checkInId', 'shelterId', 'worker', 'latitude', ids.person('leo'), LEO_SHELTER_B, ids.shelter('B')]) {
      expect(areaText).not.toContain(forbidden);
    }
    expect(areaText.match(UUID_RE)).toEqual([areaBody.responseId]);
    expect(Object.keys(safetyBody).sort()).toEqual(['expiresAt', 'message', 'respondedAt', 'responseId', 'scope', 'sharedAlias', 'statement']);
    const outText = JSON.stringify(outs);
    expect(outText).not.toMatch(/Leo|recipient|AWAITING|DECLINED|BLOCKED|deliveredAt|internal/);
    const notes = JSON.stringify((await maya.get(`${API}/notifications`)).body);
    expect(notes).not.toMatch(/Hillcrest|Leo|Sample Road/);
  });
});

describe('PRIV-06 altered mutation bodies never produce a partial grant', () => {
  it('rejects recipient, foreign check-in, scope mismatches and role injection', async () => {
    const leo = await h.login('leo');
    const maya = await h.login('maya');
    const r = await deliveredRequest(h, maya, leo, 'tamper');
    const before = { responses: await h.prisma.response.count(), grants: await h.prisma.sharingGrant.count(), consents: await h.prisma.consentRecord.count() };
    const samCheckIn = fixtureId('checkin:sam-shelter-a');
    const bad: Record<string, unknown>[] = [
      { scope: 'SAFETY_MESSAGE', message: 'x', recipientPersonId: ids.person('evan') },
      { scope: 'AREA', checkInId: samCheckIn },
      { scope: 'AREA', checkInId: randomUUID() },
      { scope: 'SHELTER', checkInId: fixtureId('checkin:leo-downtown') }, // area-only report cannot be shared as a shelter
      { scope: 'SAFETY_MESSAGE', message: 'x', checkInId: LEO_SHELTER_B },
      { scope: 'SAFETY_MESSAGE', message: 'x', role: 'COORDINATOR' },
      { scope: 'SAFETY_MESSAGE', message: 'x', subjectPersonId: ids.person('noor') },
      { scope: 'EVERYTHING', message: 'x' },
    ];
    for (const body of bad) {
      const res = await respond(leo, r.id, r.version, body);
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
    expect({ responses: await h.prisma.response.count(), grants: await h.prisma.sharingGrant.count(), consents: await h.prisma.consentRecord.count() }).toEqual(before);
    // The request remains answerable after rejected attempts.
    expect((await respond(leo, r.id, r.version, { scope: 'SAFETY_MESSAGE', message: 'valid' })).status).toBe(201);
  });

  it('a contact code or case reference is never a credential', async () => {
    const leo = await h.login('leo');
    const code = await contactCode(leo);
    const rec = await h.client().post(`${API}/auth/recover`, { username: 'leo', recoverySecret: code, newPassword: 'attacker passphrase 1' });
    expect(rec.status).toBe(401);
    const login = await h.client().post(`${API}/auth/login`, { username: 'leo', password: code });
    expect(login.status).toBe(401);
  });
});
