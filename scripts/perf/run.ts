/**
 * PERF-01..03 benchmark. Builds a disposable rf_test_perf_* database with the synthetic
 * dataset, serves the real app + worker, runs the measured load and writes aggregate
 * results (no payloads, no credentials) to evidence/performance/. Exits 1 if a gate fails.
 *   npm run build && npm run test:performance
 * --single-process: instead of serving inside this process, start the free-hosting command
 * (scripts/start-free.mjs: production bundle, outbox worker in the web process) as a child.
 *   npm run build && npm run test:performance -- --single-process
 */
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { chromium } from '@playwright/test';
import { createApp } from '../../apps/api/src/app.js';
import { loadConfig } from '../../apps/api/src/config.js';
import { systemClock } from '../../apps/api/src/lib/clock.js';
import { createCrypto } from '../../apps/api/src/lib/crypto.js';
import { createLogger } from '../../apps/api/src/lib/logger.js';
import { createSession, csrfTokenFor } from '../../apps/api/src/auth/session.js';
import { runWorkerLoop } from '../../apps/api/src/jobs/loop.js';
import { seedFixtures } from '../../prisma/fixtures.js';
import { createDatabase, databaseUrl, dropDatabase, migrate, randomDbName } from '../../tests/support/db.js';
import { buildDataset, PERF_PASSWORD, type Dataset } from './dataset.js';

const WARMUP_MS = Number(process.env.PERF_WARMUP_MS ?? 30_000);
const MEASURE_MS = Number(process.env.PERF_MEASURE_MS ?? 60_000);
const CLIENTS = 20;
const PORT = Number(process.env.PERF_PORT ?? 3200);
const ORIGIN = `http://localhost:${PORT}`;
const SINGLE_PROCESS = process.argv.includes('--single-process');
const RATE_LIMITS = { RATE_LIMIT_LOGIN_IP: '1000000', RATE_LIMIT_REQUESTS_PER_HOUR: '1000000', RATE_LIMIT_REGISTER_IP: '1000000' };

async function waitReady(origin: string, attempts: number, intervalMs: number): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      if ((await fetch(`${origin}/api/health/ready`)).ok) return true;
    } catch {
      // not yet
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

interface Sample {
  route: string;
  status: number;
  ms: number;
  unauthorizedPayload?: boolean;
}

const pct = (xs: number[], p: number) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
};
const round = (n: number) => Math.round(n * 10) / 10;

async function main() {
  const started = Date.now();
  const dbName = randomDbName('rf_test_perf');
  await createDatabase(dbName);
  const url = databaseUrl(dbName);
  const key = () => randomBytes(32).toString('base64');
  // The single-process child must share these keys: sessions and CSRF tokens are created here.
  const digestKey = key();
  const encryptionKey = key();
  const config = loadConfig({
    NODE_ENV: 'test',
    APP_ORIGIN: ORIGIN,
    DATABASE_URL: url,
    DIGEST_KEY: digestKey,
    FIELD_ENCRYPTION_KEYS: `v1:${encryptionKey}`,
    FIELD_ENCRYPTION_ACTIVE_KEY: 'v1',
    WORKER_POLL_MS: '1000',
    ...RATE_LIMITS,
    WEB_DIST_DIR: path.resolve('apps/web/dist'),
  });
  // Render-style environment for scripts/start-free.mjs. Blank values stop Prisma Client from
  // filling them from a local .env; the app treats blank as unset.
  const freeStartEnv = (port: number) => ({
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(port),
    RENDER_EXTERNAL_URL: `http://localhost:${port}`,
    APP_ORIGIN: '',
    DATABASE_URL: url,
    DIGEST_KEY: digestKey,
    FIELD_ENCRYPTION_KEY: encryptionKey,
    FIELD_ENCRYPTION_KEYS: '',
    FIELD_ENCRYPTION_ACTIVE_KEY: '',
    RUN_WORKER_IN_PROCESS: 'true',
    WORKER_POLL_MS: '1000',
    DEMO_MODE: 'true',
    SEED_ON_START: 'yes',
    SEED_CONFIRM_FICTIONAL: 'yes',
    SEED_PASSWORD: PERF_PASSWORD,
    SEED_SECRET: 'perf-seed-secret-not-secret',
    ...RATE_LIMITS,
  });
  const prisma = new PrismaClient({ datasourceUrl: url });
  const crypto = createCrypto(config);
  const deps = { config, prisma, clock: systemClock, crypto, logger: createLogger(() => {}) };
  const abort = new AbortController();
  let server: ReturnType<ReturnType<typeof createApp>['listen']> | undefined;
  let child: ReturnType<typeof spawn> | undefined;
  let exitCode: number;
  try {
    console.log('migrating and seeding synthetic dataset...');
    migrate(dbName);
    await seedFixtures(prisma, { now: new Date(), seedPassword: PERF_PASSWORD, seedSecret: 'perf-seed-secret-not-secret', crypto });
    const t0 = Date.now();
    const ds = await buildDataset(prisma, crypto, new Date());
    const datasetSeconds = (Date.now() - t0) / 1000;
    await prisma.$executeRawUnsafe('ANALYZE');
    const counts = {
      persons: await prisma.person.count(),
      shelters: await prisma.shelter.count(),
      checkIns: await prisma.checkIn.count(),
      requests: await prisma.reunionRequest.count(),
      grants: await prisma.sharingGrant.count(),
      cases: await prisma.assistanceCase.count(),
    };
    console.log(`dataset ready in ${datasetSeconds}s: ${JSON.stringify(counts)}`);

    let worker: Promise<void> = Promise.resolve();
    if (SINGLE_PROCESS) {
      child = spawn(process.execPath, ['scripts/start-free.mjs'], { env: freeStartEnv(PORT), stdio: 'ignore' });
      if (!(await waitReady(ORIGIN, 600, 100))) throw new Error('single-process start did not become ready');
    } else {
      server = createApp(deps).listen(PORT);
      worker = runWorkerLoop(deps, abort.signal);
    }

    // Real server-side sessions for benchmark people and MFA-verified staff.
    const people: { accountId: string; personId: string; username: string; credentialVersion: number; cookie: string; csrf: string }[] = [];
    for (const a of ds.benchAccounts) {
      const s = await createSession(deps, prisma, { id: a.accountId, credentialVersion: a.credentialVersion }, 'INDIVIDUAL');
      people.push({ ...a, cookie: `rf_session=${s.token}`, csrf: csrfTokenFor(deps, s.sessionId) });
    }
    const staff: { cookie: string; csrf: string }[] = [];
    for (const st of ds.staffAccounts.slice(0, 20)) {
      await prisma.staffMfa.create({ data: { accountId: st.accountId, encryptedTotpSecret: crypto.encrypt('JBSWY3DPEHPK3PXP', 'staff.totp', st.accountId), createdAt: new Date(), enrolledAt: new Date() } });
      const s = await createSession(deps, prisma, { id: st.accountId, credentialVersion: 1 }, 'STAFF', new Date());
      staff.push({ cookie: `rf_session=${s.token}`, csrf: csrfTokenFor(deps, s.sessionId) });
    }

    const createdRequests: string[] = [];
    const samples: Sample[] = [];
    const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]!;
    const grantsByViewer = ds.activeGrants;

    async function call(route: string, method: string, pathName: string, who: { cookie: string; csrf: string }, body?: unknown, extra: Record<string, string> = {}) {
      const t = performance.now();
      let status: number;
      let text = '';
      try {
        const res = await fetch(`${ORIGIN}/api/v1${pathName}`, {
          method,
          headers: { Cookie: who.cookie, Origin: ORIGIN, 'X-CSRF-Token': who.csrf, 'Content-Type': 'application/json', ...extra },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        status = res.status;
        text = await res.text();
      } catch {
        status = 0;
      }
      return { status, text, ms: performance.now() - t, route };
    }

    async function oneOp(record: boolean) {
      const me = pick(people);
      const r = Math.random();
      let result;
      if (r < 0.2) result = await call('GET /requests/outgoing', 'GET', '/requests/outgoing', me);
      else if (r < 0.35) result = await call('GET /requests/incoming', 'GET', '/requests/incoming', me);
      else if (r < 0.45) result = await call('GET /me/check-ins', 'GET', '/me/check-ins', me);
      else if (r < 0.6 && grantsByViewer.length) {
        const g = pick(grantsByViewer);
        const viewer = people.find((p) => p.personId === g.viewerPersonId)!;
        result = await call('GET /responses/:id (authorized)', 'GET', `/responses/${g.responseId}`, viewer);
      } else if (r < 0.7 && grantsByViewer.length) {
        const g = pick(grantsByViewer);
        const other = people.find((p) => p.personId !== g.viewerPersonId)!;
        result = await call('GET /responses/:id (denied)', 'GET', `/responses/${g.responseId}`, other);
        // A denial must be exactly the neutral 404 envelope: nothing else in the body.
        let leaked = result.status !== 404;
        try {
          const body = JSON.parse(result.text) as Record<string, unknown>;
          leaked ||= Object.keys(body).join() !== 'error' || (body.error as { code?: string }).code !== 'NOT_FOUND';
        } catch {
          leaked = true;
        }
        if (record) samples.push({ route: result.route, status: result.status, ms: result.ms, unauthorizedPayload: leaked });
        return;
      } else if (r < 0.75) result = await call('GET /staff/tasks', 'GET', '/staff/tasks', pick(staff));
      else if (r < 0.85) result = await call('GET /notifications (poll)', 'GET', '/notifications', me, undefined, { 'X-Background-Refresh': '1' });
      else if (r < 0.93) {
        result = await call('POST /me/check-ins', 'POST', '/me/check-ins', me, { shelterId: pick(ds.shelterIds), observedAt: new Date().toISOString() }, { 'Idempotency-Key': randomUUID() });
      } else {
        result = await call('POST /requests', 'POST', '/requests', me, { routeType: 'CODE', contactCode: pick(ds.contactCodes), introduction: 'Benchmark request' }, { 'Idempotency-Key': randomUUID() });
        if (record && result.status === 202) createdRequests.push(JSON.parse(result.text).requestId);
      }
      if (record) samples.push({ route: result.route, status: result.status, ms: result.ms });
    }

    async function load(ms: number, record: boolean) {
      const deadline = Date.now() + ms;
      await Promise.all(
        Array.from({ length: CLIENTS }, async () => {
          while (Date.now() < deadline) await oneOp(record);
        }),
      );
    }

    console.log(`warm-up ${WARMUP_MS / 1000}s...`);
    await load(WARMUP_MS, false);
    console.log(`measuring ${MEASURE_MS / 1000}s with ${CLIENTS} concurrent clients...`);
    const measureStart = Date.now();
    await load(MEASURE_MS, true);
    const measureSeconds = (Date.now() - measureStart) / 1000;

    // PERF-02: committed request to generic notification, measured from database timestamps.
    await new Promise((r) => setTimeout(r, 8_000));
    const delivered = await prisma.$queryRaw<{ ms: number }[]>`
      SELECT EXTRACT(EPOCH FROM (n."createdAt" - r."submittedAt")) * 1000 AS ms
      FROM "ReunionRequest" r JOIN "Notification" n ON n."resourceId" = r."id"::text AND n."kind" = 'REQUEST_RECEIVED'
      WHERE r."id" = ANY(${createdRequests}::uuid[])`;
    const undeliverable = await prisma.reunionRequest.count({ where: { id: { in: createdRequests }, internalState: 'UNRESOLVED' } });
    const pending = await prisma.reunionRequest.count({ where: { id: { in: createdRequests }, internalState: 'SUBMITTED' } });
    const duplicates = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM (SELECT "eventKey", "recipientAccountId", "assistedCaseId" FROM "Notification"
        GROUP BY "eventKey", "recipientAccountId", "assistedCaseId" HAVING count(*) > 1) d`;

    // Login sample, separate from read/write metrics (Argon2id cost).
    const loginMs: number[] = [];
    const loginUsers = ds.benchAccounts.slice(0, 100);
    for (let i = 0; i < loginUsers.length; i += 4) {
      await Promise.all(
        loginUsers.slice(i, i + 4).map(async (u) => {
          const t = performance.now();
          const res = await fetch(`${ORIGIN}/api/v1/auth/login`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u.username, password: PERF_PASSWORD }) });
          await res.text();
          if (res.status === 200) loginMs.push(performance.now() - t);
        }),
      );
    }

    // PERF-03: initial-route JS size and mobile LCP (5 runs, 390x844, 4x CPU, 1.6/0.75 Mbps, 150 ms).
    const html = readFileSync('apps/web/dist/index.html', 'utf8');
    const jsFiles = [...html.matchAll(/src="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]!);
    const jsGzipKiB = jsFiles.reduce((sum, f) => sum + gzipSync(readFileSync(path.join('apps/web/dist', f))).length, 0) / 1024;
    const externalRequests: string[] = [];
    const lcps: number[] = [];
    const browser = await chromium.launch();
    for (let i = 0; i < 5; i++) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      page.on('request', (req) => {
        if (!req.url().startsWith(ORIGIN)) externalRequests.push(new URL(req.url()).host);
      });
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await page.goto(ORIGIN + '/', { waitUntil: 'load' });
      await page.waitForTimeout(1500);
      const lcp = await page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            new PerformanceObserver((list) => {
              const entries = list.getEntries();
              resolve(entries[entries.length - 1]!.startTime);
            }).observe({ type: 'largest-contentful-paint', buffered: true });
            setTimeout(() => resolve(-1), 3000);
          }),
      );
      lcps.push(lcp);
      await context.close();
    }
    await browser.close();

    abort.abort();
    await worker;
    server?.close();
    server = undefined;
    child?.kill();
    child = undefined;

    // Cold start against the same database until ready: the production server bundle, or in
    // single-process mode the whole free-hosting start (migrate check, seed check, web + worker).
    let coldStartMs: number | null = null;
    if (existsSync('apps/api/dist/server.js')) {
      const coldPort = PORT + 1;
      const t = Date.now();
      const cold = SINGLE_PROCESS
        ? spawn(process.execPath, ['scripts/start-free.mjs'], { env: freeStartEnv(coldPort), stdio: 'ignore' })
        : spawn(process.execPath, ['apps/api/dist/server.js'], {
            env: { ...process.env, NODE_ENV: 'test', PORT: String(coldPort), APP_ORIGIN: `http://localhost:${coldPort}`, DATABASE_URL: url, DIGEST_KEY: key(), FIELD_ENCRYPTION_KEYS: `v1:${key()}`, FIELD_ENCRYPTION_ACTIVE_KEY: 'v1' },
            stdio: 'ignore',
          });
      if (await waitReady(`http://localhost:${coldPort}`, SINGLE_PROCESS ? 600 : 200, 50)) coldStartMs = Date.now() - t;
      cold.kill();
    }

    // Aggregate and gate.
    const byRoute: Record<string, { count: number; p50: number; p95: number; errors5xx: number }> = {};
    for (const s of samples) {
      const r = (byRoute[s.route] ??= { count: 0, p50: 0, p95: 0, errors5xx: 0 });
      r.count++;
      if (s.status === 0 || s.status >= 500) r.errors5xx++;
    }
    for (const route of Object.keys(byRoute)) {
      const ms = samples.filter((s) => s.route === route).map((s) => s.ms);
      byRoute[route]!.p50 = round(pct(ms, 50));
      byRoute[route]!.p95 = round(pct(ms, 95));
    }
    const all = samples.map((s) => s.ms);
    const errors = samples.filter((s) => s.status === 0 || s.status >= 500).length;
    const unexpected4xx = samples.filter((s) => s.status >= 400 && s.status < 500 && !s.route.includes('denied')).length;
    const unauthorizedPayloads = samples.filter((s) => s.unauthorizedPayload).length;
    const deliveryMs = delivered.map((d) => Number(d.ms));
    const pgVersion = (await prisma.$queryRaw<{ v: string }[]>`SELECT version() AS v`)[0]!.v;
    const sortedLcp = [...lcps].sort((a, b) => a - b);
    const result = {
      measuredAt: new Date().toISOString(),
      environment: {
        os: `${os.type()} ${os.release()} ${os.arch()}`,
        cpu: os.cpus()[0]?.model ?? 'unknown',
        logicalCpus: os.cpus().length,
        ramGiB: round(os.totalmem() / 1024 ** 3),
        node: process.version,
        postgres: pgVersion.split(',')[0],
        database: 'local Docker container on the same machine (not remote)',
        appMode: SINGLE_PROCESS
          ? 'single-process free-hosting start (scripts/start-free.mjs, production bundle, worker in the web process) as a child process; NODE_ENV=test over http://localhost, rate limits raised for throughput measurement'
          : 'in-process API + worker, NODE_ENV=test over http://localhost, rate limits raised for throughput measurement',
        hosted: 'not measured: local results on this machine, not the Render free tier (0.1 CPU, 512 MB)',
      },
      dataset: { ...counts, seconds: datasetSeconds },
      perf01: {
        clients: CLIENTS,
        warmupSeconds: WARMUP_MS / 1000,
        measureSeconds: round(measureSeconds),
        operations: samples.length,
        p50Ms: round(pct(all, 50)),
        p95Ms: round(pct(all, 95)),
        errorRatePct: round((errors / Math.max(1, samples.length)) * 100),
        unexpected4xx,
        unauthorizedPayloads,
        byRoute,
      },
      perf02: {
        requestsCreated: createdRequests.length,
        delivered: deliveryMs.length,
        unresolvedByDesign: undeliverable,
        stillPending: pending,
        deliveryP50Ms: round(pct(deliveryMs, 50)),
        deliveryP95Ms: round(pct(deliveryMs, 95)),
        worstCaseBrowserSeesUpdateMs: round(pct(deliveryMs, 95) + 15_000),
        duplicateNotifications: Number(duplicates[0]!.n),
        loginSample: loginMs.length,
        loginP50Ms: round(pct(loginMs, 50)),
        loginP95Ms: round(pct(loginMs, 95)),
      },
      perf03: {
        initialJsGzipKiB: round(jsGzipKiB),
        lcpRunsMs: lcps.map(round),
        lcpMedianMs: round(sortedLcp[2]!),
        externalRequestHosts: [...new Set(externalRequests)],
        coldStartToReadyMs: coldStartMs,
      },
      totalSeconds: (Date.now() - started) / 1000,
    };
    const gates = {
      'PERF-01 p95 < 500 ms': result.perf01.p95Ms < 500,
      'PERF-01 5xx/network errors < 1%': result.perf01.errorRatePct < 1,
      'PERF-01 zero unauthorized payloads': unauthorizedPayloads === 0,
      'PERF-01 >= 1000 operations': samples.length >= 1000,
      'PERF-02 delivery p95 <= 5 s': result.perf02.deliveryP95Ms <= 5000,
      'PERF-02 browser update <= 20 s': result.perf02.worstCaseBrowserSeesUpdateMs <= 20_000,
      'PERF-02 no duplicate delivery': result.perf02.duplicateNotifications === 0,
      'PERF-02 login p95 <= 1500 ms': result.perf02.loginP95Ms <= 1500,
      'PERF-03 initial JS <= 250 KiB gzip': result.perf03.initialJsGzipKiB <= 250,
      'PERF-03 median LCP <= 2.5 s': result.perf03.lcpMedianMs > 0 && result.perf03.lcpMedianMs <= 2500,
      'PERF-03 no external hosts': result.perf03.externalRequestHosts.length === 0,
    };
    const report = { ...result, gates };
    mkdirSync('evidence/performance', { recursive: true });
    writeFileSync(`evidence/performance/${SINGLE_PROCESS ? 'perf-summary-single-process.json' : 'perf-summary.json'}`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    const failed = Object.entries(gates).filter(([, ok]) => !ok);
    exitCode = failed.length ? 1 : 0;
    if (failed.length) console.error(`FAILED gates: ${failed.map(([k]) => k).join('; ')}`);
    void ({} as Dataset);
  } finally {
    abort.abort();
    server?.close();
    child?.kill();
    await prisma.$disconnect();
    await dropDatabase(dbName);
  }
  process.exit(exitCode);
}

void main().catch((e: unknown) => {
  console.error(`performance run failed: ${e instanceof Error ? e.stack : e}`);
  process.exit(1);
});
