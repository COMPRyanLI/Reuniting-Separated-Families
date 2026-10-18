import { describe, expect, it } from 'vitest';
import { demoSecret, fixtureId } from '../../prisma/fixtures.js';
import { SEED_SECRET } from '../support/env.js';
import { ids, useHarness, type Client } from '../support/harness.js';
import { API, contactCode, drain, incoming, key, outgoing, respond } from '../support/flows.js';

const h = useHarness({ configOverrides: { RATE_LIMIT_REQUESTS_PER_HOUR: '1000' } });
const secret = (label: string) => demoSecret(SEED_SECRET, `assist:${label}`);
const caseUrl = (label: string) => `${API}/staff/cases/${ids.case(label)}`;

async function verified(staffKey: Parameters<typeof h.loginStaff>[0], caseLabel: string): Promise<Client> {
  const c = await h.loginStaff(staffKey);
  const v = await c.post(`${caseUrl(caseLabel)}/verify`, { assistanceSecret: secret(caseLabel) });
  expect(v.status, `verify ${caseLabel}`).toBe(200);
  return c;
}

describe('FLOW-05 Sam without account or device, through W-A', () => {
  it('intake-to-reply story with Sam as subject, W-A as actor, recorded consent and repeat verification', async () => {
    const leo = await h.login('leo');
    const leoCode = await contactCode(leo);
    const wA = await verified('wA', 'sam');
    const sent = await wA.post(`${caseUrl('sam')}/requests`, { routeType: 'CODE', contactCode: leoCode, introduction: 'Sam here, at Riverside. SENTINEL_SAM_INTRO' }, { 'Idempotency-Key': key() });
    expect(sent.status).toBe(202);
    const request = await h.prisma.reunionRequest.findUniqueOrThrow({ where: { id: sent.body.requestId } });
    expect(request.requesterPersonId).toBe(ids.assisted('sam'));
    expect(request.createdByAccountId).toBe(ids.account('worker.a'));
    expect(request.createdViaCaseId).toBe(ids.case('sam'));
    await drain(h);
    const inc = (await incoming(leo)).find((r) => r.id === sent.body.requestId)!;
    expect(inc.requesterAlias).toBe('Sam');
    expect((await respond(leo, inc.id, inc.version, { scope: 'AREA', checkInId: fixtureId('checkin:leo-shelter-b') })).status).toBe(201);
    await drain(h);

    // Sam's notification goes to the assigned case team, not to any account.
    const note = await h.prisma.notification.findFirst({ where: { assistedCaseId: ids.case('sam'), kind: 'RESPONSE_AVAILABLE' } });
    expect(note).not.toBeNull();

    // Repeat visit: without fresh verification the reply cannot be read.
    expect((await wA.post(`${caseUrl('sam')}/end-assistance`)).status).toBe(204);
    const locked = await wA.get(caseUrl('sam'));
    expect(locked.body.requests).toBeUndefined();
    const wA2 = await verified('wA', 'sam');
    const view = await wA2.get(caseUrl('sam'));
    const out = view.body.requests.outgoing.find((o: { id: string }) => o.id === sent.body.requestId);
    expect(out.status).toBe('RESPONSE_AVAILABLE');
    const reply = await wA2.get(`${caseUrl('sam')}/responses/${out.responseId}`);
    expect(reply.status).toBe(200);
    expect(reply.body.location).toMatchObject({ kind: 'AREA', areaLabel: 'Hillcrest' });
    expect(await h.prisma.person.findUniqueOrThrow({ where: { id: ids.assisted('sam') } }).then((p) => p.accountId)).toBeNull();
    // Another worker cannot read Sam's reply.
    const wA2other = await h.loginStaff('wA2');
    expect((await wA2other.get(`${caseUrl('sam')}/responses/${out.responseId}`)).status).toBe(404);
  });
});

describe('FLOW-06 no-code request routed to an opted-in case at Shelter B', () => {
  it('targeted staff matching, explicit recipient consent, no candidate data for the requester', async () => {
    const maya = await h.login('maya');
    const sent = await maya.post(
      `${API}/requests`,
      { routeType: 'ROUTED', introduction: 'Maya looking for her sister. SENTINEL_ROUTED_INTRO', clues: 'Sister Ana, often wears a grey cap', destinationShelterId: ids.shelter('B'), relayConsent: true },
      { 'Idempotency-Key': key() },
    );
    expect(sent.status).toBe(202);
    expect(Object.keys(sent.body).sort()).toEqual(['requestId', 'status']);
    const mine = (await outgoing(maya)).find((o) => o.id === sent.body.requestId)!;
    expect(mine.status).toBe('NO_RESPONSE_YET');
    expect(JSON.stringify(mine)).not.toMatch(/candidate|ROUTING|assigned|worker/i);
    const relay = await h.prisma.consentRecord.findFirstOrThrow({ where: { personId: ids.person('maya'), action: 'RELAY_CLUES', resourceId: ids.shelter('B') } });
    expect(relay.actorAccountId).toBe(ids.account('maya'));

    const cB = await h.loginStaff('cB');
    const tasks = await cB.get(`${API}/staff/tasks`);
    const route = tasks.body.routeQueue.find((r: { requestId: string }) => r.requestId === sent.body.requestId);
    expect(route.clues).toContain('grey cap');
    expect((await cB.post(`${API}/staff/routes/${route.routeId}/assign`, { membershipId: ids.membership('worker.b') })).status).toBe(200);

    const wB = await h.loginStaff('wB');
    expect((await wB.get(`${API}/staff/tasks`)).body.matchingTasks.map((t: { routeId: string }) => t.routeId)).toContain(route.routeId);
    const cands = await wB.get(`${API}/staff/routes/${route.routeId}/candidates`);
    expect(cands.status).toBe(200);
    const aliases = cands.body.candidates.map((c: { alias: string }) => c.alias);
    expect(aliases).toContain('Ana');
    for (const excluded of ['Bo', 'Cy', 'Sam', 'Kit', 'Leo (Maya’s brother)', 'R (referral)']) expect(aliases).not.toContain(excluded);
    for (const c of cands.body.candidates) expect(Object.keys(c).sort()).toEqual(['alias', 'candidateToken', 'clue']);
    expect(JSON.stringify(cands.body)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i); // no internal IDs

    const ana = cands.body.candidates.find((c: { alias: string }) => c.alias === 'Ana');
    const grantsBefore = await h.prisma.sharingGrant.count();
    expect((await wB.post(`${API}/staff/routes/${route.routeId}/propose-recipient`, { candidateToken: ana.candidateToken })).status).toBe(200);
    expect(await h.prisma.sharingGrant.count()).toBe(grantsBefore); // proposal is not consent
    expect((await outgoing(maya)).find((o) => o.id === sent.body.requestId)!.status).toBe('NO_RESPONSE_YET');
    expect((await wB.get(`${API}/staff/routes/${route.routeId}/candidates`)).status).toBe(404); // task finished
    await drain(h);

    const wBv = await verified('wB', 'ana');
    const anaView = await wBv.get(caseUrl('ana'));
    const req = anaView.body.requests.incoming.find((r: { id: string }) => r.id === sent.body.requestId);
    expect(req.requesterAlias).toBe('Maya R.');
    expect(req.introduction).toContain('SENTINEL_ROUTED_INTRO');
    expect(anaView.body.notifications.some((n: { kind: string }) => n.kind === 'REQUEST_RECEIVED')).toBe(true);
    const ok = await wBv.post(
      `${caseUrl('ana')}/requests/${req.id}/respond`,
      { scope: 'SHELTER', checkInId: fixtureId('checkin:ana-shelter-b'), statement: 'REPORTED_OK', expiresIn: '7d', expectedVersion: req.version },
      { 'Idempotency-Key': key() },
    );
    expect(ok.status).toBe(201);
    const out = (await outgoing(maya)).find((o) => o.id === sent.body.requestId)!;
    expect(out.status).toBe('RESPONSE_AVAILABLE');
    const view = await maya.get(`${API}/responses/${out.responseId}`);
    expect(view.body).toMatchObject({ sharedAlias: 'Ana', location: { kind: 'SHELTER', shelterName: 'Hillcrest School Gym', source: 'staff_recorded' } });
    // The requester has no access to staff matching endpoints.
    expect((await maya.get(`${API}/staff/routes/${route.routeId}/candidates`)).status).toBe(403);
  });
});

describe('PRIV-08 and STAFF-05 candidate scope', () => {
  it('excludes closed/code-only people; access ends when the task or opt-in changes; operators and unassigned coordinators browse nothing', async () => {
    const noor = await h.login('noor');
    const sent = await noor.post(`${API}/requests`, { routeType: 'ROUTED', introduction: 'Noor searching', clues: 'Ana?', destinationShelterId: ids.shelter('B'), relayConsent: true }, { 'Idempotency-Key': key() });
    const cB = await h.loginStaff('cB');
    const route = (await cB.get(`${API}/staff/tasks`)).body.routeQueue.find((r: { requestId: string }) => r.requestId === sent.body.requestId);
    await cB.post(`${API}/staff/routes/${route.routeId}/assign`, { membershipId: ids.membership('worker.b') });
    const wB = await verified('wB', 'bo');
    const first = await wB.get(`${API}/staff/routes/${route.routeId}/candidates`);
    expect(first.body.candidates.map((c: { alias: string }) => c.alias)).not.toContain('Bo');

    // Bo opts in: appears. Bo opts out again: disappears and the old token is refused.
    const bo = await wB.get(caseUrl('bo'));
    await wB.patch(`${caseUrl('bo')}/privacy`, { requestMode: 'ASSISTED', matchingClue: 'Tall, plays chess', expectedVersion: bo.body.version });
    const withBo = await wB.get(`${API}/staff/routes/${route.routeId}/candidates`);
    const boCand = withBo.body.candidates.find((c: { alias: string }) => c.alias === 'Bo');
    expect(boCand?.clue).toBe('Tall, plays chess');
    const bo2 = await wB.get(caseUrl('bo'));
    await wB.patch(`${caseUrl('bo')}/privacy`, { requestMode: 'CODE_ONLY', expectedVersion: bo2.body.version });
    expect((await wB.get(`${API}/staff/routes/${route.routeId}/candidates`)).body.candidates.map((c: { alias: string }) => c.alias)).not.toContain('Bo');
    expect((await wB.post(`${API}/staff/routes/${route.routeId}/propose-recipient`, { candidateToken: boCand.candidateToken })).status).toBe(422);

    // Operator and an unassigned coordinator see no candidates or cases.
    const op = await h.loginStaff('op');
    const cA = await h.loginStaff('cA');
    for (const c of [op, cA, cB]) {
      expect((await c.get(`${API}/staff/routes/${route.routeId}/candidates`)).status).toBe(404);
      for (const label of ['ana', 'bo', 'cy']) expect((await c.get(caseUrl(label))).status).toBe(404);
    }
    const opTasks = await op.get(`${API}/staff/tasks`);
    expect(opTasks.body.cases).toEqual([]);
    expect(opTasks.body.caseIndex).toEqual([]);
    expect(opTasks.body.routeQueue).toEqual([]);
    for (const path of ['/staff/people', '/staff/search?q=Ana', '/people', '/staff/cases']) {
      expect((await op.get(`${API}${path}`)).status, path).toBe(404);
    }

    // Reassigning the task to someone else removes W-B's access.
    const cB2 = await h.loginStaff('cB');
    await h.prisma.staffMembership.create({ data: { id: fixtureId('membership:extra.b'), accountId: ids.account('worker.a2'), incidentId: ids.incident('demo-hurricane-1'), shelterId: ids.shelter('B'), role: 'WORKER', createdAt: h.clock.now() } });
    expect((await cB2.post(`${API}/staff/routes/${route.routeId}/assign`, { membershipId: fixtureId('membership:extra.b') })).status).toBe(200);
    expect((await wB.get(`${API}/staff/routes/${route.routeId}/candidates`)).status).toBe(404);
  });
});

describe('STAFF-04 only the recipient’s verified worker records the recipient’s decision', () => {
  it('source worker is denied; recipient worker succeeds with verification and exact consent', async () => {
    const wBv = await verified('wB', 'ana');
    const anaCode = (await wBv.post(`${caseUrl('ana')}/contact-code/rotate`)).body.contactCode;
    const wA = await verified('wA', 'sam');
    const sent = await wA.post(`${caseUrl('sam')}/requests`, { routeType: 'CODE', contactCode: anaCode, introduction: 'Sam to Ana' }, { 'Idempotency-Key': key() });
    await drain(h);
    const req = await h.prisma.reunionRequest.findUniqueOrThrow({ where: { id: sent.body.requestId } });
    expect(req.recipientPersonId).toBe(ids.assisted('ana'));
    const body = { scope: 'SAFETY_MESSAGE', statement: 'REPORTED_OK', expiresIn: '24h', expectedVersion: req.version };
    // W-A (requester side) has no authority over Ana's decision.
    expect((await wA.post(`${caseUrl('ana')}/requests/${req.id}/respond`, body, { 'Idempotency-Key': key() })).status).toBe(404);
    expect((await wA.post(`${caseUrl('sam')}/requests/${req.id}/respond`, body, { 'Idempotency-Key': key() })).status).toBe(404);
    // W-B without current verification is refused.
    const wBfresh = await h.loginStaff('wB');
    await wBfresh.post(`${caseUrl('ana')}/end-assistance`);
    expect((await wBfresh.post(`${caseUrl('ana')}/requests/${req.id}/respond`, body, { 'Idempotency-Key': key() })).body.error.code).toBe('VERIFICATION_REQUIRED');
    const wBok = await verified('wB', 'ana');
    const ok = await wBok.post(`${caseUrl('ana')}/requests/${req.id}/respond`, body, { 'Idempotency-Key': key() });
    expect(ok.status).toBe(201);
    const consent = await h.prisma.consentRecord.findFirstOrThrow({ where: { personId: ids.assisted('ana'), action: 'APPROVE_DISCLOSURE', resourceId: req.id } });
    expect(consent).toMatchObject({ actorAccountId: ids.account('worker.b'), caseId: ids.case('ana'), scope: 'SAFETY_MESSAGE', recipientPersonId: ids.assisted('sam') });
    expect(consent.assistanceSessionId).not.toBeNull();
    const auditRow = await h.prisma.auditEvent.findFirstOrThrow({ where: { action: 'request.respond', objectId: ok.body.responseId } });
    expect(auditRow).toMatchObject({ actorAccountId: ids.account('worker.b'), authorityType: 'ASSISTED_CASE', authorityId: ids.case('ana') });
  });
});

describe('STAFF-06 unresolved requests stay internal; rerouting needs a new relay choice', () => {
  it('no lead means no route and no clue; a new lead ends the old destination’s access', async () => {
    const evan = await h.login('evan');
    const noLead = await evan.post(`${API}/requests`, { routeType: 'ROUTED', introduction: 'Evan, no lead', clues: 'Someone called Kai' }, { 'Idempotency-Key': key() });
    expect(noLead.status).toBe(202);
    expect(await h.prisma.requestRoute.count({ where: { requestId: noLead.body.requestId } })).toBe(0);
    expect((await h.prisma.reunionRequest.findUniqueOrThrow({ where: { id: noLead.body.requestId } })).internalState).toBe('UNRESOLVED');
    const cB = await h.loginStaff('cB');
    expect(JSON.stringify((await cB.get(`${API}/staff/tasks`)).body)).not.toContain('Someone called Kai');
    expect((await outgoing(evan)).find((o) => o.id === noLead.body.requestId)!.status).toBe('NO_RESPONSE_YET');
    // A lead change needs an explicit relay choice; staff cannot reroute on their own.
    const v = (await outgoing(evan)).find((o) => o.id === noLead.body.requestId)!.version;
    expect((await evan.post(`${API}/requests/${noLead.body.requestId}/lead`, { destinationShelterId: ids.shelter('B'), expectedVersion: v })).status).toBe(422);
    expect((await cB.post(`${API}/staff/requests/${noLead.body.requestId}/route`, { destinationShelterId: ids.shelter('B') })).status).toBe(404);
    expect((await evan.post(`${API}/requests/${noLead.body.requestId}/lead`, { destinationShelterId: ids.shelter('B'), relayConsent: true, expectedVersion: v })).status).toBe(200);
    const toB = (await cB.get(`${API}/staff/tasks`)).body.routeQueue.find((r: { requestId: string }) => r.requestId === noLead.body.requestId);
    expect(toB).toBeDefined();
    await cB.post(`${API}/staff/routes/${toB.routeId}/assign`, { membershipId: ids.membership('worker.b') });
    const wB = await h.loginStaff('wB');
    expect((await wB.get(`${API}/staff/routes/${toB.routeId}/candidates`)).status).toBe(200);
    // New lead to Shelter D: B's route ends and B's staff lose the task; never two destinations.
    const v2 = (await outgoing(evan)).find((o) => o.id === noLead.body.requestId)!.version;
    expect((await evan.post(`${API}/requests/${noLead.body.requestId}/lead`, { destinationShelterId: ids.shelter('D'), relayConsent: true, expectedVersion: v2 })).status).toBe(200);
    expect((await wB.get(`${API}/staff/routes/${toB.routeId}/candidates`)).status).toBe(404);
    expect((await cB.get(`${API}/staff/tasks`)).body.routeQueue.find((r: { requestId: string }) => r.requestId === noLead.body.requestId)).toBeUndefined();
    expect(await h.prisma.requestRoute.count({ where: { requestId: noLead.body.requestId, endedAt: null } })).toBe(1);
    // Shelter D has no staff: the request just stays unresolved, and Evan's view is unchanged.
    expect((await outgoing(evan)).find((o) => o.id === noLead.body.requestId)!.status).toBe('NO_RESPONSE_YET');
  });

  it('the requester’s own shelter coordinator can ask for another lead without revealing anything', async () => {
    const wA = await verified('wA', 'sam');
    const sent = await wA.post(`${caseUrl('sam')}/requests`, { routeType: 'ROUTED', introduction: 'Sam asks', clues: 'Brother, tall' }, { 'Idempotency-Key': key() });
    const cA = await h.loginStaff('cA');
    const review = (await cA.get(`${API}/staff/tasks`)).body.leadReview.find((x: { requestId: string }) => x.requestId === sent.body.requestId);
    // The requester never agreed to share clues with their own shelter's coordinator: reference and time only.
    expect(Object.keys(review).sort()).toEqual(['caseReference', 'requestId', 'submittedAt']);
    expect(JSON.stringify((await cA.get(`${API}/staff/tasks`)).body)).not.toContain('Brother, tall');
    const cB = await h.loginStaff('cB');
    expect((await cB.post(`${API}/staff/requests/${sent.body.requestId}/ask-for-lead`)).status).toBe(404);
    expect((await cA.post(`${API}/staff/requests/${sent.body.requestId}/ask-for-lead`)).status).toBe(200);
    await drain(h);
    expect(await h.prisma.notification.count({ where: { assistedCaseId: ids.case('sam'), kind: 'LEAD_REQUESTED' } })).toBe(1);

    // A routed request that found no match at B stays invisible to the origin coordinator (hidden outcome).
    const wA2 = await verified('wA', 'sam');
    const routed = await wA2.post(`${caseUrl('sam')}/requests`, { routeType: 'ROUTED', introduction: 'Sam routed', clues: 'Cousin', destinationShelterId: ids.shelter('B'), relayConsent: true }, { 'Idempotency-Key': key() });
    const cB2 = await h.loginStaff('cB');
    const route = (await cB2.get(`${API}/staff/tasks`)).body.routeQueue.find((x: { requestId: string }) => x.requestId === routed.body.requestId);
    expect((await cB2.post(`${API}/staff/routes/${route.routeId}/no-match`)).status).toBe(200);
    const cA2 = await h.loginStaff('cA');
    const lead = (await cA2.get(`${API}/staff/tasks`)).body.leadReview as { requestId: string }[];
    expect(lead.map((x) => x.requestId)).not.toContain(routed.body.requestId);
  });
});

describe('STAFF-07 case transfer A to B', () => {
  it('destination sees nothing before acceptance; source access ends after; unrelated cases unchanged', async () => {
    const wA = await verified('wA', 'sam');
    const proposal = await wA.post(`${caseUrl('sam')}/transfers`, { toShelterId: ids.shelter('B'), personConsent: true });
    expect(proposal.status).toBe(201);
    expect((await wA.post(`${caseUrl('sam')}/transfers`, { toShelterId: ids.shelter('B'), personConsent: true })).status).toBe(409);
    const wB = await h.loginStaff('wB');
    expect((await wB.get(caseUrl('sam'))).status).toBe(404);
    const cB = await h.loginStaff('cB');
    const pending = (await cB.get(`${API}/staff/tasks`)).body.incomingTransfers.find((t: { transferId: string }) => t.transferId === proposal.body.transferId);
    expect(Object.keys(pending).sort()).toEqual(['alias', 'caseReference', 'createdAt', 'fromShelterName', 'toShelterId', 'transferId']);
    expect((await cB.get(caseUrl('sam'))).status).toBe(404);
    const wrong = await cB.post(`${API}/staff/transfers/${proposal.body.transferId}/accept`, { assistanceSecret: secret('ana'), membershipId: ids.membership('worker.b') });
    expect(wrong.status).toBe(403);
    const accept = await cB.post(`${API}/staff/transfers/${proposal.body.transferId}/accept`, { assistanceSecret: secret('sam'), membershipId: ids.membership('worker.b') });
    expect(accept.status).toBe(200);

    expect((await wA.get(caseUrl('sam'))).status).toBe(404);
    expect((await wA.post(`${caseUrl('sam')}/check-ins`, { shelterId: ids.shelter('A'), observedAt: h.clock.now().toISOString() }, { 'Idempotency-Key': key() })).status).toBe(404);
    const destination = await wB.get(caseUrl('sam'));
    expect(destination.status).toBe(200);
    expect(destination.body.shelter.name).toBe('Hillcrest School Gym');
    expect(destination.body.checkIns).toBeUndefined();
    const wBv = await verified('wB', 'sam');
    expect((await wBv.get(caseUrl('sam'))).body.checkIns.length).toBeGreaterThan(0);
    expect((await wA.get(caseUrl('r'))).status).toBe(200); // unrelated case unchanged
    expect((await cB.post(`${API}/staff/transfers/${proposal.body.transferId}/accept`, { assistanceSecret: secret('sam'), membershipId: ids.membership('worker.b') })).status).toBe(409);
  });
});

describe('STAFF-08 assisted privacy rights through current authority', () => {
  it('decline, block, withdraw, revoke and delete work for a verified assisted person; an ended assignment denies', async () => {
    const maya = await h.login('maya');
    const noor = await h.login('noor');
    const wB = await verified('wB', 'cy');
    // Cy keeps CLOSED for routing, but a code can still be issued to family; switch to CODE_ONLY first.
    const cy = await wB.get(caseUrl('cy'));
    await wB.patch(`${caseUrl('cy')}/privacy`, { requestMode: 'CODE_ONLY', expectedVersion: cy.body.version });
    const code1 = (await wB.post(`${caseUrl('cy')}/contact-code/rotate`)).body.contactCode;
    const a = await maya.post(`${API}/requests`, { routeType: 'CODE', contactCode: code1, introduction: 'to decline' }, { 'Idempotency-Key': key() });
    const b = await noor.post(`${API}/requests`, { routeType: 'CODE', contactCode: code1, introduction: 'to answer then block' }, { 'Idempotency-Key': key() });
    await drain(h);
    const view = await wB.get(caseUrl('cy'));
    const inc = (id: string) => view.body.requests.incoming.find((r: { id: string }) => r.id === id);
    expect((await wB.post(`${caseUrl('cy')}/requests/${a.body.requestId}/decline`)).status).toBe(200);
    const answered = await wB.post(`${caseUrl('cy')}/requests/${b.body.requestId}/respond`, { scope: 'SAFETY_MESSAGE', statement: 'REPORTED_OK', expiresIn: '7d', expectedVersion: inc(b.body.requestId).version }, { 'Idempotency-Key': key() });
    expect(answered.status).toBe(201);
    expect((await wB.post(`${caseUrl('cy')}/grants/${answered.body.grantId}/revoke`)).status).toBe(200);
    expect((await wB.post(`${caseUrl('cy')}/requests/${b.body.requestId}/block`)).status).toBe(200);
    expect(await h.prisma.block.count({ where: { subjectPersonId: ids.assisted('cy'), blockedPersonId: ids.person('noor') } })).toBe(1);
    // Cy's own outgoing request, then withdrawn.
    const leo = await h.login('leo');
    const own = await wB.post(`${caseUrl('cy')}/requests`, { routeType: 'CODE', contactCode: await contactCode(leo), introduction: 'Cy to Leo' }, { 'Idempotency-Key': key() });
    expect((await wB.post(`${caseUrl('cy')}/requests/${own.body.requestId}/withdraw`)).status).toBe(200);
    expect((await wB.post(`${caseUrl('cy')}/grants/revoke-all`)).status).toBe(200);

    // No staff path links the case to an account or impersonates the person.
    for (const path of ['/staff/cases/' + ids.case('cy') + '/link-account', '/staff/cases/' + ids.case('cy') + '/login-as']) {
      expect((await wB.post(`${API}${path}`, {})).status).toBe(404);
    }
    // Deletion through verified assistance closes the case and revokes access.
    expect((await wB.delete(`${caseUrl('cy')}/person`, { confirm: true })).status).toBe(204);
    expect((await wB.get(caseUrl('cy'))).status).toBe(404);
    const person = await h.prisma.person.findUniqueOrThrow({ where: { id: ids.assisted('cy') } });
    expect(person.deletedAt).not.toBeNull();
    expect(await h.prisma.sharingGrant.count({ where: { subjectPersonId: ids.assisted('cy'), revokedAt: null } })).toBe(0);

    // Expired assignment: the coordinator ends W-B's assignment on Bo; the retry is denied.
    const cB = await h.loginStaff('cB');
    const assignment = await h.prisma.caseAssignment.findFirstOrThrow({ where: { caseId: ids.case('bo'), staffAccountId: ids.account('worker.b'), endsAt: null } });
    expect((await cB.post(`${caseUrl('bo')}/assignments/${assignment.id}/end`)).status).toBe(204);
    expect((await wB.get(caseUrl('bo'))).status).toBe(404);
    expect((await wB.post(`${caseUrl('bo')}/verify`, { assistanceSecret: secret('bo') })).status).toBe(404);
  });
});
