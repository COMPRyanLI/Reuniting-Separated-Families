import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { demoSecret, fixtureId } from '../../prisma/fixtures.js';
import { runRetention } from '../../apps/api/src/jobs/retention.js';
import { applyDeletion } from '../../apps/api/src/services/deletion.js';
import { reencryptAll } from '../../apps/api/src/services/keyRotation.js';
import { createApp } from '../../apps/api/src/app.js';
import { createCrypto } from '../../apps/api/src/lib/crypto.js';
import { createLogger } from '../../apps/api/src/lib/logger.js';
import { DAY, HOUR } from '../../apps/api/src/lib/clock.js';
import { SEED_PASSWORD, SEED_SECRET, TEST_ENC_KEY_V1, testConfig } from '../support/env.js';
import { Client, ids, useHarness } from '../support/harness.js';
import { API, contactCode, deliveredRequest, drain, key, outgoing, respond } from '../support/flows.js';

const h = useHarness({ configOverrides: { RATE_LIMIT_REQUESTS_PER_HOUR: '1000' } });

async function newPerson(username: string, alias: string): Promise<Client> {
  const c = h.client();
  const reg = await c.post(`${API}/auth/register`, { username, password: 'long enough passphrase', alias });
  expect(reg.status).toBe(201);
  c.csrf = reg.body.session.csrfToken;
  return c;
}

// Content is purged inside the deletion transaction, so it never waits for the background job
// (which does not run while single-process hosting sleeps).
describe('DATA-01 deletion: immediate effect and immediate purge, others unaffected', () => {
  it('self deletion needs re-authentication, revokes sessions and grants at once, and purges content', async () => {
    const del = await newPerson('to.delete', 'Deletable SENTINEL_DEL_ALIAS');
    const maya = await h.login('maya');
    const ci = await del.post(`${API}/me/check-ins`, { shelterId: ids.shelter('A'), observedAt: h.clock.now().toISOString() }, { 'Idempotency-Key': key() });
    const r = await deliveredRequest(h, maya, del, 'before deletion');
    await respond(del, r.id, r.version, { scope: 'SHELTER', checkInId: ci.body.checkIn.id, message: 'SENTINEL_DEL_MSG' });
    const responseId = (await outgoing(maya)).find((o) => o.id === r.id)!.responseId!;
    expect((await maya.get(`${API}/responses/${responseId}`)).status).toBe(200);
    const leoBefore = await h.prisma.checkIn.count({ where: { personId: ids.person('leo') } });

    expect((await del.delete(`${API}/me`, { password: 'wrong password!!', confirm: true })).status).toBe(403);
    expect((await del.get(`${API}/me`)).status).toBe(200);
    expect((await del.delete(`${API}/me`, { password: 'long enough passphrase', confirm: true })).status).toBe(204);

    expect((await del.get(`${API}/me`)).status).toBe(401);
    expect((await h.client().post(`${API}/auth/login`, { username: 'to.delete', password: 'long enough passphrase' })).status).toBe(401);
    expect((await maya.get(`${API}/responses/${responseId}`)).status).toBe(404);
    expect((await outgoing(maya)).find((o) => o.id === r.id)!.status).toBe('RESPONSE_UNAVAILABLE');

    // No retention run: the content is already gone.
    const person = await h.prisma.person.findFirstOrThrow({ where: { account: { normalizedUsername: 'to.delete' } } });
    expect(person.purgedAt).not.toBeNull();
    expect(person.alias).toBe('');
    expect(await h.prisma.checkIn.count({ where: { personId: person.id } })).toBe(0);
    expect(await h.prisma.sharingGrant.count({ where: { OR: [{ subjectPersonId: person.id }, { recipientPersonId: person.id }] } })).toBe(0);
    const resp = await h.prisma.response.findUniqueOrThrow({ where: { id: responseId } });
    expect(resp.encryptedMessage).toBeNull();
    expect(resp.purgedAt).not.toBeNull();
    const tomb = await h.prisma.deletionTombstone.findFirstOrThrow({ where: { personRef: person.id } });
    expect(tomb.purgedAt).not.toBeNull();
    expect(JSON.stringify(tomb)).not.toContain('SENTINEL');
    // The counterpart still sees a neutral state; unrelated people keep their data.
    expect((await outgoing(await h.login('maya'))).find((o) => o.id === r.id)!.status).toBe('RESPONSE_UNAVAILABLE');
    expect(await h.prisma.checkIn.count({ where: { personId: ids.person('leo') } })).toBe(leoBefore);
    const allText = JSON.stringify(await h.prisma.$queryRawUnsafe(`SELECT * FROM "Person" WHERE "id" = '${person.id}'`));
    expect(allText).not.toContain('SENTINEL_DEL_ALIAS');
  });

  it('verified assisted deletion purges the assisted person and closes the case', async () => {
    const wB = await h.loginStaff('wB');
    await wB.post(`${API}/staff/cases/${ids.case('bo')}/verify`, { assistanceSecret: demoSecret(SEED_SECRET, 'assist:bo') });
    expect((await wB.delete(`${API}/staff/cases/${ids.case('bo')}/person`, { confirm: true })).status).toBe(204);
    const bo = await h.prisma.person.findUniqueOrThrow({ where: { id: ids.assisted('bo') } });
    expect(bo.purgedAt).not.toBeNull();
    expect((await h.prisma.assistanceCase.findUniqueOrThrow({ where: { id: ids.case('bo') } })).state).toBe('CLOSED');
    expect(await h.prisma.assistanceCredential.count({ where: { personId: bo.id } })).toBe(0);
    expect((await h.prisma.person.findUniqueOrThrow({ where: { id: ids.assisted('ana') } })).purgedAt).toBeNull();
  });

  it('retention still purges a deletion recorded without its purge (data written by an earlier version)', async () => {
    const old = await newPerson('old.version', 'Old version SENTINEL_OLD_ALIAS');
    await old.post(`${API}/me/check-ins`, { shelterId: ids.shelter('A'), observedAt: h.clock.now().toISOString() }, { 'Idempotency-Key': key() });
    const person = await h.prisma.person.findFirstOrThrow({ where: { account: { normalizedUsername: 'old.version' } } });
    const now = h.clock.now();
    await h.prisma.$transaction(async (tx) => {
      await applyDeletion(h.deps, tx, person.id, person.accountId, now);
      await tx.deletionTombstone.create({ data: { personRef: person.id, accountRef: person.accountId, deletedAt: now, purgeAfter: now, reason: 'SELF' } });
    });
    expect(await h.prisma.checkIn.count({ where: { personId: person.id } })).toBe(1);

    h.clock.advance(HOUR);
    expect((await runRetention(h.deps)).personsPurged).toBe(1);
    expect(await h.prisma.checkIn.count({ where: { personId: person.id } })).toBe(0);
    expect((await h.prisma.person.findUniqueOrThrow({ where: { id: person.id } })).alias).toBe('');
    expect((await h.prisma.deletionTombstone.findFirstOrThrow({ where: { personRef: person.id } })).purgedAt).not.toBeNull();
  });
});

describe('DATA-02 retention boundaries under a fixed clock', () => {
  it('expires, purges and reviews exactly the policy-targeted records', async () => {
    const maya = await h.login('maya');
    const leo = await h.login('leo');
    const code = await contactCode(leo);
    const unanswered = await maya.post(`${API}/requests`, { routeType: 'CODE', contactCode: code, introduction: 'SENTINEL_RETENTION_INTRO' }, { 'Idempotency-Key': key() });
    await drain(h);
    const submitted = await h.prisma.reunionRequest.findUniqueOrThrow({ where: { id: unanswered.body.requestId } });
    const answered = await deliveredRequest(h, maya, leo, 'kept: answered');
    await respond(leo, answered.id, answered.version, { scope: 'SAFETY_MESSAGE', message: 'kept' });

    // Day 14 + 1 s: unanswered request expires; its closure time equals the original deadline.
    h.clock.set(new Date(submitted.expiresAt.getTime() + 1000));
    await runRetention(h.deps);
    const expired = await h.prisma.reunionRequest.findUniqueOrThrow({ where: { id: submitted.id } });
    expect(expired.internalState).toBe('EXPIRED');
    expect(expired.closedAt?.getTime()).toBe(submitted.expiresAt.getTime());
    expect(expired.encryptedIntroduction).not.toBeNull();

    // Old sessions (revoked/expired more than 24 h ago) and used recovery secrets are removed.
    const staleSessions = await h.prisma.session.count({ where: { expiresAt: { lte: new Date(h.clock.now().getTime() - DAY) } } });
    expect(staleSessions).toBe(0);

    // Outbox: completed jobs older than 7 days are deleted.
    expect(await h.prisma.outboxJob.count({ where: { state: 'DONE', completedAt: { lte: new Date(h.clock.now().getTime() - 7 * DAY) } } })).toBe(0);

    // Day 14 + 30 days: personal text of the closed, unanswered request is purged; the answered one is kept.
    h.clock.advance(30 * DAY);
    await runRetention(h.deps);
    const purged = await h.prisma.reunionRequest.findUniqueOrThrow({ where: { id: submitted.id } });
    expect(purged.encryptedIntroduction).toBeNull();
    expect(purged.textPurgedAt).not.toBeNull();
    const kept = await h.prisma.reunionRequest.findUniqueOrThrow({ where: { id: answered.id } });
    expect(kept.encryptedIntroduction).not.toBeNull();

    // Inactive cases (30+ days) produce a review notice for the shelter's coordinators; an extended case does not.
    const reviewNotes = await h.prisma.notification.findMany({ where: { kind: 'CASE_REVIEW_DUE', recipientAccountId: ids.account('coord.a') } });
    expect(reviewNotes.length).toBeGreaterThan(0);
    const cA = await h.loginStaff('cA');
    expect((await cA.post(`${API}/staff/cases/${ids.case('r')}/review`, { action: 'EXTEND_30_DAYS' })).status).toBe(200);
    const before = await h.prisma.notification.count({ where: { kind: 'CASE_REVIEW_DUE', resourceId: ids.case('r') } });
    h.clock.advance(DAY);
    await runRetention(h.deps);
    expect(await h.prisma.notification.count({ where: { kind: 'CASE_REVIEW_DUE', resourceId: ids.case('r') } })).toBe(before);
    expect((await h.prisma.assistanceCase.findUniqueOrThrow({ where: { id: ids.case('r') } })).state).toBe('ACTIVE');

    // Day 14 + 90: audit metadata older than 90 days is removed; no grant to or from a deleted person stays active.
    h.clock.advance(60 * DAY);
    await runRetention(h.deps);
    expect(await h.prisma.auditEvent.count({ where: { occurredAt: { lte: new Date(h.clock.now().getTime() - 90 * DAY) } } })).toBe(0);
    const orphaned = await h.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM "SharingGrant" g JOIN "Person" p ON p."id" IN (g."subjectPersonId", g."recipientPersonId")
      WHERE g."revokedAt" IS NULL AND p."deletedAt" IS NOT NULL`;
    expect(Number(orphaned[0]!.n)).toBe(0);
    expect(await h.prisma.idempotencyRecord.count({ where: { expiresAt: { lte: h.clock.now() } } })).toBe(0);
    expect(await h.prisma.rateLimitBucket.count({ where: { expiresAt: { lte: h.clock.now() } } })).toBe(0);
  });
});

describe('DATA-04 stored secrets, ciphertext tampering and key rotation', () => {
  it('stores no raw secrets or protected plaintext', async () => {
    const c = await newPerson('cipher.check', 'Cipher');
    const leo = await h.login('leo');
    const code = await contactCode(leo);
    await c.post(`${API}/requests`, { routeType: 'CODE', contactCode: code, introduction: 'SENTINEL_PLAINTEXT_INTRO' }, { 'Idempotency-Key': key() });
    const dump = JSON.stringify(
      await h.prisma.$queryRawUnsafe(`
        SELECT (SELECT json_agg(r) FROM "ReunionRequest" r) AS requests,
               (SELECT json_agg(c) FROM "ContactCode" c) AS codes,
               (SELECT json_agg(s) FROM "Session" s) AS sessions,
               (SELECT json_agg(a) FROM "Account" a) AS accounts,
               (SELECT json_agg(x) FROM "RecoveryCredential" x) AS recovery,
               (SELECT json_agg(m) FROM "StaffMfa" m) AS mfa`),
    );
    expect(dump).not.toContain('SENTINEL_PLAINTEXT_INTRO');
    expect(dump).not.toContain(code);
    expect(dump).not.toContain(code.replaceAll('-', ''));
    expect(dump).not.toContain(SEED_PASSWORD);
    const acct = await h.prisma.account.findUniqueOrThrow({ where: { normalizedUsername: 'cipher.check' } });
    expect(acct.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,(t=2,p=1|p=1,t=2)\$/);
  });

  it('fails closed on tampered ciphertext with a generic error and no plaintext fallback', async () => {
    const maya = await h.login('maya');
    const leo = await h.login('leo');
    const r = await deliveredRequest(h, maya, leo, 'tamper target SENTINEL_TAMPER');
    const row = await h.prisma.reunionRequest.findUniqueOrThrow({ where: { id: r.id } });
    const parts = row.encryptedIntroduction!.split('.');
    const body = Buffer.from(parts[2]!, 'base64url');
    body[0] = body[0]! ^ 1;
    await h.prisma.reunionRequest.update({ where: { id: r.id }, data: { encryptedIntroduction: [parts[0], parts[1], body.toString('base64url'), parts[3]].join('.') } });
    const res = await leo.get(`${API}/requests/incoming`);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/SENTINEL_TAMPER|stack|Decryption|\.ts:/);
    expect(h.logLines.some((l) => l.includes('decryption_failed'))).toBe(true);
    expect(h.logLines.join('\n')).not.toContain('SENTINEL_TAMPER');
    await h.prisma.reunionRequest.update({ where: { id: r.id }, data: { encryptedIntroduction: row.encryptedIntroduction } });
  });

  it('rotates to a new key version while keeping authorized data readable', async () => {
    const maya = await h.login('maya');
    const leo = await h.login('leo');
    const r = await deliveredRequest(h, maya, leo, 'rotation SENTINEL_ROTATE');
    const v2 = randomBytes(32).toString('base64');
    const rotatedConfig = testConfig(h.deps.config.databaseUrl, { RATE_LIMIT_LOGIN_IP: '100000', FIELD_ENCRYPTION_KEYS: `v1:${TEST_ENC_KEY_V1},v2:${v2}`, FIELD_ENCRYPTION_ACTIVE_KEY: 'v2' });
    const rotatedDeps = { ...h.deps, config: rotatedConfig, crypto: createCrypto(rotatedConfig), logger: createLogger(() => {}) };
    const summary = await reencryptAll(rotatedDeps);
    expect(summary.reencrypted).toBeGreaterThan(0);
    const after = await h.prisma.reunionRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.encryptedIntroduction!.startsWith('v2.')).toBe(true);
    expect(await h.prisma.reunionRequest.count({ where: { encryptedIntroduction: { startsWith: 'v1.' } } })).toBe(0);
    // With only v2 configured, data stays readable through the normal API.
    const v2Only = testConfig(h.deps.config.databaseUrl, { RATE_LIMIT_LOGIN_IP: '100000', FIELD_ENCRYPTION_KEYS: `v2:${v2}`, FIELD_ENCRYPTION_ACTIVE_KEY: 'v2' });
    const app = createApp({ ...h.deps, config: v2Only, crypto: createCrypto(v2Only) });
    const c = new Client(app);
    const login = await c.post(`${API}/auth/login`, { username: 'leo', password: SEED_PASSWORD });
    c.csrf = login.body.csrfToken;
    const inc = await c.get(`${API}/requests/incoming`);
    expect(inc.status).toBe(200);
    expect(JSON.stringify(inc.body)).toContain('SENTINEL_ROTATE');
    // Staff TOTP secrets were re-encrypted too.
    expect(await h.prisma.staffMfa.count({ where: { encryptedTotpSecret: { startsWith: 'v1.' } } })).toBe(0);
    void fixtureId;
  });
});
