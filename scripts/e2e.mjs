// Runs Playwright against the real production build, a real disposable PostgreSQL
// database (rf_test_e2e_*), the API server and the outbox worker.
//   npm run test:e2e            all browser specs except accessibility
//   npm run test:a11y           accessibility specs only
// Extra arguments after `--` are passed to Playwright.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const a11y = args.includes('--a11y');
const skipBuild = args.includes('--no-build');
const passThrough = args.filter((a) => !['--a11y', '--no-build'].includes(a));

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://rf_local:rf_local_dev_only@127.0.0.1:55432/postgres';
const dbName = `rf_test_e2e_${randomBytes(4).toString('hex')}`;
const dbUrl = (() => {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
})();
const port = Number(process.env.E2E_PORT ?? 3100);
// Per-run file for staff TOTP enrollment state shared across Playwright worker restarts.
const stateFile = path.join(tmpdir(), `rf-e2e-state-${randomBytes(4).toString('hex')}.json`);
const origin = `http://localhost:${port}`;
const node = process.execPath;
const tsxCli = path.resolve('node_modules/tsx/dist/cli.mjs');
const prismaCli = path.resolve('node_modules/prisma/build/index.js');
const playwrightCli = path.resolve('node_modules/@playwright/test/cli.js');

// Unique per-run sentinel secrets: the asset scan asserts none of them reach the browser.
const sentinel = (label) => Buffer.from(`E2E_SENTINEL_${label}_${randomBytes(8).toString('hex')}`.padEnd(32, 'x')).toString('base64');
const env = {
  ...process.env,
  NODE_ENV: 'test',
  PORT: String(port),
  APP_ORIGIN: origin,
  DATABASE_URL: dbUrl,
  DIGEST_KEY: sentinel('DIGEST'),
  FIELD_ENCRYPTION_KEYS: `v1:${Buffer.from(randomBytes(32)).toString('base64')}`,
  FIELD_ENCRYPTION_ACTIVE_KEY: 'v1',
  DEMO_MODE: 'true',
  INCIDENT_SLUG: 'demo-hurricane-1',
  WORKER_POLL_MS: '300',
  RATE_LIMIT_LOGIN_IP: '100000',
  RATE_LIMIT_REGISTER_IP: '100000',
  SEED_PASSWORD: 'e2e-only-seed-password-1',
  SEED_SECRET: `e2e-only-seed-secret-${randomBytes(6).toString('hex')}`,
};

function run(cmd, cmdArgs, extraEnv = {}) {
  const r = spawnSync(cmd, cmdArgs, { env: { ...env, ...extraEnv }, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${path.basename(cmdArgs[0] ?? cmd)} exited with ${r.status}`);
}

function adminSql(sql) {
  const script = `import { PrismaClient } from '@prisma/client'; const p = new PrismaClient({ datasourceUrl: process.env.ADMIN_URL }); await p.$executeRawUnsafe(process.env.SQL); await p.$disconnect();`;
  const r = spawnSync(node, ['--input-type=module', '-e', script], { env: { ...process.env, ADMIN_URL, SQL: sql }, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('admin SQL failed');
}

const children = [];
async function waitForReady() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`${origin}/api/health/ready`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not become ready');
}

let exitCode;
try {
  if (!skipBuild || !existsSync('apps/web/dist/index.html') || !existsSync('apps/api/dist/server.js')) {
    const npmCli = process.env.npm_execpath;
    if (!npmCli) throw new Error('run this through npm (npm run test:e2e) so the build can run');
    // Build with the caller's environment (production mode), not the test server environment.
    const b = spawnSync(node, [npmCli, 'run', 'build'], { env: process.env, stdio: 'inherit' });
    if (b.status !== 0) throw new Error('build failed');
  }
  if (!/^rf_test_[a-z0-9_]+$/.test(dbName)) throw new Error('unsafe database name');
  adminSql(`CREATE DATABASE "${dbName}"`);
  run(node, [prismaCli, 'migrate', 'deploy']);
  run(node, [tsxCli, 'prisma/seed.ts']);

  for (const entry of ['apps/api/dist/server.js', 'apps/api/dist/worker.js']) {
    const child = spawn(node, [entry], { env, stdio: ['ignore', 'ignore', 'inherit'] });
    children.push(child);
  }
  await waitForReady();

  const pwArgs = [playwrightCli, 'test', ...(a11y ? ['tests/e2e/a11y.spec.ts'] : ['--grep-invert', '@a11y']), ...passThrough];
  const pw = spawnSync(node, pwArgs, {
    env: { ...env, E2E_STATE_FILE: stateFile, E2E_BASE_URL: origin, E2E_SENTINELS: [env.DIGEST_KEY, env.FIELD_ENCRYPTION_KEYS.slice(3), env.SEED_SECRET].join(',') },
    stdio: 'inherit',
  });
  exitCode = pw.status ?? 1;
} catch (e) {
  console.error(`e2e runner failed: ${e instanceof Error ? e.message : e}`);
  exitCode = 1;
} finally {
  for (const c of children) c.kill();
  rmSync(stateFile, { force: true });
  await new Promise((r) => setTimeout(r, 500));
  try {
    adminSql(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  } catch {
    console.error(`could not drop ${dbName}`);
  }
}
process.exit(exitCode);
