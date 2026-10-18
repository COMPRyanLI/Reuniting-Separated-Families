import { describe, expect, it } from 'vitest';
import { useHarness } from '../support/harness.js';
import { API, key, randomWellFormedCode } from '../support/flows.js';

// Documented requester limit (10/hour) and a small staff intake limit.
const h = useHarness({ configOverrides: { RATE_LIMIT_STAFF_INTAKE_PER_HOUR: '2' } });

describe('review finding: a retry of an already-saved write is not counted against rate limits', () => {
  it('replaying the last request inside the limit returns the original result instead of 429', async () => {
    const c = h.client();
    const reg = await c.post(`${API}/auth/register`, { username: 'retry.limit', password: 'long enough passphrase', alias: 'RL' });
    c.csrf = reg.body.session.csrfToken;
    let lastKey = '';
    let lastBody: object = {};
    let lastId = '';
    for (let i = 0; i < 10; i++) {
      lastKey = key();
      lastBody = { routeType: 'CODE', contactCode: randomWellFormedCode(), introduction: `n${i}` };
      const res = await c.post(`${API}/requests`, lastBody, { 'Idempotency-Key': lastKey });
      expect(res.status).toBe(202);
      lastId = res.body.requestId;
    }
    const replay = await c.post(`${API}/requests`, lastBody, { 'Idempotency-Key': lastKey });
    expect(replay.status).toBe(202);
    expect(replay.body.requestId).toBe(lastId);
    // A genuinely new request is still limited.
    expect((await c.post(`${API}/requests`, { routeType: 'CODE', contactCode: randomWellFormedCode(), introduction: 'new' }, { 'Idempotency-Key': key() })).status).toBe(429);
  });

  it('replaying a saved intake inside the staff limit returns the original case', async () => {
    const wB = await h.loginStaff('wB');
    const k2 = key();
    expect((await wB.post(`${API}/staff/cases`, { alias: 'First', intakeConsent: true }, { 'Idempotency-Key': key() })).status).toBe(201);
    const second = await wB.post(`${API}/staff/cases`, { alias: 'Second', intakeConsent: true }, { 'Idempotency-Key': k2 });
    expect(second.status).toBe(201);
    const replay = await wB.post(`${API}/staff/cases`, { alias: 'Second', intakeConsent: true }, { 'Idempotency-Key': k2 });
    expect(replay.status).toBe(200);
    expect(replay.body.caseId).toBe(second.body.caseId);
    expect(replay.body.assistanceSecret).toBeUndefined();
    expect((await wB.post(`${API}/staff/cases`, { alias: 'Third', intakeConsent: true }, { 'Idempotency-Key': key() })).status).toBe(429);
  });
});
