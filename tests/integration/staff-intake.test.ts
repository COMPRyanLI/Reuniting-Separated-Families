import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { demoCaseReference, demoSecret } from '../../prisma/fixtures.js';
import { MINUTE } from '../../apps/api/src/lib/clock.js';
import { SEED_SECRET } from '../support/env.js';
import { ids, useHarness } from '../support/harness.js';

const h = useHarness();
const API = '/api/v1';
const key = () => `k-${randomUUID()}`;
const samSecret = demoSecret(SEED_SECRET, 'assist:sam');

describe('STAFF-01 assigned intake and case access', () => {
  it('records subject and actor correctly; only the assigned worker can open the case', async () => {
    const wA = await h.loginStaff('wA');
    const intake = await wA.post(
      `${API}/staff/cases`,
      { alias: 'Sam Two', intakeConsent: true, checkIn: { observedAt: h.clock.now().toISOString(), reportedStatus: 'REPORTED_OK' } },
      { 'Idempotency-Key': key() },
    );
    expect(intake.status).toBe(201);
    expect(intake.body.reference).toMatch(/^REF-/);
    expect(typeof intake.body.assistanceSecret).toBe('string');
    const caseId = intake.body.caseId as string;

    const kase = await h.prisma.assistanceCase.findUniqueOrThrow({ where: { id: caseId }, include: { person: true, assignments: true } });
    expect(kase.person.accountId).toBeNull(); // no personal account required
    expect(kase.shelterId).toBe(ids.shelter('A'));
    expect(kase.assignments.map((a) => a.staffAccountId)).toEqual([ids.account('worker.a')]);
    const checkIn = await h.prisma.checkIn.findFirstOrThrow({ where: { personId: kase.personId } });
    expect(checkIn.authorAccountId).toBe(ids.account('worker.a'));
    expect(checkIn.source).toBe('STAFF_RECORDED');
    const consent = await h.prisma.consentRecord.findFirstOrThrow({ where: { personId: kase.personId, action: 'INTAKE_PARTICIPATION' } });
    expect(consent.actorAccountId).toBe(ids.account('worker.a'));
    expect(consent.caseId).toBe(caseId);
    const audit = await h.prisma.auditEvent.findFirstOrThrow({ where: { action: 'case.intake', objectId: caseId } });
    expect(audit.actorAccountId).toBe(ids.account('worker.a'));
    expect(JSON.stringify(audit)).not.toContain('Sam Two');

    const own = await wA.get(`${API}/staff/cases/${caseId}`);
    expect(own.status).toBe(200);
    expect(own.body.alias).toBe('Sam Two');

    for (const k of ['wA2', 'wB', 'cA', 'op'] as const) {
      const other = await h.loginStaff(k);
      const res = await other.get(`${API}/staff/cases/${caseId}`);
      expect(res.status, k).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('Sam Two');
    }
    // Same 404 envelope for a nonexistent case.
    const ghost = await (await h.loginStaff('wA2')).get(`${API}/staff/cases/${randomUUID()}`);
    expect(ghost.status).toBe(404);
  });

  it('requires recorded intake consent and rejects attempts to choose another shelter or owner', async () => {
    const wA = await h.loginStaff('wA');
    const noConsent = await wA.post(`${API}/staff/cases`, { alias: 'X' }, { 'Idempotency-Key': key() });
    expect(noConsent.status).toBe(422);
    // The field error tells the worker what to do (schema text, never the submitted value).
    expect(noConsent.body.error.fieldErrors).toContainEqual({ path: 'intakeConsent', message: 'Confirm the person agreed to this intake.' });
    const otherShelter = await wA.post(`${API}/staff/cases`, { alias: 'X', intakeConsent: true, shelterId: ids.shelter('B') }, { 'Idempotency-Key': key() });
    expect(otherShelter.status).toBe(422);
    const withAccount = await wA.post(`${API}/staff/cases`, { alias: 'X', intakeConsent: true, accountId: ids.account('maya') }, { 'Idempotency-Key': key() });
    expect(withAccount.status).toBe(422);
  });

  it('retrying an intake with the same key creates one case', async () => {
    const wB = await h.loginStaff('wB');
    const k = key();
    const body = { alias: 'Retry Person', intakeConsent: true };
    const [a, b] = await Promise.all([wB.post(`${API}/staff/cases`, body, { 'Idempotency-Key': k }), wB.post(`${API}/staff/cases`, body, { 'Idempotency-Key': k })]);
    expect(a.body.caseId).toBe(b.body.caseId);
    expect(await h.prisma.person.count({ where: { alias: 'Retry Person' } })).toBe(1);
    // The one-time secret is only returned on the original response, never on a replay.
    expect([a.body.assistanceSecret, b.body.assistanceSecret].filter(Boolean)).toHaveLength(1);
  });

  it('individuals and unverified staff cannot use staff endpoints', async () => {
    const maya = await h.login('maya');
    expect((await maya.get(`${API}/staff/tasks`)).status).toBe(403);
    expect((await maya.post(`${API}/staff/cases`, { alias: 'X', intakeConsent: true }, { 'Idempotency-Key': key() })).status).toBe(403);
    expect((await h.client().get(`${API}/staff/tasks`)).status).toBe(401);
  });
});

describe('STAFF-02 repeat visit requires the private assistance secret', () => {
  it('reference, wrong secret and expired verification cannot authorize; the correct secret creates a short worker-specific session', async () => {
    const wA = await h.loginStaff('wA');
    const caseUrl = `${API}/staff/cases/${ids.case('sam')}`;
    const header = await wA.get(caseUrl);
    expect(header.status).toBe(200);
    expect(header.body.assistance.verified).toBe(false);
    expect(header.body.checkIns).toBeUndefined();
    const ci = { areaId: undefined, shelterId: ids.shelter('A'), observedAt: h.clock.now().toISOString() };
    const unverified = await wA.post(`${caseUrl}/check-ins`, ci, { 'Idempotency-Key': key() });
    expect(unverified.status).toBe(403);
    expect(unverified.body.error.code).toBe('VERIFICATION_REQUIRED');

    const byReference = await wA.post(`${caseUrl}/verify`, { assistanceSecret: demoCaseReference(SEED_SECRET, 'sam') });
    expect(byReference.status).toBe(403);
    const wrong = await wA.post(`${caseUrl}/verify`, { assistanceSecret: demoSecret(SEED_SECRET, 'assist:ana') });
    expect(wrong.status).toBe(403);
    expect((await wA.post(`${caseUrl}/check-ins`, ci, { 'Idempotency-Key': key() })).status).toBe(403);

    const ok = await wA.post(`${caseUrl}/verify`, { assistanceSecret: samSecret.toLowerCase() });
    expect(ok.status).toBe(200);
    expect(new Date(ok.body.verifiedUntil).getTime() - h.clock.now().getTime()).toBe(10 * MINUTE);
    const created = await wA.post(`${caseUrl}/check-ins`, ci, { 'Idempotency-Key': key() });
    expect(created.status).toBe(201);
    const full = await wA.get(caseUrl);
    expect(full.body.assistance.verified).toBe(true);
    expect(full.body.checkIns.length).toBeGreaterThanOrEqual(2);

    h.clock.advance(10 * MINUTE + 1000);
    const expired = await wA.post(`${caseUrl}/check-ins`, ci, { 'Idempotency-Key': key() });
    expect(expired.status).toBe(403);
    expect(expired.body.error.code).toBe('VERIFICATION_REQUIRED');
  });

  it('verification is staff-specific and requires an assignment', async () => {
    const caseUrl = `${API}/staff/cases/${ids.case('sam')}`;
    const wA2 = await h.loginStaff('wA2');
    expect((await wA2.post(`${caseUrl}/verify`, { assistanceSecret: samSecret })).status).toBe(404);
    const cA = await h.loginStaff('cA');
    const assign = await cA.post(`${caseUrl}/assignments`, { membershipId: ids.membership('worker.a2'), purposes: ['ASSIST'] });
    expect(assign.status).toBe(201);
    // Coordinator cannot assign themself, nor staff from another shelter.
    expect((await cA.post(`${caseUrl}/assignments`, { membershipId: ids.membership('coord.a'), purposes: ['ASSIST'] })).status).toBe(403);
    expect((await cA.post(`${caseUrl}/assignments`, { membershipId: ids.membership('worker.b'), purposes: ['ASSIST'] })).status).toBe(422);
    // Coordinator assignment power does not give the coordinator the case.
    expect((await cA.get(caseUrl)).status).toBe(404);

    const wA = await h.loginStaff('wA');
    expect((await wA.post(`${caseUrl}/verify`, { assistanceSecret: samSecret })).status).toBe(200);
    const header = await wA2.get(caseUrl);
    expect(header.status).toBe(200);
    expect(header.body.assistance.verified).toBe(false); // W-A's verification does not carry over
    expect((await wA2.post(`${caseUrl}/verify`, { assistanceSecret: samSecret })).status).toBe(200);
    expect((await wA2.get(caseUrl)).body.assistance.verified).toBe(true);
  });

  it('limits failed verification attempts and offers manual escalation without disclosure', async () => {
    const wB = await h.loginStaff('wB');
    const caseUrl = `${API}/staff/cases/${ids.case('bo')}`;
    for (let i = 0; i < 5; i++) expect((await wB.post(`${caseUrl}/verify`, { assistanceSecret: `WRONG-${i}AAA-BBBB-CCCC-DDDD-EEEE-FF` })).status).toBe(403);
    const limited = await wB.post(`${caseUrl}/verify`, { assistanceSecret: demoSecret(SEED_SECRET, 'assist:bo') });
    expect(limited.status).toBe(429);
    const esc = await wB.post(`${caseUrl}/escalate`);
    expect(esc.status).toBe(200);
    const view = await wB.get(caseUrl);
    expect(view.body.escalationOpenedAt).toBeTruthy();
    expect(view.body.checkIns).toBeUndefined();
  });
});

describe('STAFF-03 restricted referral', () => {
  it('allows a minimal referral record but denies location, codes and opting into matching', async () => {
    const wA = await h.loginStaff('wA');
    const intake = await wA.post(`${API}/staff/cases`, { alias: 'Child R2', intakeConsent: true, restrictedReferral: true }, { 'Idempotency-Key': key() });
    expect(intake.status).toBe(201);
    expect(intake.body.assistanceSecret).toBeUndefined();
    const person = await h.prisma.person.findFirstOrThrow({ where: { alias: 'Child R2' } });
    expect(person.restrictedReferral).toBe(true);
    expect(person.requestMode).toBe('CLOSED');

    const withLocation = await wA.post(
      `${API}/staff/cases`,
      { alias: 'Child R3', intakeConsent: true, restrictedReferral: true, checkIn: { observedAt: h.clock.now().toISOString() } },
      { 'Idempotency-Key': key() },
    );
    expect(withLocation.status).toBe(422);
    const withMatching = await wA.post(`${API}/staff/cases`, { alias: 'Child R4', intakeConsent: true, restrictedReferral: true, requestMode: 'ASSISTED' }, { 'Idempotency-Key': key() });
    expect(withMatching.status).toBe(422);

    // Seeded R: even with verified assistance, ordinary sharing tools are refused.
    const rUrl = `${API}/staff/cases/${ids.case('r')}`;
    expect((await wA.post(`${rUrl}/verify`, { assistanceSecret: demoSecret(SEED_SECRET, 'assist:r') })).status).toBe(200);
    const view = await wA.get(rUrl);
    expect(view.body.restrictedReferral).toBe(true);
    expect(view.body.referralGuidance).toMatch(/referral/i);
    expect((await wA.post(`${rUrl}/check-ins`, { shelterId: ids.shelter('A'), observedAt: h.clock.now().toISOString() }, { 'Idempotency-Key': key() })).status).toBe(403);
    expect((await wA.post(`${rUrl}/contact-code/rotate`)).status).toBe(403);
    expect((await wA.patch(`${rUrl}/privacy`, { requestMode: 'ASSISTED', expectedVersion: 1 })).status).toBe(403);
    expect(await h.prisma.checkIn.count({ where: { personId: ids.assisted('r') } })).toBe(0);
  });

  it('refuses disclosure and requests for a restricted referral even if a request reaches them', async () => {
    // Simulate someone claiming to be a guardian getting a request delivered (e.g. a data-entry mistake).
    const now = h.clock.now();
    const requestId = crypto.randomUUID();
    await h.prisma.reunionRequest.create({
      data: {
        id: requestId,
        incidentId: ids.incident('demo-hurricane-1'),
        requesterPersonId: ids.person('maya'),
        recipientPersonId: ids.assisted('r'),
        routeType: 'CODE',
        requesterAliasSnapshot: 'Claimed guardian',
        internalState: 'AWAITING_DECISION',
        submittedAt: now,
        deliveredAt: now,
        expiresAt: new Date(now.getTime() + 14 * 86_400_000),
        createdByAccountId: ids.account('maya'),
      },
    });
    const wA = await h.loginStaff('wA');
    expect((await wA.post(`${API}/staff/cases/${ids.case('r')}/verify`, { assistanceSecret: demoSecret(SEED_SECRET, 'assist:r') })).status).toBe(200);
    const res = await wA.post(
      `${API}/staff/cases/${ids.case('r')}/requests/${requestId}/respond`,
      { scope: 'SAFETY_MESSAGE', statement: 'REPORTED_OK', expiresIn: '24h', expectedVersion: 1 },
      { 'Idempotency-Key': key() },
    );
    expect(res.status).toBe(403);
    expect(await h.prisma.sharingGrant.count({ where: { subjectPersonId: ids.assisted('r') } })).toBe(0);
    const send = await wA.post(`${API}/staff/cases/${ids.case('r')}/requests`, { routeType: 'ROUTED', introduction: 'x' }, { 'Idempotency-Key': key() });
    expect(send.status).toBe(403);
  });
});

describe('assisted privacy and tasks', () => {
  it('a verified worker updates privacy with the same version rules as self-service', async () => {
    const wB = await h.loginStaff('wB');
    const url = `${API}/staff/cases/${ids.case('ana')}`;
    expect((await wB.patch(`${url}/privacy`, { requestMode: 'CODE_ONLY', expectedVersion: 1 })).status).toBe(403);
    await wB.post(`${url}/verify`, { assistanceSecret: demoSecret(SEED_SECRET, 'assist:ana') });
    const res = await wB.patch(`${url}/privacy`, { requestMode: 'ASSISTED', matchingClue: 'Grey cap', expectedVersion: 1 });
    expect(res.status).toBe(200);
    expect((await wB.patch(`${url}/privacy`, { requestMode: 'CLOSED', expectedVersion: 1 })).status).toBe(409);
    const consent = await h.prisma.consentRecord.findFirstOrThrow({ where: { personId: ids.assisted('ana'), action: 'PRIVACY_CHANGE' } });
    expect(consent.actorAccountId).toBe(ids.account('worker.b'));
    expect(consent.assistanceSessionId).not.toBeNull();
  });

  it('task list shows only the worker’s own assignments; coordinators see a minimal case index', async () => {
    const wB = await h.loginStaff('wB');
    const tasks = await wB.get(`${API}/staff/tasks`);
    expect(tasks.status).toBe(200);
    const refs = tasks.body.cases.map((c: { caseId: string }) => c.caseId);
    expect(refs).toEqual(expect.arrayContaining([ids.case('ana'), ids.case('bo'), ids.case('cy')]));
    expect(refs).not.toContain(ids.case('sam'));
    const cB = await h.loginStaff('cB');
    const ctasks = await cB.get(`${API}/staff/tasks`);
    expect(ctasks.body.cases).toEqual([]);
    const index = ctasks.body.caseIndex as Record<string, unknown>[];
    expect(index.length).toBeGreaterThanOrEqual(3);
    const text = JSON.stringify(index);
    expect(text).not.toMatch(/Ana|Grey cap|alias|checkIn/);
  });
});
