import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../apps/api/src/app.js';
import { createCrypto } from '../../apps/api/src/lib/crypto.js';
import { silentLogger } from '../../apps/api/src/lib/logger.js';
import { suspendAccount } from '../../apps/api/src/services/staffAdmin.js';
import { demoCaseReference } from '../../prisma/fixtures.js';
import { SEED_PASSWORD, SEED_SECRET, TEST_ORIGIN, testConfig } from '../support/env.js';
import { ids, totpCode, useHarness } from '../support/harness.js';
import { MINUTE, HOUR } from '../../apps/api/src/lib/clock.js';

const h = useHarness();
const API = '/api/v1';

function cookieValue(res: request.Response): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const c = raw?.find((v) => v.startsWith('rf_session=') || v.startsWith('__Host-rf_session='));
  return c?.split(';')[0]?.split('=')[1];
}

describe('AUTH-01 register with username, password and alias only', () => {
  it('creates an account and person with no phone, email, legal ID or location', async () => {
    const c = h.client();
    const res = await c.post(`${API}/auth/register`, { username: 'New.Person', password: 'correct horse battery', alias: 'Nia' });
    expect(res.status).toBe(201);
    expect(typeof res.body.recoverySecret).toBe('string');
    expect(res.body.session.account.username).toBe('new.person');
    expect(res.body.session.person.alias).toBe('Nia');
    expect(res.body.session.staff).toBeNull();
    const text = JSON.stringify(res.body).toLowerCase();
    for (const forbidden of ['phone', 'email', 'passport', 'latitude', 'longitude', 'passwordhash']) {
      expect(text).not.toContain(forbidden);
    }
    c.csrf = res.body.session.csrfToken;
    const session = await c.get(`${API}/auth/session`);
    expect(session.status).toBe(200);
    expect(session.body.person.alias).toBe('Nia');
  });

  it('rejects injected role, owner and staff fields and creates no membership', async () => {
    const c = h.client();
    for (const extra of [{ role: 'COORDINATOR' }, { accountId: ids.account('coord.a') }, { staff: true }, { shelterId: ids.shelter('A') }, { requestMode: 'ASSISTED' }]) {
      const res = await c.post(`${API}/auth/register`, { username: 'injector', password: 'correct horse battery', alias: 'Inj', ...extra });
      expect(res.status).toBe(422);
      expect(JSON.stringify(res.body)).not.toContain('correct horse battery');
    }
    expect(await h.prisma.account.findUnique({ where: { normalizedUsername: 'injector' } })).toBeNull();
    const ok = await c.post(`${API}/auth/register`, { username: 'injector', password: 'correct horse battery', alias: 'Inj' });
    expect(ok.status).toBe(201);
    const acct = await h.prisma.account.findUnique({ where: { normalizedUsername: 'injector' }, include: { memberships: true } });
    expect(acct?.memberships).toHaveLength(0);
  });

  it('treats case and surrounding whitespace variants of a username as duplicates', async () => {
    const c = h.client();
    const res = await c.post(`${API}/auth/register`, { username: ' MAYA ', password: 'correct horse battery', alias: 'Fake Maya' });
    expect(res.status).toBe(409);
  });
});

describe('AUTH-02 generic login errors and server-side sessions', () => {
  it('returns the same public error for a wrong password and an unknown username', async () => {
    const c = h.client();
    const wrong = await c.post(`${API}/auth/login`, { username: 'maya', password: 'definitely wrong pw' });
    const unknown = await c.post(`${API}/auth/login`, { username: 'nobody.here', password: 'definitely wrong pw' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    const strip = (b: { error: { requestId?: string } }) => ({ ...b.error, requestId: undefined });
    expect(strip(wrong.body)).toEqual(strip(unknown.body));
  });

  it('stores only a token digest and sets an HttpOnly SameSite=Lax host-only cookie', async () => {
    const c = h.client();
    const res = await c.post(`${API}/auth/login`, { username: 'maya', password: SEED_PASSWORD });
    expect(res.status).toBe(200);
    const raw = (res.headers['set-cookie'] as unknown as string[])[0]!;
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Lax/i);
    expect(raw).toMatch(/Path=\//);
    expect(raw).not.toMatch(/Domain=/i);
    expect(raw).not.toMatch(/Max-Age|Expires/i); // no remember-me
    const token = cookieValue(res)!;
    expect(JSON.stringify(res.body)).not.toContain(token);
    const stored = await h.prisma.session.findMany({ where: { accountId: ids.account('maya') } });
    expect(stored.length).toBeGreaterThan(0);
    for (const s of stored) expect(s.tokenDigest).not.toBe(token);
    expect(stored.some((s) => s.tokenDigest === h.deps.crypto.digest('session', token))).toBe(true);
  });

  it('uses a Secure __Host- cookie under an https production configuration', async () => {
    const config = testConfig(h.deps.config.databaseUrl, { NODE_ENV: 'production', APP_ORIGIN: 'https://demo.example.org' });
    const app = createApp({ ...h.deps, config, crypto: createCrypto(config), logger: silentLogger });
    const res = await request(app)
      .post(`${API}/auth/login`)
      .set('Origin', 'https://demo.example.org')
      .send({ username: 'leo', password: SEED_PASSWORD });
    expect(res.status).toBe(200);
    const raw = (res.headers['set-cookie'] as unknown as string[])[0]!;
    expect(raw.startsWith('__Host-rf_session=')).toBe(true);
    expect(raw).toMatch(/; Secure/i);
    expect(raw).toMatch(/HttpOnly/i);
    expect(res.headers['strict-transport-security']).toBeDefined();
  });
});

describe('AUTH-03 logout, expiry, recovery and suspension invalidate sessions', () => {
  it('logout revokes the session so the old cookie cannot reopen private content', async () => {
    const c = await h.login('noor');
    const token = cookieValue(await c.post(`${API}/auth/login`, { username: 'noor', password: SEED_PASSWORD }))!;
    const fresh = await c.get(`${API}/auth/session`);
    c.csrf = fresh.body.csrfToken;
    expect((await c.post(`${API}/auth/logout`)).status).toBe(204);
    expect((await c.get(`${API}/me`)).status).toBe(401);
    // Replaying the old cookie directly also fails.
    const replay = await request(h.app).get(`${API}/me`).set('Cookie', `rf_session=${token}`);
    expect(replay.status).toBe(401);
  });

  it('expires after 30 idle minutes and background polling does not extend the session', async () => {
    const c = await h.login('evan');
    // Polls at 9, 18 and 27 minutes succeed but do not count as activity.
    for (let i = 0; i < 3; i++) {
      h.clock.advance(9 * MINUTE);
      const poll = await c.get(`${API}/auth/session`, { background: true });
      expect(poll.status).toBe(200);
    }
    h.clock.advance(3 * MINUTE); // 30 minutes since the last user action
    expect((await c.get(`${API}/me`)).status).toBe(401);
  });

  it('user activity extends idle time but never past the 12-hour absolute lifetime', async () => {
    const c = await h.login('leo');
    // Active every 20 minutes for 11h40m.
    for (let i = 0; i < 35; i++) {
      h.clock.advance(20 * MINUTE);
      expect((await c.get(`${API}/me`)).status).toBe(200);
    }
    h.clock.advance(20 * MINUTE); // reaches the 12-hour absolute limit
    expect((await c.get(`${API}/me`)).status).toBe(401);
  });

  it('account suspension invalidates protected API access immediately', async () => {
    const c = h.client();
    const reg = await c.post(`${API}/auth/register`, { username: 'to.suspend', password: 'correct horse battery', alias: 'TS' });
    c.csrf = reg.body.session.csrfToken;
    expect((await c.get(`${API}/me`)).status).toBe(200);
    await suspendAccount(h.deps, 'to.suspend');
    expect((await c.get(`${API}/me`)).status).toBe(401);
    const relogin = await c.post(`${API}/auth/login`, { username: 'to.suspend', password: 'correct horse battery' });
    expect(relogin.status).toBe(401);
  });
});

describe('AUTH-04 recovery secret is single use and not replaceable by other identifiers', () => {
  it('valid secret works once, revokes old sessions and issues a new secret', async () => {
    const c = h.client();
    const reg = await c.post(`${API}/auth/register`, { username: 'recoverer', password: 'original passphrase 1', alias: 'Rec' });
    c.csrf = reg.body.session.csrfToken;
    const secret = reg.body.recoverySecret as string;

    const other = h.client();
    const rec = await other.post(`${API}/auth/recover`, { username: 'recoverer', recoverySecret: secret, newPassword: 'brand new passphrase 2' });
    expect(rec.status).toBe(200);
    expect(typeof rec.body.recoverySecret).toBe('string');
    expect(rec.body.recoverySecret).not.toBe(secret);
    expect((await c.get(`${API}/me`)).status).toBe(401); // old session revoked

    const replay = await h.client().post(`${API}/auth/recover`, { username: 'recoverer', recoverySecret: secret, newPassword: 'another passphrase 3' });
    expect(replay.status).toBe(401);
    const loginOld = await h.client().post(`${API}/auth/login`, { username: 'recoverer', password: 'original passphrase 1' });
    expect(loginOld.status).toBe(401);
    const loginNew = await h.client().post(`${API}/auth/login`, { username: 'recoverer', password: 'brand new passphrase 2' });
    expect(loginNew.status).toBe(200);
  });

  it('rejects a contact code, case reference or alias in place of the recovery secret without leaking details', async () => {
    const leo = await h.login('leo');
    const code = (await leo.post(`${API}/me/contact-code/rotate`)).body.contactCode as string;
    const candidates = [code, demoCaseReference(SEED_SECRET, 'sam'), 'Leo (Maya’s brother)', 'leo'];
    const bodies: string[] = [];
    for (const candidate of candidates) {
      const res = await h.client().post(`${API}/auth/recover`, { username: 'leo', recoverySecret: candidate, newPassword: 'takeover passphrase 9' });
      expect(res.status).toBe(401);
      bodies.push(JSON.stringify({ ...res.body.error, requestId: undefined }));
      expect(JSON.stringify(res.body)).not.toMatch(/alias|person|leo/i);
    }
    expect(new Set(bodies).size).toBe(1);
    expect((await h.client().post(`${API}/auth/login`, { username: 'leo', password: SEED_PASSWORD })).status).toBe(200);
  });
});

describe('AUTH-05 staff MFA gate, replay and suspension', () => {
  it('denies staff operations before MFA, allows them after, rejects replay and suspension', async () => {
    const c = await h.login('worker.a2');
    const before = await c.get(`${API}/staff/me`);
    expect(before.status).toBe(403);
    expect(before.body.error.code).toBe('MFA_REQUIRED');

    const enroll = await c.post(`${API}/auth/mfa/enroll`, { password: SEED_PASSWORD });
    expect(enroll.status).toBe(200);
    const secret = enroll.body.secret as string;
    // Still denied until a code is verified.
    expect((await c.get(`${API}/staff/me`)).status).toBe(403);

    h.clock.advance(31_000);
    const code = totpCode(secret, h.clock.now());
    const verify = await c.post(`${API}/auth/mfa/verify`, { code });
    expect(verify.status).toBe(200);
    expect(Array.isArray(verify.body.recoveryCodes)).toBe(true);
    c.csrf = verify.body.csrfToken;
    const ok = await c.get(`${API}/staff/me`);
    expect(ok.status).toBe(200);
    expect(ok.body.memberships[0].role).toBe('WORKER');

    // Same code in the same time step from a new login is a replay.
    const c2 = await h.login('worker.a2');
    const replay = await c2.post(`${API}/auth/mfa/verify`, { code });
    // A rejected second factor is a 403: the (not yet privileged) session itself stays valid,
    // so the browser must not treat it as "signed out".
    expect(replay.status).toBe(403);
    expect(replay.body.error.code).toBe('MFA_REJECTED');
    expect((await c2.get(`${API}/auth/session`)).status).toBe(200);
    expect((await c2.get(`${API}/staff/me`)).status).toBe(403);

    // MFA recovery codes are single use.
    const rc = verify.body.recoveryCodes[0] as string;
    const c3 = await h.login('worker.a2');
    expect((await c3.post(`${API}/auth/mfa/verify`, { recoveryCode: rc })).status).toBe(200);
    const c4 = await h.login('worker.a2');
    expect((await c4.post(`${API}/auth/mfa/verify`, { recoveryCode: rc })).status).toBe(403);

    // Suspending the membership denies staff operations even on an MFA-verified session.
    await h.prisma.staffMembership.update({ where: { id: ids.membership('worker.a2') }, data: { state: 'SUSPENDED', suspendedAt: h.clock.now() } });
    expect((await c.get(`${API}/staff/me`)).status).toBe(403);
    await h.prisma.staffMembership.update({ where: { id: ids.membership('worker.a2') }, data: { state: 'ACTIVE', suspendedAt: null } });
  });

  it('individual accounts cannot use staff endpoints or MFA enrollment', async () => {
    const maya = await h.login('maya');
    expect((await maya.get(`${API}/staff/me`)).status).toBe(403);
    expect((await maya.post(`${API}/auth/mfa/enroll`, { password: SEED_PASSWORD })).status).toBe(403);
  });

  it('staff sessions use 15-minute idle timeout', async () => {
    const c = await h.loginStaff('wB');
    h.clock.advance(14 * MINUTE);
    expect((await c.get(`${API}/staff/me`)).status).toBe(200);
    h.clock.advance(15 * MINUTE + 1000);
    expect((await c.get(`${API}/staff/me`)).status).toBe(401);
    void HOUR;
  });
});

describe('AUTH-03 a wrong re-entered password is refused without ending the session', () => {
  it('returns 403 for recovery-secret rotation, MFA enrollment and account deletion, and keeps the session', async () => {
    const c = h.client();
    const reg = await c.post(`${API}/auth/register`, { username: 'reauth.check', password: 'correct horse battery', alias: 'RA' });
    c.csrf = reg.body.session.csrfToken;
    const rotate = await c.post(`${API}/auth/recovery-codes`, { password: 'not the password', kind: 'ACCOUNT_RECOVERY' });
    expect(rotate.status).toBe(403);
    expect(rotate.body.error.code).toBe('REAUTH_FAILED');
    const del = await c.delete(`${API}/me`, { password: 'not the password', confirm: true });
    expect(del.status).toBe(403);
    expect((await c.get(`${API}/me`)).status).toBe(200);
    const staff = await h.login('worker.b');
    const enroll = await staff.post(`${API}/auth/mfa/enroll`, { password: 'not the password' });
    expect(enroll.status).toBe(403);
    expect((await staff.get(`${API}/auth/session`)).status).toBe(200);
  });
});

describe('AUTH-02/SEC-01 cookies require origin and CSRF token for mutations', () => {
  it('rejects a cookie-authenticated mutation without the CSRF token or from another origin', async () => {
    const c = await h.login('maya');
    const noToken = await c.agent.post(`${API}/auth/logout`).set('Origin', TEST_ORIGIN).send({});
    expect(noToken.status).toBe(403);
    const crossOrigin = await c.agent.post(`${API}/auth/logout`).set('Origin', 'https://evil.example').set('X-CSRF-Token', c.csrf!).send({});
    expect(crossOrigin.status).toBe(403);
    expect((await c.get(`${API}/me`)).status).toBe(200);
  });
});
