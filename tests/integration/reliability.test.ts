import { describe, expect, it } from 'vitest';
import { demoSecret, fixtureId } from '../../prisma/fixtures.js';
import { processDueJobs } from '../../apps/api/src/jobs/outbox.js';
import { SEED_SECRET } from '../support/env.js';
import { ids, useHarness } from '../support/harness.js';
import { API, contactCode, deliveredRequest, drain, key, outgoing, respond, sendCodeRequest } from '../support/flows.js';

const h = useHarness({ configOverrides: { RATE_LIMIT_REQUESTS_PER_HOUR: '1000' } });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('REL-01 twenty concurrent identical writes with one idempotency key', () => {
  it('check-in, request and approval each produce exactly one result and one event; a changed payload conflicts', async () => {
    const leo = await h.login('leo');
    const maya = await h.login('maya');

    const ck = key();
    const ciBody = { areaId: fixtureId('area:demo-hurricane-1:East Marsh'), observedAt: h.clock.now().toISOString() };
    const ciResults = await Promise.all(Array.from({ length: 20 }, () => leo.post(`${API}/me/check-ins`, ciBody, { 'Idempotency-Key': ck })));
    expect(new Set(ciResults.map((r) => r.body.checkIn?.id)).size).toBe(1);
    expect(ciResults.every((r) => [200, 201].includes(r.status))).toBe(true);
    expect(await h.prisma.checkIn.count({ where: { personId: ids.person('leo'), areaId: ciBody.areaId } })).toBe(1);

    const code = await contactCode(leo);
    const rk = key();
    const rqBody = { routeType: 'CODE', contactCode: code, introduction: 'concurrent' };
    const rqResults = await Promise.all(Array.from({ length: 20 }, () => maya.post(`${API}/requests`, rqBody, { 'Idempotency-Key': rk })));
    expect(rqResults.every((r) => r.status === 202)).toBe(true);
    const requestIds = new Set(rqResults.map((r) => r.body.requestId));
    expect(requestIds.size).toBe(1);
    const requestId = [...requestIds][0] as string;
    expect(await h.prisma.outboxJob.count({ where: { eventKey: `request.resolve:${requestId}` } })).toBe(1);
    await drain(h);
    expect(await h.prisma.notification.count({ where: { resourceId: requestId, kind: 'REQUEST_RECEIVED' } })).toBe(1);

    const req = await h.prisma.reunionRequest.findUniqueOrThrow({ where: { id: requestId } });
    const ak = key();
    const apBody = { scope: 'SAFETY_MESSAGE', statement: 'REPORTED_OK', expiresIn: '7d', expectedVersion: req.version };
    const apResults = await Promise.all(Array.from({ length: 20 }, () => leo.post(`${API}/requests/${requestId}/respond`, apBody, { 'Idempotency-Key': ak })));
    expect(apResults.every((r) => [200, 201].includes(r.status))).toBe(true);
    expect(new Set(apResults.map((r) => r.body.responseId)).size).toBe(1);
    expect(apResults.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await h.prisma.response.count({ where: { requestId } })).toBe(1);
    expect(await h.prisma.sharingGrant.count({ where: { requestId } })).toBe(1);
    expect(await h.prisma.outboxJob.count({ where: { kind: 'response.notify', referencePayload: { path: ['responseId'], equals: apResults[0]!.body.responseId } } })).toBe(1);

    const changed = await leo.post(`${API}/requests/${requestId}/respond`, { ...apBody, statement: 'NEED_HELP' }, { 'Idempotency-Key': ak });
    expect(changed.status).toBe(409);
    const changedCi = await leo.post(`${API}/me/check-ins`, { ...ciBody, reportedStatus: 'NEEDS_ASSISTANCE' }, { 'Idempotency-Key': ck });
    expect(changedCi.status).toBe(409);
  });
});

describe('REL-02 races serialize into one valid transition', () => {
  it('approve versus withdraw: never both a response and a withdrawal', async () => {
    const leo = await h.login('leo');
    const noor = await h.login('noor');
    for (let i = 0; i < 4; i++) {
      const r = await deliveredRequest(h, noor, leo, `race ${i}`);
      h.hooks.beforeApprovalCommit = () => sleep(40);
      const [ap, wd] = await Promise.all([
        respond(leo, r.id, r.version, { scope: 'SAFETY_MESSAGE', message: 'race' }),
        (async () => {
          await sleep(10);
          return noor.post(`${API}/requests/${r.id}/withdraw`);
        })(),
      ]);
      h.hooks.beforeApprovalCommit = undefined;
      const row = await h.prisma.reunionRequest.findUniqueOrThrow({ where: { id: r.id } });
      const responses = await h.prisma.response.count({ where: { requestId: r.id } });
      if (ap.status === 201) {
        expect(wd.status).toBe(409);
        expect(row.internalState).toBe('RESPONDED');
        expect(row.withdrawnAt).toBeNull();
        expect(responses).toBe(1);
      } else {
        expect(ap.status).toBe(409);
        expect(wd.status).toBe(200);
        expect(row.internalState).toBe('WITHDRAWN');
        expect(responses).toBe(0);
      }
    }
  });

  it('approve versus block: the blocked requester never keeps an active grant', async () => {
    const c = h.client();
    const reg = await c.post(`${API}/auth/register`, { username: 'race.subject', password: 'long enough passphrase', alias: 'RS' });
    c.csrf = reg.body.session.csrfToken;
    const evan = await h.login('evan');
    const r1 = await deliveredRequest(h, evan, c, 'first');
    const r2 = await deliveredRequest(h, evan, c, 'second');
    h.hooks.beforeApprovalCommit = () => sleep(40);
    await Promise.all([
      respond(c, r1.id, r1.version, { scope: 'SAFETY_MESSAGE', message: 'race' }),
      (async () => {
        await sleep(10);
        return c.post(`${API}/requests/${r2.id}/block`);
      })(),
    ]);
    h.hooks.beforeApprovalCommit = undefined;
    expect(await h.prisma.block.count({ where: { blockedPersonId: ids.person('evan'), subjectPersonId: reg.body.session.person.id } })).toBe(1);
    expect(await h.prisma.sharingGrant.count({ where: { recipientPersonId: ids.person('evan'), subjectPersonId: reg.body.session.person.id, revokedAt: null } })).toBe(0);
  });

  it('block committed while an approval to the same requester is mid-transaction still leaves no active grant', async () => {
    const c = h.client();
    const reg = await c.post(`${API}/auth/register`, { username: 'race.subject2', password: 'long enough passphrase', alias: 'RS2' });
    c.csrf = reg.body.session.csrfToken;
    const noor = await h.login('noor');
    const r1 = await deliveredRequest(h, noor, c, 'first');
    const r2 = await deliveredRequest(h, noor, c, 'second');
    // Deterministic interleaving: the approval has written its grant and pauses before commit.
    let reached!: () => void;
    const atHook = new Promise<void>((r) => (reached = r));
    h.hooks.beforeApprovalCommit = async () => {
      reached();
      await sleep(300);
    };
    const approval = respond(c, r1.id, r1.version, { scope: 'SAFETY_MESSAGE', message: 'race' });
    await atHook;
    const block = await c.post(`${API}/requests/${r2.id}/block`);
    await approval;
    h.hooks.beforeApprovalCommit = undefined;
    expect(block.status).toBe(200);
    expect(await h.prisma.sharingGrant.count({ where: { recipientPersonId: ids.person('noor'), subjectPersonId: reg.body.session.person.id, revokedAt: null } })).toBe(0);
  });

  it('two concurrent transfer acceptances: one wins, one active assignment, no partial handover', async () => {
    const wB = await h.loginStaff('wB');
    expect((await wB.post(`${API}/staff/cases/${ids.case('bo')}/verify`, { assistanceSecret: demoSecret(SEED_SECRET, 'assist:bo') })).status).toBe(200);
    const t = await wB.post(`${API}/staff/cases/${ids.case('bo')}/transfers`, { toShelterId: ids.shelter('A'), personConsent: true });
    expect(t.status).toBe(201);
    const cA = await h.loginStaff('cA');
    const body = { assistanceSecret: demoSecret(SEED_SECRET, 'assist:bo'), membershipId: ids.membership('worker.a') };
    const [x, y] = await Promise.all([
      cA.post(`${API}/staff/transfers/${t.body.transferId}/accept`, body),
      cA.post(`${API}/staff/transfers/${t.body.transferId}/accept`, body),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const active = await h.prisma.caseAssignment.findMany({ where: { caseId: ids.case('bo'), endsAt: null } });
    expect(active).toHaveLength(1);
    expect(active[0]!.staffAccountId).toBe(ids.account('worker.a'));
    expect((await h.prisma.assistanceCase.findUniqueOrThrow({ where: { id: ids.case('bo') } })).shelterId).toBe(ids.shelter('A'));
  });
});

describe('REL-03 worker crash after notification insert', () => {
  it('restart and retry produce exactly one visible notification and complete the job', async () => {
    const leo = await h.login('leo');
    const maya = await h.login('maya');
    await drain(h); // only this test's job is due when the crash is simulated
    const sent = await sendCodeRequest(maya, await contactCode(leo), 'crash test');
    h.hooks.afterNotificationInsert = () => {
      const e = new Error('simulated crash');
      e.name = 'SimulatedCrash';
      throw e;
    };
    await expect(processDueJobs(h.deps)).rejects.toThrow('simulated crash');
    h.hooks.afterNotificationInsert = undefined;
    const job = await h.prisma.outboxJob.findUniqueOrThrow({ where: { eventKey: `request.resolve:${sent.body.requestId}` } });
    expect(job.state).toBe('PENDING');
    expect(await h.prisma.notification.count({ where: { resourceId: sent.body.requestId } })).toBe(1);
    // The lease must expire before another worker retries it.
    expect(await processDueJobs(h.deps)).toBe(0);
    h.clock.advance(31_000);
    await drain(h);
    expect((await h.prisma.outboxJob.findUniqueOrThrow({ where: { id: job.id } })).state).toBe('DONE');
    expect(await h.prisma.notification.count({ where: { resourceId: sent.body.requestId } })).toBe(1);
    expect(await h.prisma.reunionRequest.count({ where: { id: sent.body.requestId } })).toBe(1);
  });

  it('a permanently failing job stops after five attempts with a failure state', async () => {
    await h.prisma.outboxJob.create({ data: { eventKey: 'bogus:1', kind: 'bogus', referencePayload: { kind: 'bogus' }, availableAt: h.clock.now(), createdAt: h.clock.now() } });
    for (let i = 0; i < 6; i++) {
      await processDueJobs(h.deps);
      h.clock.advance(20 * 60_000);
    }
    const job = await h.prisma.outboxJob.findUniqueOrThrow({ where: { eventKey: 'bogus:1' } });
    expect(job.state).toBe('FAILED');
    expect(job.attempts).toBe(5);
    expect(job.lastErrorCode).toBe('Error');
  });
});

describe('REL-04 authority changes between enqueue and processing', () => {
  it('revoked grant, block or withdrawal before delivery suppresses the notice', async () => {
    const leo = await h.login('leo');
    const maya = await h.login('maya');
    const noor = await h.login('noor');

    // Revoke after the response.notify job was queued.
    const r = await deliveredRequest(h, noor, leo, 'revoke before delivery');
    const ap = await respond(leo, r.id, r.version, { scope: 'SAFETY_MESSAGE', message: 'x' });
    await leo.post(`${API}/grants/${ap.body.grantId}/revoke`);
    const noorNotesBefore = await h.prisma.notification.count({ where: { recipientAccountId: ids.account('noor'), kind: 'RESPONSE_AVAILABLE' } });
    await drain(h);
    expect(await h.prisma.notification.count({ where: { recipientAccountId: ids.account('noor'), kind: 'RESPONSE_AVAILABLE' } })).toBe(noorNotesBefore);
    expect((await outgoing(noor)).find((o) => o.id === r.id)!.status).toBe('RESPONSE_UNAVAILABLE');

    // Block after a new request was queued but before resolution.
    const evan = await h.login('evan');
    const first = await deliveredRequest(h, maya, evan, 'first');
    const queued = await sendCodeRequest(maya, await contactCode(evan), 'queued before block');
    await evan.post(`${API}/requests/${first.id}/block`);
    await drain(h);
    expect(await h.prisma.notification.count({ where: { resourceId: queued.body.requestId } })).toBe(0);
    expect((await h.prisma.reunionRequest.findUniqueOrThrow({ where: { id: queued.body.requestId } })).internalState).toBe('UNRESOLVED');

    // Withdrawal after a staff proposal was queued.
    const routed = await noor.post(`${API}/requests`, { routeType: 'ROUTED', introduction: 'routed', clues: 'Ana', destinationShelterId: ids.shelter('B'), relayConsent: true }, { 'Idempotency-Key': key() });
    const cB = await h.loginStaff('cB');
    const route = (await cB.get(`${API}/staff/tasks`)).body.routeQueue.find((x: { requestId: string }) => x.requestId === routed.body.requestId);
    await cB.post(`${API}/staff/routes/${route.routeId}/assign`, { membershipId: ids.membership('worker.b') });
    const wB = await h.loginStaff('wB');
    const cand = (await wB.get(`${API}/staff/routes/${route.routeId}/candidates`)).body.candidates.find((c: { alias: string }) => c.alias === 'Ana');
    await wB.post(`${API}/staff/routes/${route.routeId}/propose-recipient`, { candidateToken: cand.candidateToken });
    await noor.post(`${API}/requests/${routed.body.requestId}/withdraw`);
    await drain(h);
    expect(await h.prisma.notification.count({ where: { resourceId: routed.body.requestId } })).toBe(0);
  });
});
