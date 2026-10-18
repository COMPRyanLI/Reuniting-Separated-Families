// Restore drill through the real operator commands, on disposable rf_test_drill_* databases.
// Proves: a backup taken before a deletion and a revocation is gated (503) after restore,
// and after `ops ledger-replay` serves neither the deleted account nor the revoked answer.
//   npm run build && npm run drill:restore
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://rf_local:rf_local_dev_only@127.0.0.1:55432/postgres';
const tag = randomBytes(4).toString('hex');
const LIVE = `rf_test_drill_live_${tag}`;
const BACKUP = `rf_test_drill_backup_${tag}`;
const PORT = Number(process.env.DRILL_PORT ?? 3600);
const ORIGIN = `http://localhost:${PORT}`;
const node = process.execPath;
const dbUrl = (name) => {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${name}`;
  return u.toString();
};
const key = () => randomBytes(32).toString('base64');
const baseEnv = {
  ...process.env,
  NODE_ENV: 'test',
  PORT: String(PORT),
  APP_ORIGIN: ORIGIN,
  DIGEST_KEY: key(),
  FIELD_ENCRYPTION_KEYS: `v1:${key()}`,
  FIELD_ENCRYPTION_ACTIVE_KEY: 'v1',
  DEMO_MODE: 'true',
  WORKER_POLL_MS: '300',
  RATE_LIMIT_LOGIN_IP: '100000',
  RATE_LIMIT_REGISTER_IP: '100000',
  SEED_PASSWORD: `drill-only-${randomBytes(4).toString('hex')}`,
  SEED_SECRET: `drill-only-secret-${randomBytes(6).toString('hex')}`,
};
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
};

function adminSql(sql) {
  const script = `import { PrismaClient } from '@prisma/client'; const p = new PrismaClient({ datasourceUrl: process.env.ADMIN_URL }); await p.$executeRawUnsafe(process.env.SQL); await p.$disconnect();`;
  const r = spawnSync(node, ['--input-type=module', '-e', script], { env: { ...process.env, ADMIN_URL, SQL: sql }, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('admin SQL failed');
}
function querySql(dbName, sql) {
  const script = `import { PrismaClient } from '@prisma/client'; const p = new PrismaClient({ datasourceUrl: process.env.DB }); const r = await p.$queryRawUnsafe(process.env.SQL); console.log(JSON.stringify(r, (k, v) => typeof v === 'bigint' ? Number(v) : v)); await p.$disconnect();`;
  const r = spawnSync(node, ['--input-type=module', '-e', script], { env: { ...process.env, DB: dbUrl(dbName), SQL: sql }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('query failed');
  return JSON.parse(r.stdout.trim());
}
function run(args, dbName) {
  const r = spawnSync(node, args, { env: { ...baseEnv, DATABASE_URL: dbUrl(dbName) }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${args.slice(-3).join(' ')} failed: ${r.stderr.slice(0, 300)}`);
  return r.stdout;
}
const ops = (dbName, ...args) => run([path.resolve('node_modules/tsx/dist/cli.mjs'), 'scripts/ops.ts', ...args], dbName);

let procs = [];
async function start(dbName, withWorker = true) {
  const env = { ...baseEnv, DATABASE_URL: dbUrl(dbName) };
  procs = [spawn(node, ['apps/api/dist/server.js'], { env, stdio: 'ignore' })];
  if (withWorker) procs.push(spawn(node, ['apps/api/dist/worker.js'], { env, stdio: 'ignore' }));
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${ORIGIN}/api/health/live`);
      if (r.ok) return;
    } catch {
      // starting
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}
async function stop() {
  for (const p of procs) p.kill();
  procs = [];
  await new Promise((r) => setTimeout(r, 800));
}

class Agent {
  cookie = '';
  csrf = '';
  async req(method, p, body, headers = {}) {
    const res = await fetch(`${ORIGIN}/api/v1${p}`, {
      method,
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...(this.cookie ? { Cookie: this.cookie } : {}), ...(this.csrf && method !== 'GET' ? { 'X-CSRF-Token': this.csrf } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    let json = {};
    try {
      json = await res.json();
    } catch {
      // empty
    }
    if (json?.session?.csrfToken) this.csrf = json.session.csrfToken;
    if (json?.csrfToken) this.csrf = json.csrfToken;
    return { status: res.status, json };
  }
}
const idem = () => ({ 'Idempotency-Key': `drill-${randomBytes(8).toString('hex')}` });

let exitCode;
const workdir = mkdtempSync(path.join(tmpdir(), 'rf-drill-'));
try {
  adminSql(`CREATE DATABASE "${LIVE}"`);
  run([path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], LIVE);
  run([path.resolve('node_modules/tsx/dist/cli.mjs'), 'prisma/seed.ts'], LIVE);

  // 1. Live data: an area answer from S to R, and a victim account with a check-in.
  await start(LIVE);
  const S = new Agent();
  const R = new Agent();
  const V = new Agent();
  const pw = 'drill passphrase long enough';
  await S.req('POST', '/auth/register', { username: `drill.s.${tag}`, password: pw, alias: 'Drill Subject' });
  await R.req('POST', '/auth/register', { username: `drill.r.${tag}`, password: pw, alias: 'Drill Requester' });
  await V.req('POST', '/auth/register', { username: `drill.v.${tag}`, password: pw, alias: 'Drill Victim' });
  const shelterId = (await S.req('GET', '/shelters')).json.shelters[0].id;
  const ci = await S.req('POST', '/me/check-ins', { shelterId, observedAt: new Date().toISOString() }, idem());
  await V.req('POST', '/me/check-ins', { shelterId, observedAt: new Date().toISOString() }, idem());
  const code = (await S.req('POST', '/me/contact-code/rotate')).json.contactCode;
  await R.req('POST', '/requests', { routeType: 'CODE', contactCode: code, introduction: 'Drill request (fictional)' }, idem());
  let incoming = [];
  for (let i = 0; i < 40 && incoming.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 250));
    incoming = (await S.req('GET', '/requests/incoming')).json.requests ?? [];
  }
  const ans = await S.req('POST', `/requests/${incoming[0].id}/respond`, { scope: 'AREA', checkInId: ci.json.checkIn.id, statement: 'REPORTED_OK', expiresIn: '7d', expectedVersion: incoming[0].version }, idem());
  const responseId = ans.json.responseId;
  check('live: requester can read the answer before backup', (await R.req('GET', `/responses/${responseId}`)).status === 200);
  await stop();

  // 2. Backup (isolated copy) taken now.
  adminSql(`CREATE DATABASE "${BACKUP}" TEMPLATE "${LIVE}"`);

  // 3. After the backup: revoke and delete on the live system.
  await start(LIVE, false);
  const S2 = new Agent();
  await S2.req('POST', '/auth/login', { username: `drill.s.${tag}`, password: pw });
  const grantId = (await S2.req('GET', '/me/grants')).json.grants[0].grantId;
  check('live: subject revokes the grant', (await S2.req('POST', `/grants/${grantId}/revoke`)).status === 200);
  const V2 = new Agent();
  await V2.req('POST', '/auth/login', { username: `drill.v.${tag}`, password: pw });
  check('live: victim deletes their account', (await V2.req('DELETE', '/me', { password: pw, confirm: true })).status === 204);
  await stop();

  // 4. Operator exports the ledger (identifiers only).
  const ledgerFile = path.join(workdir, 'ledger.json');
  ops(LIVE, 'ledger-export', '--out', ledgerFile);
  const ledgerText = (await import('node:fs')).readFileSync(ledgerFile, 'utf8');
  check('ledger contains no names or messages', !/Drill|fictional|alias/i.test(ledgerText));

  // 5. Restore: gate the restored copy, prove it serves nothing, then replay.
  ops(BACKUP, 'restore-start');
  await start(BACKUP, false);
  check('restored copy is not ready while gated', (await fetch(`${ORIGIN}/api/health/ready`)).status === 503);
  check('restored copy refuses sign-in while gated', (await new Agent().req('POST', '/auth/login', { username: `drill.r.${tag}`, password: pw })).status === 503);
  await stop();
  ops(BACKUP, 'ledger-replay', '--in', ledgerFile);
  await start(BACKUP, false);
  check('restored copy is ready after replay', (await fetch(`${ORIGIN}/api/health/ready`)).status === 200);
  const R3 = new Agent();
  await R3.req('POST', '/auth/login', { username: `drill.r.${tag}`, password: pw });
  check('revoked answer is not served from the restored copy', (await R3.req('GET', `/responses/${responseId}`)).status === 404);
  check('deleted account cannot sign in on the restored copy', (await new Agent().req('POST', '/auth/login', { username: `drill.v.${tag}`, password: pw })).status === 401);
  check('pre-backup session cookies no longer work', (await R.req('GET', '/me')).status === 401);
  await stop();
  const victim = querySql(BACKUP, `SELECT p."alias", p."purgedAt" IS NOT NULL AS purged, (SELECT count(*) FROM "CheckIn" c WHERE c."personId" = p."id") AS checkins FROM "Person" p JOIN "Account" a ON a."id" = p."accountId" WHERE a."normalizedUsername" = 'drill.v.${tag}'`)[0];
  check('deleted person purged in the restored copy', victim.alias === '' && victim.purged === true && victim.checkins === 0);

  const failed = results.filter((r) => !r.ok);
  mkdirSync('evidence/drills', { recursive: true });
  writeFileSync('evidence/drills/restore-drill.json', JSON.stringify({ ranAt: new Date().toISOString(), databases: 'disposable rf_test_drill_* (dropped afterwards)', results }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} restore-drill checks passed`);
  exitCode = failed.length ? 1 : 0;
} catch (e) {
  console.error(`restore drill failed: ${e instanceof Error ? e.message : e}`);
  exitCode = 1;
} finally {
  await stop();
  for (const name of [BACKUP, LIVE]) {
    try {
      adminSql(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    } catch {
      console.error(`could not drop ${name}`);
    }
  }
  rmSync(workdir, { recursive: true, force: true });
}
process.exit(exitCode);
