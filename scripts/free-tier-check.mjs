// Local rehearsal of the free single-process start (scripts/start-free.mjs) on a disposable
// rf_test_free_* database: Render-style environment (RENDER_EXTERNAL_URL, one generated key),
// no separate worker process. Runs over http://localhost, so NODE_ENV=test (no Secure cookies).
// Also deletes a seeded individual and a seeded assisted person, restarts, and checks that the
// startup seed does not bring their purged content back.
//   npm run build && npm run check:free-start
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as OTPAuth from 'otpauth';
import { demoSecret, fixtureId } from '../prisma/fixtures.ts';

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://rf_local:rf_local_dev_only@127.0.0.1:55432/postgres';
const DB = `rf_test_free_${randomBytes(4).toString('hex')}`;
const PORT = Number(process.env.FREE_CHECK_PORT ?? 3700);
const ORIGIN = `http://localhost:${PORT}`;
const node = process.execPath;
const dbUrl = (() => {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${DB}`;
  return u.toString();
})();
const seedPassword = randomBytes(32).toString('base64');
const seedSecret = randomBytes(32).toString('base64');
const env = {
  ...process.env,
  NODE_ENV: 'test',
  PORT: String(PORT),
  RENDER_EXTERNAL_URL: ORIGIN,
  DATABASE_URL: dbUrl,
  DIGEST_KEY: randomBytes(32).toString('base64'),
  FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  RUN_WORKER_IN_PROCESS: 'true',
  DEMO_MODE: 'true',
  SEED_ON_START: 'yes',
  SEED_CONFIRM_FICTIONAL: 'yes',
  SEED_PASSWORD: seedPassword,
  SEED_SECRET: seedSecret,
  WORKER_POLL_MS: '1000',
};
// Blank (not deleted): Prisma Client fills *unset* variables from a local .env file, which Render
// does not have; blank values stop that and the app treats blank as unset.
for (const k of ['APP_ORIGIN', 'FIELD_ENCRYPTION_KEYS', 'FIELD_ENCRYPTION_ACTIVE_KEY']) env[k] = '';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
};
function adminSql(sql) {
  const script = `import { PrismaClient } from '@prisma/client'; const p = new PrismaClient({ datasourceUrl: process.env.ADMIN_URL }); await p.$executeRawUnsafe(process.env.SQL); await p.$disconnect();`;
  if (spawnSync(node, ['--input-type=module', '-e', script], { env: { ...process.env, ADMIN_URL, SQL: sql }, stdio: 'inherit' }).status !== 0) throw new Error('admin SQL failed');
}
function count(sql) {
  const script = `import { PrismaClient } from '@prisma/client'; const p = new PrismaClient({ datasourceUrl: process.env.DB }); const r = await p.$queryRawUnsafe(process.env.SQL); console.log(Number(Object.values(r[0])[0])); await p.$disconnect();`;
  return Number(spawnSync(node, ['--input-type=module', '-e', script], { env: { ...process.env, DB: dbUrl, SQL: sql }, encoding: 'utf8' }).stdout.trim());
}
let proc = null;
let output = '';
async function start() {
  output = '';
  proc = spawn(node, ['scripts/start-free.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', (d) => (output += d));
  proc.stderr.on('data', (d) => (output += d));
  for (let i = 0; i < 300; i++) {
    try {
      if ((await fetch(`${ORIGIN}/api/health/ready`)).ok) return;
    } catch {
      // starting
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('free start did not become ready');
}
async function stop() {
  proc?.kill();
  proc = null;
  await new Promise((r) => setTimeout(r, 800));
}

class Agent {
  cookie = '';
  csrf = '';
  async req(method, url, body) {
    const res = await fetch(`${ORIGIN}/api/v1${url}`, {
      method,
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...(this.cookie ? { Cookie: this.cookie } : {}), ...(this.csrf && method !== 'GET' ? { 'X-CSRF-Token': this.csrf } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const json = await res.json().catch(() => ({}));
    if (json.csrfToken) this.csrf = json.csrfToken;
    return { status: res.status, json };
  }
}
async function login(username, password) {
  const a = new Agent();
  return { agent: a, status: (await a.req('POST', '/auth/login', { username, password })).status };
}

// Fixture identifiers (prisma/fixtures.ts): Leo has an account; Ana is an assisted person of worker.b.
const LEO = fixtureId('person:leo');
const ANA = fixtureId('person:assisted:ana');
const ANA_CASE = fixtureId('case:ana');
const purgedContent = () => ({
  leoCheckIns: count(`SELECT count(*) FROM "CheckIn" WHERE "personId" = '${LEO}'`),
  anaCheckIns: count(`SELECT count(*) FROM "CheckIn" WHERE "personId" = '${ANA}'`),
  anaCredentials: count(`SELECT count(*) FROM "AssistanceCredential" WHERE "personId" = '${ANA}'`),
});
const isPurged = (c) => c.leoCheckIns === 0 && c.anaCheckIns === 0 && c.anaCredentials === 0;

let exitCode;
try {
  adminSql(`CREATE DATABASE "${DB}"`);
  await start();
  check('start script migrated an empty database and became ready', true);
  check('seed ran at start (fictional account signs in with the generated password)', (await login('maya', seedPassword)).status === 200);
  const smoke = spawnSync(node, [path.resolve('node_modules/tsx/dist/cli.mjs'), 'scripts/smoke-deployed.ts', '--base-url', ORIGIN], { encoding: 'utf8' });
  const summary = (smoke.stdout.match(/(\d+)\/(\d+) checks passed/) ?? [])[0] ?? 'no summary';
  check('smoke test incl. delivery by the in-process worker', smoke.status === 0, summary);

  // Delete a seeded individual (self) and a seeded assisted person (their verified worker).
  const before = purgedContent();
  const leo = await login('leo', seedPassword);
  const leoDeleted = (await leo.agent.req('DELETE', '/me', { password: seedPassword, confirm: true })).status;
  const wB = await login('worker.b', seedPassword);
  const enroll = await wB.agent.req('POST', '/auth/mfa/enroll', { password: seedPassword });
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(enroll.json.secret), digits: 6, period: 30, algorithm: 'SHA1' });
  const mfa = (await wB.agent.req('POST', '/auth/mfa/verify', { code: totp.generate() })).status;
  const verified = (await wB.agent.req('POST', `/staff/cases/${ANA_CASE}/verify`, { assistanceSecret: demoSecret(seedSecret, 'assist:ana') })).status;
  const anaDeleted = (await wB.agent.req('DELETE', `/staff/cases/${ANA_CASE}/person`, { confirm: true })).status;
  const afterDelete = purgedContent();
  check(
    'deleting seeded Leo and Ana purges their check-ins and assistance credential at once',
    leoDeleted === 204 && mfa === 200 && verified === 200 && anaDeleted === 204 && !isPurged(before) && isPurged(afterDelete),
    `before ${JSON.stringify(before)}, after ${JSON.stringify(afterDelete)}`,
  );

  const accountsBefore = count('SELECT count(*) FROM "Account"');
  await stop();
  await start();
  check('restart: startup seed skipped the already seeded database', output.includes('Seed skipped: this database was already seeded.'));
  const afterRestart = purgedContent();
  check('restart: purged check-ins and assistance credentials were not recreated', isPurged(afterRestart), JSON.stringify(afterRestart));
  check('restart: data persisted and no accounts were added', count('SELECT count(*) FROM "Account"') === accountsBefore, `${accountsBefore} accounts`);
  check('restart: deleted Leo still cannot sign in; Maya still can', (await login('leo', seedPassword)).status === 401 && (await login('maya', seedPassword)).status === 200);
  await stop();
  const failed = results.filter((r) => !r.ok);
  mkdirSync('evidence/drills', { recursive: true });
  writeFileSync('evidence/drills/free-tier-check.json', JSON.stringify({ ranAt: new Date().toISOString(), note: 'local rehearsal over http, NODE_ENV=test; not a deployment', results }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} free-start checks passed`);
  exitCode = failed.length ? 1 : 0;
} catch (e) {
  console.error(`free-start check failed: ${e instanceof Error ? e.message : e}`);
  exitCode = 1;
} finally {
  await stop();
  try {
    adminSql(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
  } catch {
    console.error(`could not drop ${DB}`);
  }
}
process.exit(exitCode);
