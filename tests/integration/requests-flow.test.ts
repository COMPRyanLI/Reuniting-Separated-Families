import { describe, expect, it } from 'vitest';
import { fixtureId } from '../../prisma/fixtures.js';
import { DAY, HOUR } from '../../apps/api/src/lib/clock.js';
import { ids, useHarness } from '../support/harness.js';
import { API, contactCode, deliveredRequest, drain, incoming, key, outgoing, respond, sendCodeRequest } from '../support/flows.js';

const h = useHarness({ configOverrides: { RATE_LIMIT_REQUESTS_PER_HOUR: '1000' } });
const LEO_SHELTER_B = fixtureId('checkin:leo-shelter-b');
const LEO_DOWNTOWN = fixtureId('checkin:leo-downtown');

describe('FLOW-01 code request and approved safety message', () => {
  it('Maya submits Leo’s code, Leo sees the intended introduction, Maya receives only the approved message after delivery', async () => {
    const leo = await h.login('leo');
    const maya = await h.login('maya');
    const code = await contactCode(leo);
    const sent = await sendCodeRequest(maya, code, 'It is Maya, your sister. SENTINEL_INTRO_FLOW1');
    expect(sent.status).toBe(202);
    expect(Object.keys(sent.body).sort()).toEqual(['requestId', 'status']);
    expect(sent.body.status).toBe('submitted');
    // Before the worker runs, nothing is delivered.
    expect((await incoming(leo)).find((r) => r.id === sent.body.requestId)).toBeUndefined();
    await drain(h);
    const inc = (await incoming(leo)).find((r) => r.id === sent.body.requestId)!;
    expect(inc.requesterAlias).toBe('Maya R.');
    expect(inc.introduction).toContain('SENTINEL_INTRO_FLOW1');
    expect(inc.status).toBe('AWAITING_DECISION');
    const leoNotes = await leo.get(`${API}/notifications`);
    expect(leoNotes.body.notifications.some((n: { kind: string }) => n.kind === 'REQUEST_RECEIVED')).toBe(true);

    const res = await respond(leo, inc.id, inc.version, { scope: 'SAFETY_MESSAGE', message: 'Safe at a friend’s. SENTINEL_MSG_FLOW1' });
    expect(res.status).toBe(201);
    await drain(h);
    const out = (await outgoing(maya)).find((r) => r.id === sent.body.requestId)!;
    expect(out.status).toBe('RESPONSE_AVAILABLE');
    const view = await maya.get(`${API}/responses/${out.responseId}`);
    expect(view.status).toBe(200);
    expect(view.body).toEqual({
      responseId: out.responseId,
      scope: 'SAFETY_MESSAGE',
      sharedAlias: 'Leo (Maya’s brother)',
      statement: 'REPORTED_OK',
      message: 'Safe at a friend’s. SENTINEL_MSG_FLOW1',
      respondedAt: expect.any(String),
      expiresAt: expect.any(String),
    });
    const mayaNotes = await maya.get(`${API}/notifications`);
    const note = mayaNotes.body.notifications.find((n: { kind: string }) => n.kind === 'RESPONSE_AVAILABLE');
    expect(note).toBeDefined();
    expect(JSON.stringify(mayaNotes.body)).not.toContain('SENTINEL_MSG_FLOW1');
    // The request and response persist in PostgreSQL.
    expect(await h.prisma.response.count({ where: { requestId: inc.id } })).toBe(1);
  });
});

describe('FLOW-02 separate area and shelter disclosures', () => {
  it('each view matches its scope exactly and never broadens', async () => {
    const leo = await h.login('leo');
    const maya = await h.login('maya');
    const r1 = await deliveredRequest(h, maya, leo, 'Area please');
    expect((await respond(leo, r1.id, r1.version, { scope: 'AREA', checkInId: LEO_SHELTER_B })).status).toBe(201);
    const r2 = await deliveredRequest(h, maya, leo, 'Which shelter?');
    expect((await respond(leo, r2.id, r2.version, { scope: 'SHELTER', checkInId: LEO_SHELTER_B, expiresIn: '24h' })).status).toBe(201);
    const outs = await outgoing(maya);
    const area = await maya.get(`${API}/responses/${outs.find((o) => o.id === r1.id)!.responseId}`);
    const shelter = await maya.get(`${API}/responses/${outs.find((o) => o.id === r2.id)!.responseId}`);
    expect(area.body.location).toEqual({
      kind: 'AREA',
      areaLabel: 'Hillcrest',
      observedAt: expect.any(String),
      source: 'self_report',
      reportStatus: 'AS_REPORTED',
    });
    expect(JSON.stringify(area.body)).not.toMatch(/Hillcrest School Gym|42 Sample Road|shelter/i);
    expect(shelter.body.location).toEqual({
      kind: 'SHELTER',
      areaLabel: 'Hillcrest',
      shelterName: 'Hillcrest School Gym',
      shelterAddress: '42 Sample Road, Fictional City',
      observedAt: expect.any(String),
      source: 'self_report',
      reportStatus: 'AS_REPORTED',
    });
    // The first grant stays area-only after the second, broader one.
    const again = await maya.get(`${API}/responses/${outs.find((o) => o.id === r1.id)!.responseId}`);
    expect(again.body.location.shelterName).toBeUndefined();
    const hours = (new Date(shelter.body.expiresAt).getTime() - new Date(shelter.body.respondedAt).getTime()) / HOUR;
    expect(hours).toBe(24);
  });
});

describe('FLOW-03 private requester without location receives a grant', () => {
  it('Noor reads Leo’s report; Leo gets nothing about Noor', async () => {
    const leo = await h.login('leo');
    const noor = await h.login('noor');
    const r = await deliveredRequest(h, noor, leo, 'Noor here. SENTINEL_NOOR_INTRO');
    expect(r.requesterAlias).toBe('Noor');
    expect((await respond(leo, r.id, r.version, { scope: 'AREA', checkInId: LEO_DOWNTOWN })).status).toBe(201);
    const out = (await outgoing(noor)).find((o) => o.id === r.id)!;
    const view = await noor.get(`${API}/responses/${out.responseId}`);
    expect(view.status).toBe(200);
    expect(view.body.location.areaLabel).toBe('Downtown');
    expect(await h.prisma.sharingGrant.count({ where: { recipientPersonId: ids.person('leo'), subjectPersonId: ids.person('noor') } })).toBe(0);
    // Leo's view of Noor's request carries Noor's chosen alias and introduction only.
    const fromNoor = (await incoming(leo)).find((x) => x.id === r.id)!;
    expect(Object.keys(fromNoor).sort()).toEqual(['expiresAt', 'id', 'introduction', 'receivedAt', 'requesterAlias', 'status', 'version', 'yourResponse']);
    expect(JSON.stringify(fromNoor)).not.toMatch(/checkIn|areaLabel|shelterName|location/i);
    const leoShared = await leo.get(`${API}/responses`);
    expect(leoShared.body.responses.some((x: { sharedAlias: string }) => x.sharedAlias === 'Noor')).toBe(false);
  });
});

describe('FLOW-04 different scopes per recipient; outsiders get 404', () => {
  it('Maya and Noor see only their own scope; Evan and shared URLs get the neutral 404', async () => {
    const leo = await h.login('leo');
    const maya = await h.login('maya');
    const noor = await h.login('noor');
    const evan = await h.login('evan');
    const rm = await deliveredRequest(h, maya, leo, 'from maya');
    const rn = await deliveredRequest(h, noor, leo, 'from noor');
    await respond(leo, rm.id, rm.version, { scope: 'SAFETY_MESSAGE', message: 'For Maya only' });
    await respond(leo, rn.id, rn.version, { scope: 'SHELTER', checkInId: LEO_SHELTER_B });
    const mayaResp = (await outgoing(maya)).find((o) => o.id === rm.id)!.responseId!;
    const noorResp = (await outgoing(noor)).find((o) => o.id === rn.id)!.responseId!;
    expect((await maya.get(`${API}/responses/${mayaResp}`)).body.location).toBeUndefined();
    expect((await noor.get(`${API}/responses/${noorResp}`)).body.location.shelterName).toBe('Hillcrest School Gym');
    const denied = [
      await maya.get(`${API}/responses/${noorResp}`),
      await noor.get(`${API}/responses/${mayaResp}`),
      await evan.get(`${API}/responses/${mayaResp}`),
      await evan.get(`${API}/responses/${noorResp}`),
      await leo.get(`${API}/responses/${noorResp}`), // even the subject reads via own grants list, not the recipient view
    ];
    for (const d of denied) {
      expect(d.status).toBe(404);
      expect({ ...d.body.error, requestId: 0 }).toEqual({ code: 'NOT_FOUND', message: 'Not found.', requestId: 0 });
    }
    expect((await h.client().get(`${API}/responses/${mayaResp}`)).status).toBe(401);
  });
});

describe('PRIV-04 revocation and expiry stop every later read', () => {
  it('revoked grant: URL, notification link and idempotent replay all deny', async () => {
    const leo = await h.login('leo');
    const maya = await h.login('maya');
    const r = await deliveredRequest(h, maya, leo, 'revocation test');
    const k = key();
    const created = await respond(leo, r.id, r.version, { scope: 'AREA', checkInId: LEO_SHELTER_B }, k);
    await drain(h);
    const responseId = (await outgoing(maya)).find((o) => o.id === r.id)!.responseId!;
    expect((await maya.get(`${API}/responses/${responseId}`)).status).toBe(200);
    const grants = await leo.get(`${API}/me/grants`);
    const grant = grants.body.grants.find((g: { grantId: string; status: string }) => g.status === 'ACTIVE' && g.grantId === created.body.grantId);
    expect(grant).toBeDefined();
    expect((await leo.post(`${API}/grants/${grant.grantId}/revoke`)).status).toBe(200);
    expect((await leo.post(`${API}/grants/${grant.grantId}/revoke`)).status).toBe(200); // idempotent
    expect((await maya.get(`${API}/responses/${responseId}`)).status).toBe(404);
    const out = (await outgoing(maya)).find((o) => o.id === r.id)!;
    expect(out.status).toBe('RESPONSE_UNAVAILABLE');
    expect(out.responseId).toBeNull();
    // Replaying the approval with the same key returns the original outcome reference; it does not re-grant.
    const replay = await respond(leo, r.id, r.version, { scope: 'AREA', checkInId: LEO_SHELTER_B }, k);
    expect([200, 201]).toContain(replay.status);
    expect((await maya.get(`${API}/responses/${responseId}`)).status).toBe(404);
    const notes = await maya.get(`${API}/notifications`);
    expect(JSON.stringify(notes.body)).not.toMatch(/Hillcrest/);
  });

  it('expired grant denies after its 24-hour window; revoke-all revokes every active outbound grant', async () => {
    const leo = await h.login('leo');
    const noor = await h.login('noor');
    const r = await deliveredRequest(h, noor, leo, 'expiry test');
    await respond(leo, r.id, r.version, { scope: 'SAFETY_MESSAGE', message: 'brief', expiresIn: '24h' });
    const responseId = (await outgoing(noor)).find((o) => o.id === r.id)!.responseId!;
    h.clock.advance(24 * HOUR - 1000);
    // Sessions idle out long before a day passes; sign in again to read.
    expect((await (await h.login('noor')).get(`${API}/responses/${responseId}`)).status).toBe(200);
    h.clock.advance(2000);
    const leo2 = await h.login('leo');
    const noor2 = await h.login('noor');
    expect((await noor2.get(`${API}/responses/${responseId}`)).status).toBe(404);
    expect((await outgoing(noor2)).find((o) => o.id === r.id)!.status).toBe('RESPONSE_UNAVAILABLE');

    const r2 = await deliveredRequest(h, noor2, leo2, 'another');
    await respond(leo2, r2.id, r2.version, { scope: 'SAFETY_MESSAGE', message: 'x' });
    const all = await leo2.post(`${API}/me/grants/revoke-all`);
    expect(all.status).toBe(200);
    expect(all.body.revoked).toBeGreaterThanOrEqual(1);
    expect(await h.prisma.sharingGrant.count({ where: { subjectPersonId: ids.person('leo'), revokedAt: null, expiresAt: { gt: h.clock.now() } } })).toBe(0);
  });
});

describe('PRIV-05 ignore, decline and block look identical to the requester', () => {
  it('no recipient-specific outcome; block revokes existing grants and suppresses later delivery', async () => {
    const leo = await h.login('leo');
    const maya = await h.login('maya');
    const shape = (o: Record<string, unknown>) => ({ status: o.status, responseId: o.responseId, keys: Object.keys(o).sort() });

    const ignored = await deliveredRequest(h, maya, leo, 'ignored one');
    const declined = await deliveredRequest(h, maya, leo, 'declined one');
    expect((await leo.post(`${API}/requests/${declined.id}/decline`)).status).toBe(200);

    // An existing response to Maya, later revoked by the block.
    const granted = await deliveredRequest(h, maya, leo, 'granted one');
    await respond(leo, granted.id, granted.version, { scope: 'SAFETY_MESSAGE', message: 'before block' });
    const grantedResponseId = (await outgoing(maya)).find((o) => o.id === granted.id)!.responseId!;
    expect((await maya.get(`${API}/responses/${grantedResponseId}`)).status).toBe(200);

    const toBlock = await deliveredRequest(h, maya, leo, 'blocked one');
    const notesBefore = (await maya.get(`${API}/notifications`)).body.notifications.length;
    expect((await leo.post(`${API}/requests/${toBlock.id}/block`)).status).toBe(200);
    await drain(h);

    const outs = await outgoing(maya);
    const s = (id: string) => shape(outs.find((o) => o.id === id)! as unknown as Record<string, unknown>);
    expect(s(declined.id)).toEqual(s(ignored.id));
    expect(s(toBlock.id)).toEqual(s(ignored.id));
    expect(s(ignored.id).status).toBe('NO_RESPONSE_YET');
    expect((await maya.get(`${API}/notifications`)).body.notifications.length).toBe(notesBefore); // no block notice
    expect((await maya.get(`${API}/responses/${grantedResponseId}`)).status).toBe(404);

    // Later delivery is suppressed without telling Maya.
    const leoNotesBefore = (await leo.get(`${API}/notifications`)).body.notifications.length;
    const code = await contactCode(leo);
    const later = await sendCodeRequest(maya, code, 'after block');
    expect(later.status).toBe(202);
    await drain(h);
    expect((await incoming(leo)).find((r) => r.id === later.body.requestId)).toBeUndefined();
    expect((await leo.get(`${API}/notifications`)).body.notifications.length).toBe(leoNotesBefore);
    expect(s(ignored.id)).toEqual(shape((await outgoing(maya)).find((o) => o.id === later.body.requestId)! as unknown as Record<string, unknown>));

    // At the original 14-day deadline every unanswered request expires identically.
    h.clock.advance(14 * DAY + 1000);
    const maya2 = await h.login('maya');
    const expired = await outgoing(maya2);
    for (const id of [ignored.id, declined.id, toBlock.id, later.body.requestId]) {
      expect(expired.find((o) => o.id === id)!.status).toBe('EXPIRED');
    }
  });
});

describe('PRIV-07 a grant covers one report, never history or future reports', () => {
  it('superseding or departing marks the shared report obsolete without revealing the new location', async () => {
    const maya = await h.login('maya');
    const c = h.client();
    const reg = await c.post(`${API}/auth/register`, { username: 'subject.seven', password: 'long enough passphrase', alias: 'Seven' });
    c.csrf = reg.body.session.csrfToken;
    const first = await c.post(`${API}/me/check-ins`, { shelterId: ids.shelter('B'), observedAt: h.clock.now().toISOString() }, { 'Idempotency-Key': key() });
    const r = await deliveredRequest(h, maya, c, 'history test');
    await respond(c, r.id, r.version, { scope: 'SHELTER', checkInId: first.body.checkIn.id });
    const responseId = (await outgoing(maya)).find((o) => o.id === r.id)!.responseId!;
    const before = await maya.get(`${API}/responses/${responseId}`);
    expect(before.body.location.reportStatus).toBe('AS_REPORTED');

    await c.post(`${API}/me/check-ins`, { shelterId: ids.shelter('D'), observedAt: h.clock.now().toISOString(), supersedesId: first.body.checkIn.id }, { 'Idempotency-Key': key() });
    await c.post(`${API}/me/check-ins`, { areaId: fixtureId('area:demo-hurricane-1:Airport Road'), observedAt: h.clock.now().toISOString() }, { 'Idempotency-Key': key() });
    const after = await maya.get(`${API}/responses/${responseId}`);
    expect(after.body.location.reportStatus).toBe('NO_LONGER_CURRENT');
    expect(after.body.location.shelterName).toBe('Hillcrest School Gym');
    const text = JSON.stringify(after.body);
    expect(text).not.toMatch(/Lakeside|Airport Road|7 Placeholder Lane/);
    // No route exposes the subject's other reports or person record.
    for (const path of [`/people/${ids.person('leo')}`, `/people/${reg.body.session.person.id}/check-ins`, `/check-ins/${first.body.checkIn.id}`]) {
      expect((await maya.get(`${API}${path}`)).status).toBe(404);
    }
  });
});

describe('withdrawal and abuse reports', () => {
  it('requester withdrawal prevents later approval; reports reference only accessible records', async () => {
    // Evan is the requester here (Leo blocked Maya in the PRIV-05 test above).
    const leo = await h.login('leo');
    const evan = await h.login('evan');
    const outsider = await h.login('maya');
    const r = await deliveredRequest(h, evan, leo, 'withdraw me');
    expect((await evan.post(`${API}/requests/${r.id}/withdraw`)).status).toBe(200);
    expect((await outgoing(evan)).find((o) => o.id === r.id)!.status).toBe('WITHDRAWN');
    const late = await respond(leo, r.id, r.version, { scope: 'SAFETY_MESSAGE', message: 'late' });
    expect(late.status).toBe(409);
    expect(await h.prisma.response.count({ where: { requestId: r.id } })).toBe(0);
    expect((await incoming(leo)).find((x) => x.id === r.id)!.status).toBe('CLOSED');

    const report = await leo.post(`${API}/abuse-reports`, { requestId: r.id, category: 'HARASSMENT' });
    expect(report.status).toBe(201);
    expect(Object.keys(report.body)).toEqual(['reportId']);
    expect((await outsider.post(`${API}/abuse-reports`, { requestId: r.id, category: 'OTHER' })).status).toBe(404);
  });
});
