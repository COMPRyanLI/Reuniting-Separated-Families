// Screenshots for the user manual (docs/manual/), taken from a local disposable rf_test_manual_*
// database with the fictional fixtures. Secrets (recovery secrets, contact codes, assistance secrets,
// two-step keys) are masked by colour before every capture; capture is refused if a mask fails.
//   npm run build && npm run manual:screenshots
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import * as OTPAuth from 'otpauth';
import { demoSecret } from '../prisma/fixtures.ts';

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://rf_local:rf_local_dev_only@127.0.0.1:55432/postgres';
const DB = `rf_test_manual_${randomBytes(4).toString('hex')}`;
const PORT = Number(process.env.MANUAL_PORT ?? 3850);
const ORIGIN = `http://localhost:${PORT}`;
const OUT = 'docs/manual/img';
const node = process.execPath;
const dbUrl = (() => {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${DB}`;
  return u.toString();
})();
const seedPassword = randomBytes(24).toString('base64');
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
// Blank: Prisma Client would otherwise fill these from a local .env.
for (const k of ['APP_ORIGIN', 'FIELD_ENCRYPTION_KEYS', 'FIELD_ENCRYPTION_ACTIVE_KEY']) env[k] = '';

function adminSql(sql) {
  const script = `import { PrismaClient } from '@prisma/client'; const p = new PrismaClient({ datasourceUrl: process.env.ADMIN_URL }); await p.$executeRawUnsafe(process.env.SQL); await p.$disconnect();`;
  if (spawnSync(node, ['--input-type=module', '-e', script], { env: { ...process.env, ADMIN_URL, SQL: sql }, stdio: 'inherit' }).status !== 0) throw new Error('admin SQL failed');
}

let server = null;
async function startServer() {
  server = spawn(node, ['scripts/start-free.mjs'], { env, stdio: 'ignore' });
  for (let i = 0; i < 300; i++) {
    try {
      if ((await fetch(`${ORIGIN}/api/health/ready`)).ok) return;
    } catch {
      // starting
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not become ready');
}

const MASK = { color: 'transparent', background: '#9a9a9a', 'text-shadow': 'none', '-webkit-text-fill-color': 'transparent' };
const SECRET_LABELS = ['Assistance secret', 'Contact code', 'Recovery secret'];

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForFunction(() => !/Loading/.test(document.querySelector('main')?.innerText ?? ''), null, { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(150);
}

/** Captures `locator` (default: main content) as a JPEG, at most maxHeight CSS px tall, with secrets masked. */
async function shot(page, name, { locator = page.locator('main'), maxHeight = 1000 } = {}) {
  await settle(page);
  const unmasked = await page.evaluate(
    ({ mask, labels }) => {
      const targets = [
        ...document.querySelectorAll('.secret-box'),
        ...[...document.querySelectorAll('p')].filter((el) => el.textContent.includes('otpauth://')),
        ...[...document.querySelectorAll('input')].filter((el) => labels.some((l) => el.labels?.[0]?.textContent?.trim().startsWith(l)) && el.value),
      ];
      for (const el of targets) {
        el.dataset.manualMask = '1';
        for (const [k, v] of Object.entries(mask)) el.style.setProperty(k, v, 'important');
      }
      return targets.filter((el) => getComputedStyle(el).color !== 'rgba(0, 0, 0, 0)').length;
    },
    { mask: MASK, labels: SECRET_LABELS },
  );
  if (unmasked > 0) throw new Error(`refusing to capture ${name}: a secret is not masked`);
  const box = await locator.first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
  });
  await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 82, fullPage: true, clip: { ...box, height: Math.min(box.height, maxHeight) } });
  await page.evaluate((mask) => {
    for (const el of document.querySelectorAll('[data-manual-mask]')) {
      for (const k of Object.keys(mask)) el.style.removeProperty(k);
      delete el.dataset.manualMask;
    }
  }, MASK);
  console.log(`shot  ${name}`);
}

async function reloadUntil(page, locator, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await page.waitForLoadState('networkidle').catch(() => {});
    if (await locator.first().isVisible()) return;
    if (Date.now() > deadline) throw new Error('expected content did not appear');
    await page.waitForTimeout(1000);
    await page.reload();
  }
}

let browser;
async function newPage() {
  const context = await browser.newContext({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 1.5 });
  return context.newPage();
}
async function signUp(page, username, alias) {
  await page.goto(`${ORIGIN}/signup`);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(`${username} manual passphrase`);
  await page.getByLabel('Name others will see').fill(alias);
}
async function signIn(page, username) {
  await page.goto(`${ORIGIN}/signin`);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(seedPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Sign out' }).waitFor();
}
/** First staff sign-in: two-step setup with a code computed from the setup key. */
async function signInStaff(page, username, shotName) {
  await signIn(page, username);
  await page.getByLabel('Confirm your password').fill(seedPassword);
  await page.getByRole('button', { name: 'Start setup' }).click();
  const key = ((await page.getByLabel(/Setup key/).textContent()) ?? '').trim();
  if (shotName) await shot(page, shotName);
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(key), digits: 6, period: 30, algorithm: 'SHA1' });
  await page.getByLabel('6-digit code').fill(totp.generate());
  await page.getByRole('button', { name: 'Verify' }).click();
  await page.getByRole('button', { name: 'I saved them, continue' }).click();
  await page.getByRole('heading', { name: 'Staff work' }).waitFor();
}

let exitCode = 1;
try {
  mkdirSync(OUT, { recursive: true });
  adminSql(`CREATE DATABASE "${DB}"`);
  await startServer();
  browser = await chromium.launch();

  // People with a phone or computer: Alex answers, Jordan asks.
  const alex = await newPage();
  await alex.goto(`${ORIGIN}/`);
  await signUp(alex, 'alex.example', 'Alex Example');
  await alex.getByRole('button', { name: 'Create account' }).click();
  await alex.getByRole('heading', { name: 'Save your recovery secret' }).waitFor();
  await shot(alex, 'p03-recovery-secret');
  await alex.getByLabel('I have written down my recovery secret').check();
  await alex.getByRole('button', { name: 'Continue' }).click();
  await shot(alex, 'p04-dashboard');
  await alex.goto(`${ORIGIN}/check-ins`);
  await alex.getByRole('button', { name: 'Add a check-in' }).click();
  await alex.waitForFunction(() => !document.querySelector('select[aria-busy="true"]'));
  await alex.getByLabel('Shelter', { exact: true }).selectOption({ label: 'Hillcrest School Gym (Hillcrest)' });
  await alex.getByLabel('Status at that time (optional)').selectOption({ index: 1 });
  await shot(alex, 'p05-checkin-form', { locator: alex.locator('main form').first() });
  await alex.getByRole('button', { name: 'Save check-in' }).click();
  await alex.getByRole('article').first().waitFor();
  await alex.goto(`${ORIGIN}/privacy`);
  await shot(alex, 'p07-privacy', { maxHeight: 820 });
  await alex.getByRole('button', { name: /Create contact code|Replace contact code/ }).click();
  const code = ((await alex.getByLabel('Your contact code (shown once)').textContent()) ?? '').trim();
  await alex.getByRole('button', { name: 'I noted it, hide it' }).click();

  const jordan = await newPage();
  await signUp(jordan, 'jordan.example', 'Jordan Example');
  await jordan.getByRole('button', { name: 'Create account' }).click();
  await jordan.getByLabel('I have written down my recovery secret').check();
  await jordan.getByRole('button', { name: 'Continue' }).click();
  await jordan.goto(`${ORIGIN}/requests/new`);
  await jordan.getByLabel('Without a code: ask one shelter’s team to help').check();
  await jordan.getByLabel('Clues for the shelter team (optional)').fill('My cousin Alex, red jacket, from the north side.');
  await jordan.getByLabel('Shelter they might be at (optional)').selectOption({ label: 'Hillcrest School Gym' });
  await jordan.getByLabel(/I agree that the clues may be shared/).check();
  await jordan.getByLabel('Introduction').fill('Hi Alex, it is Jordan, your cousin. I am safe at Riverside.');
  await shot(jordan, 'p10-request-no-code');
  await jordan.getByLabel('With their contact code').check();
  await jordan.getByLabel('Contact code', { exact: true }).fill(code);
  await shot(jordan, 'p09-request-code');
  await jordan.getByRole('button', { name: 'Send private request' }).click();
  await jordan.getByRole('heading', { name: 'Request saved' }).waitFor();

  await alex.goto(`${ORIGIN}/requests/incoming`);
  await reloadUntil(alex, alex.getByText('I am safe at Riverside'));
  await shot(alex, 'p12-incoming', { locator: alex.getByRole('article').first() });
  await alex.getByRole('button', { name: 'Answer' }).first().click();
  await alex.getByLabel('Message and the approximate area of one check-in').check();
  await alex.getByLabel('Which check-in').selectOption({ index: 1 });
  await alex.getByLabel('24 hours').check();
  await shot(alex, 'p13-answer-choices', { locator: alex.getByRole('group', { name: 'What to share' }) });
  await shot(alex, 'p14-answer-preview', { locator: alex.getByRole('region', { name: /Exactly what/ }) });
  await alex.getByRole('button', { name: 'Review and share' }).click();
  await alex.getByRole('button', { name: /Confirm: share with/ }).click();
  await alex.getByText('Answered', { exact: true }).first().waitFor();

  await jordan.goto(`${ORIGIN}/requests/outgoing`);
  await reloadUntil(jordan, jordan.getByText('Response available', { exact: true }));
  await shot(jordan, 'p15-outgoing', { maxHeight: 700 });
  await jordan.getByRole('link', { name: 'View response' }).first().click();
  await jordan.getByRole('heading', { name: /Answer from/ }).waitFor();
  await shot(jordan, 'p16-response-view');

  await alex.goto(`${ORIGIN}/sharing`);
  await shot(alex, 'p17-sharing');
  await alex.goto(`${ORIGIN}/account`);
  await alex.getByRole('button', { name: 'Delete my account' }).click();
  await shot(alex, 'p18-delete-account', { locator: alex.getByRole('region', { name: 'Delete your account and information' }) });
  await alex.getByRole('button', { name: 'Sign out' }).click();
  await alex.getByRole('heading', { name: 'You have signed out' }).waitFor();
  await alex.goto(`${ORIGIN}/recover`);

  // Shelter staff: worker A (intake, verification, request on behalf), coordinator B, worker B.
  const wa = await newPage();
  await signInStaff(wa, 'worker.a', 's01-two-step-setup');
  await shot(wa, 's02-staff-home', { maxHeight: 900 });
  await wa.goto(`${ORIGIN}/staff/intake`);
  await wa.getByLabel('Name the person wants to use').fill('Rosa Example');
  await wa.getByLabel('Create a contact code the person can give to family').check();
  await wa.getByLabel('The person agreed to this intake after I explained what is recorded').check();
  await wa.getByRole('button', { name: 'Save intake' }).click();
  await wa.getByRole('heading', { name: 'Intake saved' }).waitFor();
  await shot(wa, 's04-intake-saved', { maxHeight: 1400 });
  await wa.goto(`${ORIGIN}/staff`);
  await wa.getByRole('link', { name: /^Sam/ }).click();
  await wa.getByLabel('Assistance secret').waitFor();
  await wa.getByLabel('Assistance secret').fill(demoSecret(seedSecret, 'assist:sam'));
  await shot(wa, 's05-verify-visit', { maxHeight: 800 });
  await wa.getByRole('button', { name: 'Verify', exact: true }).click();
  await wa.getByRole('heading', { name: 'Verified for this visit', exact: true }).waitFor();
  await shot(wa, 's06-case-workspace', { maxHeight: 760 });
  await wa.getByRole('button', { name: 'Send a request for Sam' }).click();
  await wa.getByLabel('Without a code: ask one shelter’s team to help').check();
  await wa.getByLabel('Clues for the shelter team (optional)').fill('Sister Ana, grey cap, speaks Spanish.');
  await wa.getByLabel('Shelter they might be at (optional)').selectOption({ label: 'Hillcrest School Gym' });
  await wa.getByLabel(/The person agrees that the clues may be shared/).check();
  await wa.getByLabel('Introduction').fill('Sam is at Riverside and asked us to look for his sister Ana.');
  await shot(wa, 's07-request-for-person', { locator: wa.locator('main form').filter({ has: wa.getByLabel('Introduction') }), maxHeight: 1400 });
  await wa.getByRole('button', { name: 'Send private request' }).click();
  await wa.getByText('look for his sister Ana').first().waitFor();

  const cb = await newPage();
  await signInStaff(cb, 'coord.b');
  const task = cb.getByRole('listitem').filter({ hasText: 'Sister Ana' });
  await task.getByLabel('Worker').selectOption({ label: 'worker.b' });
  await shot(cb, 's08-coordinator-assign', { locator: task });
  await task.getByRole('button', { name: 'Assign matching task' }).click();
  await cb.getByText('Assigned to worker.b').waitFor();

  const wb = await newPage();
  await signInStaff(wb, 'worker.b');
  await reloadUntil(wb, wb.getByRole('link', { name: 'Open matching task' }));
  await wb.getByRole('link', { name: 'Open matching task' }).first().click();
  await wb.getByRole('button', { name: 'Propose Ana' }).waitFor();
  await shot(wb, 's09-matching-task', { maxHeight: 1000 });
  await wb.getByRole('button', { name: 'Propose Ana' }).click();
  await wb.getByRole('button', { name: 'Confirm: deliver request to Ana' }).click();
  await wb.getByRole('heading', { name: 'Staff work' }).waitFor();
  await wb.getByRole('link', { name: /^Ana/ }).click();
  await wb.getByLabel('Assistance secret').fill(demoSecret(seedSecret, 'assist:ana'));
  await wb.getByRole('button', { name: 'Verify', exact: true }).click();
  await reloadUntil(wb, wb.getByRole('article').filter({ hasText: 'look for his sister Ana' }));
  await shot(wb, 's10-request-for-person-decide', { locator: wb.getByRole('article').filter({ hasText: 'look for his sister Ana' }) });
  console.log('\nall manual screenshots captured');
  exitCode = 0;
} catch (e) {
  console.error(`manual screenshots failed: ${e instanceof Error ? e.message : e}`);
} finally {
  await browser?.close();
  server?.kill();
  await new Promise((r) => setTimeout(r, 800));
  try {
    adminSql(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
  } catch {
    console.error(`could not drop ${DB}`);
  }
}
process.exit(exitCode);
