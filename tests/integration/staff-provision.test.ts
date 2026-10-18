import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { databaseUrl } from '../support/db.js';
import { TEST_DIGEST_KEY, TEST_ENC_KEY_V1, TEST_ORIGIN } from '../support/env.js';
import { totpCode, useHarness } from '../support/harness.js';

const h = useHarness();
const API = '/api/v1';

/** Runs the real operator command (scripts/staff-admin.ts) against this file's disposable database. */
function staffAdmin(...args: string[]) {
  const r = spawnSync(process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'), 'scripts/staff-admin.ts', ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl(h.dbName),
      APP_ORIGIN: TEST_ORIGIN,
      DIGEST_KEY: TEST_DIGEST_KEY,
      FIELD_ENCRYPTION_KEYS: `v1:${TEST_ENC_KEY_V1}`,
      FIELD_ENCRYPTION_ACTIVE_KEY: 'v1',
      INCIDENT_SLUG: 'demo-hurricane-1',
    },
  });
  return { status: r.status, output: `${r.stdout}${r.stderr}` };
}

// Shelter staff accounts: a person registers a normal account, an operator grants the role with
// the command line (no web endpoint can), and the first staff sign-in requires two-step setup.
describe('STAFF-01 staff accounts come from the operator command, never from the website', () => {
  it('grants a shelter role only with --confirm to an existing account; staff tools then need two-step verification', async () => {
    const c = h.client();
    const reg = await c.post(`${API}/auth/register`, { username: 'new.worker', password: 'new worker passphrase', alias: 'New Worker (fictional)' });
    expect(reg.status).toBe(201);
    c.csrf = reg.body.session.csrfToken;
    expect((await c.get(`${API}/staff/me`)).status).toBe(403);

    const refused = staffAdmin('provision', '--username', 'new.worker', '--role', 'WORKER', '--shelter', 'Riverside Community Center');
    expect(refused.status).not.toBe(0);
    expect(refused.output).toContain('Refusing to change staff access without --confirm.');
    expect(staffAdmin('provision', '--username', 'nobody.here', '--role', 'WORKER', '--shelter', 'Riverside Community Center', '--confirm').output).toContain('No such account.');
    expect(staffAdmin('provision', '--username', 'new.worker', '--role', 'WORKER', '--confirm').output).toContain('Workers and coordinators need a shelter.');
    expect(await h.prisma.staffMembership.count({ where: { account: { normalizedUsername: 'new.worker' } } })).toBe(0);

    const granted = staffAdmin('provision', '--username', 'new.worker', '--role', 'WORKER', '--shelter', 'Riverside Community Center', '--confirm');
    expect(granted.status).toBe(0);
    expect(granted.output).toContain('provision: done');
    // Granting the same active role twice is refused with a clear message, not a database error.
    const again = staffAdmin('provision', '--username', 'new.worker', '--role', 'WORKER', '--shelter', 'Riverside Community Center', '--confirm');
    expect(again.status).not.toBe(0);
    expect(again.output).toContain('already has this active staff role');

    // The privilege change ended the old session.
    expect((await c.get(`${API}/me`)).status).toBe(401);
    const staff = h.client();
    const login = await staff.post(`${API}/auth/login`, { username: 'new.worker', password: 'new worker passphrase' });
    expect(login.status).toBe(200);
    staff.csrf = login.body.csrfToken;
    const before = await staff.get(`${API}/staff/me`);
    expect(before.status).toBe(403);
    expect(before.body.error.code).toBe('MFA_REQUIRED');

    const enroll = await staff.post(`${API}/auth/mfa/enroll`, { password: 'new worker passphrase' });
    expect(enroll.status).toBe(200);
    h.clock.advance(31_000);
    const verify = await staff.post(`${API}/auth/mfa/verify`, { code: totpCode(enroll.body.secret, h.clock.now()) });
    expect(verify.status).toBe(200);
    staff.csrf = verify.body.csrfToken;
    const me = await staff.get(`${API}/staff/me`);
    expect(me.status).toBe(200);
    expect(me.body.memberships).toEqual([{ role: 'WORKER', shelter: { id: expect.any(String), name: 'Riverside Community Center' } }]);
  });
});
