import { describe, expect, it } from 'vitest';
import { useHarness } from '../support/harness.js';
import { API, drain, key, outgoing } from '../support/flows.js';

const h = useHarness();

// A person without a device leaves intake with a contact code on paper. Family use it; the
// request waits in the case until the person's next verified visit, where they decide.
describe('STAFF-01 contact code issued at intake for a person without a device', () => {
  it('family reach the person with the paper code; only a verified visit shows the request and records the answer', async () => {
    const wA = await h.loginStaff('wA');
    const intake = await wA.post(`${API}/staff/cases`, { alias: 'Rosa (fictional)', intakeConsent: true, issueContactCode: true }, { 'Idempotency-Key': key() });
    expect(intake.status).toBe(201);
    expect(typeof intake.body.contactCode).toBe('string');
    expect(typeof intake.body.assistanceSecret).toBe('string');
    const caseUrl = `${API}/staff/cases/${intake.body.caseId}`;
    // The code is shown once, at intake: the case view never repeats it.
    expect(JSON.stringify((await wA.get(caseUrl)).body)).not.toContain(intake.body.contactCode);

    const maya = await h.login('maya');
    const sent = await maya.post(`${API}/requests`, { routeType: 'CODE', contactCode: intake.body.contactCode, introduction: 'Maya looking for Rosa. SENTINEL_ROSA' }, { 'Idempotency-Key': key() });
    expect(sent.status).toBe(202);
    await drain(h);

    // Intake verification has ended: the request is not shown until the person proves it is them.
    expect((await wA.post(`${caseUrl}/end-assistance`)).status).toBe(204);
    expect((await wA.get(caseUrl)).body.requests).toBeUndefined();
    expect((await wA.post(`${caseUrl}/verify`, { assistanceSecret: intake.body.assistanceSecret })).status).toBe(200);
    const view = await wA.get(caseUrl);
    const incoming = view.body.requests.incoming.find((r: { id: string }) => r.id === sent.body.requestId);
    expect(incoming).toMatchObject({ requesterAlias: 'Maya R.' });

    const answered = await wA.post(`${caseUrl}/requests/${sent.body.requestId}/respond`, { scope: 'SAFETY_MESSAGE', statement: 'REPORTED_OK', expiresIn: '7d', expectedVersion: incoming.version }, { 'Idempotency-Key': key() });
    expect(answered.status).toBe(201);
    await drain(h);
    expect((await outgoing(maya)).find((o) => o.id === sent.body.requestId)!.status).toBe('RESPONSE_AVAILABLE');
  });

  it('a restricted referral that asks for a contact code is refused and creates nothing', async () => {
    const wA = await h.loginStaff('wA');
    const cases = await h.prisma.assistanceCase.count();
    const intake = await wA.post(`${API}/staff/cases`, { alias: 'Child referral (fictional)', intakeConsent: true, restrictedReferral: true, issueContactCode: true }, { 'Idempotency-Key': key() });
    expect(intake.status).toBe(422);
    expect(intake.body.error.fieldErrors).toContainEqual({ path: 'issueContactCode', message: 'Restricted referrals do not get contact codes.' });
    expect(intake.body.contactCode).toBeUndefined();
    expect(await h.prisma.assistanceCase.count()).toBe(cases);
  });
});
