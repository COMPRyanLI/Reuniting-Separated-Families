import { describe, expect, it } from 'vitest';
import { HOUR } from '../../apps/api/src/lib/clock.js';
import { useHarness } from '../support/harness.js';
import { API, contactCode, deliveredRequest, drain, outgoing, randomWellFormedCode, sendCodeRequest } from '../support/flows.js';

// Documented default: 10 new requests per requester per hour.
const h = useHarness();

describe('PRIV-01 contact-code outcomes are indistinguishable to the requester', () => {
  it('valid, unknown, rotated, closed and blocked codes all return the same 202 and the same pending state', async () => {
    const maya = await h.login('maya');
    const leo = await h.login('leo');
    const evan = await h.login('evan');
    const noor = await h.login('noor');

    const valid = await contactCode(leo);
    const rotatedOld = await contactCode(noor);
    await contactCode(noor); // old code no longer routes
    const closed = await contactCode(evan);
    const me = await evan.get(`${API}/me`);
    expect((await evan.patch(`${API}/me/privacy`, { requestMode: 'CLOSED', expectedVersion: me.body.version })).status).toBe(200);
    // Noor blocks Maya through a first request.
    const first = await deliveredRequest(h, maya, noor, 'first');
    expect((await noor.post(`${API}/requests/${first.id}/block`)).status).toBe(200);
    const blocked = await contactCode(noor);

    const responses = [];
    for (const code of [valid, randomWellFormedCode(), rotatedOld, closed, blocked]) {
      const res = await sendCodeRequest(maya, code, 'Looking for family');
      responses.push(res);
    }
    for (const res of responses) {
      expect(res.status).toBe(202);
      expect(Object.keys(res.body).sort()).toEqual(['requestId', 'status']);
      expect(res.body.status).toBe('submitted');
      expect(Object.keys(res.headers).sort()).toEqual(Object.keys(responses[0]!.headers).sort());
    }
    await drain(h);
    const outs = await outgoing(maya);
    const views = responses.map((res) => outs.find((o) => o.id === res.body.requestId)!);
    for (const v of views) {
      expect(v.status).toBe('NO_RESPONSE_YET');
      expect(v.responseId).toBeNull();
      expect(Object.keys(v).sort()).toEqual(Object.keys(views[0]!).sort());
    }
    // Only the valid, open target actually received anything.
    expect(await h.prisma.reunionRequest.count({ where: { id: { in: responses.map((r) => r.body.requestId) }, internalState: 'AWAITING_DECISION' } })).toBe(1);
  });

  it('the per-requester limit returns a target-independent 429 and resets with the clock', async () => {
    h.clock.advance(HOUR);
    const c = h.client();
    const reg = await c.post(`${API}/auth/register`, { username: 'limit.tester', password: 'long enough passphrase', alias: 'LT' });
    c.csrf = reg.body.session.csrfToken;
    for (let i = 0; i < 10; i++) expect((await sendCodeRequest(c, randomWellFormedCode(), `n${i}`)).status).toBe(202);
    const limitedUnknown = await sendCodeRequest(c, randomWellFormedCode(), 'over');
    const leo = await h.login('leo');
    const limitedValid = await sendCodeRequest(c, await contactCode(leo), 'over');
    for (const res of [limitedUnknown, limitedValid]) {
      expect(res.status).toBe(429);
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    }
    expect({ ...limitedUnknown.body.error, requestId: 0 }).toEqual({ ...limitedValid.body.error, requestId: 0 });
    h.clock.advance(HOUR);
    const c2 = await h.login('limit.tester', 'long enough passphrase');
    expect((await sendCodeRequest(c2, randomWellFormedCode(), 'after reset')).status).toBe(202);
  });

  it('malformed codes are a validation error that does not echo the input', async () => {
    const maya = await h.login('maya');
    const res = await maya.post(`${API}/requests`, { routeType: 'CODE', contactCode: '', introduction: 'hi' }, { 'Idempotency-Key': 'k-malformed-1' });
    expect(res.status).toBe(422);
    const res2 = await sendCodeRequest(maya, 'SHORTCODE-ECHO-SENTINEL', 'hi');
    expect(res2.status).toBe(422);
    expect(JSON.stringify(res2.body)).not.toContain('SHORTCODE-ECHO-SENTINEL');
  });
});
