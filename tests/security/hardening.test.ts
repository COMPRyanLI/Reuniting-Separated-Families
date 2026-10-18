import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { demoSecret, fixtureId } from '../../prisma/fixtures.js';
import { createApp } from '../../apps/api/src/app.js';
import { createCrypto } from '../../apps/api/src/lib/crypto.js';
import { silentLogger } from '../../apps/api/src/lib/logger.js';
import { suspendMembership } from '../../apps/api/src/services/staffAdmin.js';
import { SEED_PASSWORD, SEED_SECRET, TEST_DIGEST_KEY, TEST_ENC_KEY_V1, TEST_ORIGIN, testConfig } from '../support/env.js';
import { ids, useHarness } from '../support/harness.js';
import { API, contactCode, deliveredRequest, drain, incoming, key, outgoing, respond } from '../support/flows.js';

const h = useHarness({ configOverrides: { RATE_LIMIT_REQUESTS_PER_HOUR: '1000' } });

describe('SEC-01 cross-origin, CSRF and state-changing GET', () => {
  it('rejects forged mutations, sets no permissive CORS, and has no state change via GET', async () => {
    const maya = await h.login('maya');
    const leo = await h.login('leo');
    const r = await deliveredRequest(h, maya, leo, 'csrf target');
    const url = `${API}/requests/${r.id}/withdraw`;
    const forged = [
      () => maya.agent.post(url).set('Origin', 'https://evil.example').set('X-CSRF-Token', maya.csrf!),
      () => maya.agent.post(url).set('Origin', TEST_ORIGIN),
      () => maya.agent.post(url).set('X-CSRF-Token', maya.csrf!),
      () => maya.agent.post(url).set('Origin', 'null').set('X-CSRF-Token', maya.csrf!),
      () => maya.agent.post(url).set('Origin', TEST_ORIGIN).set('X-CSRF-Token', leo.csrf!),
    ];
    for (const f of forged) {
      const res = await f().send({});
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CSRF_REJECTED');
    }
    const preflight = await request(h.app).options(`${API}/requests`).set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST');
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
    expect(preflight.headers['access-control-allow-credentials']).toBeUndefined();
    for (const path of [`/requests/${r.id}/withdraw`, '/auth/logout', `/requests/${r.id}/decline`, '/me/grants/revoke-all']) {
      expect((await maya.get(`${API}${path}`)).status, path).toBe(404);
    }
    expect((await h.prisma.reunionRequest.findUniqueOrThrow({ where: { id: r.id } })).withdrawnAt).toBeNull();
    expect((await maya.get(`${API}/me`)).status).toBe(200); // still signed in after GET /auth/logout
    expect((await maya.post(`${API}/requests/${r.id}/withdraw`)).status).toBe(200); // legitimate flow works
  });
});

describe('SEC-02 inert text, SQL-like input, oversized bodies and injection', () => {
  it('stores and returns hostile-looking text verbatim as data', async () => {
    const leo = await h.login('leo');
    const noor = await h.login('noor');
    const html = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const sql = `Robert'); DROP TABLE "Person"; --`;
    const me = await noor.get(`${API}/me`);
    expect((await noor.patch(`${API}/me`, { alias: sql, expectedVersion: me.body.version })).status).toBe(200);
    const code = await contactCode(leo);
    await noor.post(`${API}/requests`, { routeType: 'CODE', contactCode: code, introduction: html }, { 'Idempotency-Key': key() });
    await drain(h);
    const inc = (await incoming(leo)).find((x) => x.introduction === html)!;
    expect(inc.requesterAlias).toBe(sql);
    expect(inc.introduction).toBe(html);
    expect(await h.prisma.person.count()).toBeGreaterThan(5); // table intact
    expect((await respond(leo, inc.id, inc.version, { scope: 'SAFETY_MESSAGE', message: html })).status).toBe(201);
  });

  it('rejects oversized bodies and unknown ownership fields', async () => {
    const maya = await h.login('maya');
    const big = await maya.post(`${API}/requests`, { routeType: 'CODE', contactCode: 'x', introduction: 'a'.repeat(20_000) }, { 'Idempotency-Key': key() });
    expect(big.status).toBe(413);
    const me = await maya.get(`${API}/me`);
    for (const body of [
      { alias: 'x', expectedVersion: me.body.version, accountId: ids.account('leo') },
      { alias: 'x', expectedVersion: me.body.version, restrictedReferral: true },
    ]) {
      expect((await maya.patch(`${API}/me`, body)).status).toBe(422);
    }
    expect((await maya.patch(`${API}/me/privacy`, { requestMode: 'ASSISTED', expectedVersion: me.body.version, personId: ids.person('leo') })).status).toBe(422);
    expect((await maya.post(`${API}/me/check-ins`, { shelterId: ids.shelter('A'), observedAt: h.clock.now().toISOString(), authorAccountId: ids.account('worker.a'), source: 'STAFF_RECORDED' }, { 'Idempotency-Key': key() })).status).toBe(422);
    const leoPerson = await h.prisma.person.findUniqueOrThrow({ where: { id: ids.person('leo') } });
    expect(leoPerson.requestMode).toBe('CODE_ONLY');
  });
});

describe('SEC-03 sentinel scan of bodies, logs and audit rows', () => {
  it('ordinary and exception logs and audit metadata contain no secrets, messages or locations', async () => {
    h.logLines.length = 0;
    const maya = await h.login('maya');
    const leo = await h.login('leo');
    const code = await contactCode(leo);
    const sent = await maya.post(`${API}/requests`, { routeType: 'CODE', contactCode: code, introduction: 'SENTINEL_LOG_INTRO' }, { 'Idempotency-Key': key() });
    await drain(h);
    const inc = (await incoming(leo)).find((x) => x.id === sent.body.requestId)!;
    await respond(leo, inc.id, inc.version, { scope: 'SHELTER', checkInId: fixtureId('checkin:leo-shelter-b'), message: 'SENTINEL_LOG_MSG' });
    await maya.post(`${API}/auth/recover`, { username: 'maya', recoverySecret: 'SENTINEL-RECOVERY-0000-0000-0000-00', newPassword: 'SENTINEL_NEW_PASSWORD' });
    await maya.post(`${API}/requests`, { routeType: 'ROUTED', introduction: 'x', clues: 'SENTINEL_LOG_CLUE', destinationShelterId: ids.shelter('B'), relayConsent: true }, { 'Idempotency-Key': key() });
    // Force an exception path (tampered ciphertext) to check exception logging.
    const row = await h.prisma.reunionRequest.findUniqueOrThrow({ where: { id: inc.id } });
    await h.prisma.reunionRequest.update({ where: { id: inc.id }, data: { encryptedIntroduction: 'v1.AAAA.BBBB.CCCC' } });
    const err = await leo.get(`${API}/requests/incoming`);
    expect(err.status).toBe(500);
    expect(JSON.stringify(err.body)).not.toMatch(/at .*\.(ts|js)|stack/i);
    await h.prisma.reunionRequest.update({ where: { id: inc.id }, data: { encryptedIntroduction: row.encryptedIntroduction } });

    const logs = h.logLines.join('\n');
    const audits = JSON.stringify(await h.prisma.auditEvent.findMany());
    for (const text of [logs, audits]) {
      for (const s of ['SENTINEL_LOG_INTRO', 'SENTINEL_LOG_MSG', 'SENTINEL_LOG_CLUE', 'SENTINEL-RECOVERY', 'SENTINEL_NEW_PASSWORD', SEED_PASSWORD, code, 'Hillcrest', 'Sample Road', TEST_DIGEST_KEY, TEST_ENC_KEY_V1]) {
        expect(text).not.toContain(s);
      }
    }
    expect(logs).toContain('"event":"http"');
    expect(logs).toContain('decryption_failed');
  });
});

describe('SEC-04 suspension, ended tasks, key failures and production headers', () => {
  it('a suspended staff member loses assisted access immediately', async () => {
    const wA = await h.loginStaff('wA');
    expect((await wA.post(`${API}/staff/cases/${ids.case('sam')}/verify`, { assistanceSecret: demoSecret(SEED_SECRET, 'assist:sam') })).status).toBe(200);
    await suspendMembership(h.deps, 'worker.a');
    expect((await wA.get(`${API}/staff/cases/${ids.case('sam')}`)).status).toBe(401); // sessions revoked by suspension
    const again = await h.login('worker.a');
    expect((await again.get(`${API}/staff/cases/${ids.case('sam')}`)).status).toBe(403);
  });

  it('a missing encryption key fails closed rather than returning plaintext', async () => {
    const maya = await h.login('maya');
    const leo = await h.login('leo');
    await deliveredRequest(h, maya, leo, 'SENTINEL_NOKEY');
    const otherKey = Buffer.alloc(32, 3).toString('base64');
    const config = testConfig(h.deps.config.databaseUrl, { RATE_LIMIT_LOGIN_IP: '100000', FIELD_ENCRYPTION_KEYS: `v9:${otherKey}`, FIELD_ENCRYPTION_ACTIVE_KEY: 'v9' });
    const app = createApp({ ...h.deps, config, crypto: createCrypto(config), logger: silentLogger });
    const login = await request(app).post(`${API}/auth/login`).set('Origin', TEST_ORIGIN).send({ username: 'leo', password: SEED_PASSWORD });
    const cookie = (login.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    const res = await request(app).get(`${API}/requests/incoming`).set('Cookie', cookie);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('SENTINEL_NOKEY');
  });

  it('production responses carry the reviewed cookie, CSP, HSTS and cache headers', async () => {
    const config = testConfig(h.deps.config.databaseUrl, { NODE_ENV: 'production', APP_ORIGIN: 'https://demo.example.org' });
    const app = createApp({ ...h.deps, config, crypto: createCrypto(config), logger: silentLogger });
    const login = await request(app).post(`${API}/auth/login`).set('Origin', 'https://demo.example.org').send({ username: 'noor', password: SEED_PASSWORD });
    const cookie = (login.headers['set-cookie'] as unknown as string[])[0]!;
    expect(cookie).toMatch(/^__Host-rf_session=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
    const h1 = login.headers;
    expect(h1['content-security-policy']).toContain("default-src 'self'");
    expect(h1['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(h1['content-security-policy']).toContain("script-src 'self'");
    expect(h1['content-security-policy']).not.toContain('unsafe-inline');
    expect(h1['strict-transport-security']).toMatch(/max-age=\d+/);
    expect(h1['cache-control']).toBe('no-store');
    expect(h1['referrer-policy']).toBe('no-referrer');
    expect(h1['x-content-type-options']).toBe('nosniff');
    expect(h1['x-frame-options']).toBe('SAMEORIGIN');
    const out = await outgoing(await h.login('noor'));
    expect(Array.isArray(out)).toBe(true);
  });
});
