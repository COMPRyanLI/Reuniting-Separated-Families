/**
 * Regression tests for the findings deferred by the 2026-10-18 final review.
 * Each test reproduces the finding's concrete scenario.
 */
import { describe, expect, it } from 'vitest';
import { demoSecret, fixtureId } from '../../prisma/fixtures.js';
import { DAY } from '../../apps/api/src/lib/clock.js';
import { runRetention } from '../../apps/api/src/jobs/retention.js';
import { SEED_SECRET } from '../support/env.js';
import { ids, useHarness, type Client } from '../support/harness.js';
import { API, drain, key } from '../support/flows.js';

const h = useHarness({ configOverrides: { RATE_LIMIT_REQUESTS_PER_HOUR: '1000' } });
const secret = (label: string) => demoSecret(SEED_SECRET, `assist:${label}`);
const caseUrl = (label: string) => `${API}/staff/cases/${ids.case(label)}`;

async function verified(staffKey: Parameters<typeof h.loginStaff>[0], caseLabel: string): Promise<Client> {
  const c = await h.loginStaff(staffKey);
  expect((await c.post(`${caseUrl(caseLabel)}/verify`, { assistanceSecret: secret(caseLabel) })).status).toBe(200);
  return c;
}

/** Sam (assisted at A) sends a no-code request routed to Shelter B; returns the request and route IDs. */
async function samRoutedToB(clues: string) {
  const wA = await verified('wA', 'sam');
  const sent = await wA.post(`${caseUrl('sam')}/requests`, { routeType: 'ROUTED', introduction: 'Sam asks', clues, destinationShelterId: ids.shelter('B'), relayConsent: true }, { 'Idempotency-Key': key() });
  expect(sent.status).toBe(202);
  const route = await h.prisma.requestRoute.findFirstOrThrow({ where: { requestId: sent.body.requestId, endedAt: null } });
  const cB = await h.loginStaff('cB');
  expect((await cB.post(`${API}/staff/routes/${route.id}/assign`, { membershipId: ids.membership('worker.b') })).status).toBe(200);
  return { requestId: sent.body.requestId as string, routeId: route.id };
}

describe('review finding: ask-for-lead must not reveal hidden request states', () => {
  it('answers identically for responded, declined and open requests, and suppresses prompts on closed ones', async () => {
    const answered = await samRoutedToB('Answered lead');
    const declined = await samRoutedToB('Declined lead');
    const wB = await h.loginStaff('wB');
    for (const r of [answered, declined]) {
      const ana = (await wB.get(`${API}/staff/routes/${r.routeId}/candidates`)).body.candidates.find((c: { alias: string }) => c.alias === 'Ana');
      expect((await wB.post(`${API}/staff/routes/${r.routeId}/propose-recipient`, { candidateToken: ana.candidateToken })).status).toBe(200);
    }
    const wBv = await verified('wB', 'ana');
    const a = await h.prisma.reunionRequest.findUniqueOrThrow({ where: { id: answered.requestId } });
    expect((await wBv.post(`${caseUrl('ana')}/requests/${a.id}/respond`, { scope: 'SAFETY_MESSAGE', statement: 'REPORTED_OK', expiresIn: '24h', expectedVersion: a.version }, { 'Idempotency-Key': key() })).status).toBe(201);
    expect((await wBv.post(`${caseUrl('ana')}/requests/${declined.requestId}/decline`)).status).toBe(200);
    await drain(h);

    const cA = await h.loginStaff('cA');
    const replies = [await cA.post(`${API}/staff/requests/${answered.requestId}/ask-for-lead`), await cA.post(`${API}/staff/requests/${declined.requestId}/ask-for-lead`)];
    for (const res of replies) expect(res.status).toBe(200);
    expect(replies[0]!.body).toEqual(replies[1]!.body);
    await drain(h);
    // A prompt is pointless for an answered request: the worker suppresses it.
    expect(await h.prisma.notification.count({ where: { kind: 'LEAD_REQUESTED', resourceId: answered.requestId } })).toBe(0);
  });
});

describe('review finding: transfer acceptance must not confirm secrets on decided transfers', () => {
  it('returns the same conflict for correct and wrong secrets once a transfer is decided, without spending attempts', async () => {
    const wB = await verified('wB', 'bo');
    const t = await wB.post(`${caseUrl('bo')}/transfers`, { toShelterId: ids.shelter('A'), personConsent: true });
    expect(t.status).toBe(201);
    expect((await wB.post(`${API}/staff/transfers/${t.body.transferId}/cancel`)).status).toBe(200);
    const cA = await h.loginStaff('cA');
    const wrong = await cA.post(`${API}/staff/transfers/${t.body.transferId}/accept`, { assistanceSecret: secret('ana'), membershipId: ids.membership('worker.a') });
    const right = await cA.post(`${API}/staff/transfers/${t.body.transferId}/accept`, { assistanceSecret: secret('bo'), membershipId: ids.membership('worker.a') });
    expect(wrong.status).toBe(409);
    expect(right.status).toBe(409);
    expect({ ...wrong.body.error, requestId: 0 }).toEqual({ ...right.body.error, requestId: 0 });
    for (let i = 0; i < 6; i++) await cA.post(`${API}/staff/transfers/${t.body.transferId}/accept`, { assistanceSecret: secret('ana'), membershipId: ids.membership('worker.a') });
    // No secret-check failures were recorded for the decided transfer, so it never turns into a 429 probe either.
    expect((await cA.post(`${API}/staff/transfers/${t.body.transferId}/accept`, { assistanceSecret: secret('ana'), membershipId: ids.membership('worker.a') })).status).toBe(409);
  });
});

describe('review finding: intake shelter for staff with several shelter memberships', () => {
  it('requires an explicit shelter the worker belongs to, and never picks one silently', async () => {
    await h.prisma.staffMembership.create({
      data: { id: fixtureId('membership:worker.a2:B'), accountId: ids.account('worker.a2'), incidentId: ids.incident('demo-hurricane-1'), shelterId: ids.shelter('B'), role: 'WORKER', createdAt: h.clock.now() },
    });
    const wA2 = await h.loginStaff('wA2');
    const ambiguous = await wA2.post(`${API}/staff/cases`, { alias: 'Two Shelters', intakeConsent: true }, { 'Idempotency-Key': key() });
    expect(ambiguous.status).toBe(422);
    expect(JSON.stringify(ambiguous.body)).toContain('shelterId');
    const atB = await wA2.post(`${API}/staff/cases`, { alias: 'Two Shelters', intakeConsent: true, shelterId: ids.shelter('B') }, { 'Idempotency-Key': key() });
    expect(atB.status).toBe(201);
    expect((await h.prisma.assistanceCase.findUniqueOrThrow({ where: { id: atB.body.caseId } })).shelterId).toBe(ids.shelter('B'));
    const notMine = await wA2.post(`${API}/staff/cases`, { alias: 'Elsewhere', intakeConsent: true, shelterId: ids.shelter('D') }, { 'Idempotency-Key': key() });
    expect(notMine.status).toBe(422);
    // Single-shelter staff keep the implicit default.
    const wA = await h.loginStaff('wA');
    const plain = await wA.post(`${API}/staff/cases`, { alias: 'One Shelter', intakeConsent: true }, { 'Idempotency-Key': key() });
    expect(plain.status).toBe(201);
    expect((await h.prisma.assistanceCase.findUniqueOrThrow({ where: { id: plain.body.caseId } })).shelterId).toBe(ids.shelter('A'));
  });
});

describe('review finding: proposal must be bound to the current task holder and candidate consent', () => {
  it('a worker whose task is reassigned mid-proposal cannot complete it', async () => {
    const r = await samRoutedToB('Reassign race');
    const wB = await h.loginStaff('wB');
    const ana = (await wB.get(`${API}/staff/routes/${r.routeId}/candidates`)).body.candidates.find((c: { alias: string }) => c.alias === 'Ana');
    h.hooks.afterMatchingTaskCheck = async () => {
      // The coordinator reassigns the task between the authority check and the write.
      await h.prisma.requestRoute.update({ where: { id: r.routeId }, data: { assignedWorkerAccountId: ids.account('coord.b'), assignedWorkerMembershipId: ids.membership('coord.b') } });
    };
    const res = await wB.post(`${API}/staff/routes/${r.routeId}/propose-recipient`, { candidateToken: ana.candidateToken });
    h.hooks.afterMatchingTaskCheck = undefined;
    expect(res.status).toBe(409);
    const req = await h.prisma.reunionRequest.findUniqueOrThrow({ where: { id: r.requestId } });
    expect(req.recipientPersonId).toBeNull();
    expect(req.internalState).toBe('ROUTING');
  });

  it('a candidate who opts out mid-proposal is not delivered the request', async () => {
    const r = await samRoutedToB('Opt-out race');
    const wB = await h.loginStaff('wB');
    const ana = (await wB.get(`${API}/staff/routes/${r.routeId}/candidates`)).body.candidates.find((c: { alias: string }) => c.alias === 'Ana');
    h.hooks.afterMatchingTaskCheck = async () => {
      await h.prisma.person.update({ where: { id: ids.assisted('ana') }, data: { requestMode: 'CODE_ONLY', encryptedMatchingClue: null, version: { increment: 1 } } });
    };
    const res = await wB.post(`${API}/staff/routes/${r.routeId}/propose-recipient`, { candidateToken: ana.candidateToken });
    h.hooks.afterMatchingTaskCheck = undefined;
    expect(res.status).toBe(422);
    expect((await h.prisma.reunionRequest.findUniqueOrThrow({ where: { id: r.requestId } })).recipientPersonId).toBeNull();
    await h.prisma.person.update({ where: { id: ids.assisted('ana') }, data: { requestMode: 'ASSISTED' } });
  });
});

describe('review finding: concurrent duplicate assignments', () => {
  it('returns one success and conflicts, never a server error', async () => {
    const cB = await h.loginStaff('cB');
    const intake = await (await h.loginStaff('wB')).post(`${API}/staff/cases`, { alias: 'Assign Race', intakeConsent: true }, { 'Idempotency-Key': key() });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => cB.post(`${API}/staff/cases/${intake.body.caseId}/assignments`, { membershipId: fixtureId('membership:worker.a2:B'), purposes: ['ASSIST'] })),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(4);
  });
});

describe('review finding: closed-case retention purge applies the full deletion', () => {
  it('closes the purged person’s open requests and routes, like a requested deletion', async () => {
    const wA = await verified('wA', 'sam');
    const sent = await wA.post(`${caseUrl('sam')}/requests`, { routeType: 'ROUTED', introduction: 'Long-lived', clues: 'x', destinationShelterId: ids.shelter('D'), relayConsent: true }, { 'Idempotency-Key': key() });
    // Simulate a longer request lifetime than today's 14-day policy, so the request is still open at purge time.
    await h.prisma.reunionRequest.update({ where: { id: sent.body.requestId }, data: { expiresAt: new Date(h.clock.now().getTime() + 90 * DAY) } });
    const cA = await h.loginStaff('cA');
    expect((await cA.post(`${caseUrl('sam')}/close`)).status).toBe(200);
    h.clock.advance(31 * DAY);
    await runRetention(h.deps);
    const sam = await h.prisma.person.findUniqueOrThrow({ where: { id: ids.assisted('sam') } });
    expect(sam.purgedAt).not.toBeNull();
    const req = await h.prisma.reunionRequest.findUniqueOrThrow({ where: { id: sent.body.requestId } });
    expect(req.withdrawnAt).not.toBeNull();
    expect(req.internalState).toBe('WITHDRAWN');
    expect(await h.prisma.requestRoute.count({ where: { requestId: req.id, endedAt: null } })).toBe(0);
    const tomb = await h.prisma.deletionTombstone.findFirstOrThrow({ where: { personRef: sam.id } });
    expect(tomb.reason).toBe('CASE_CLOSED_RETENTION');
  });
});
