// 200% browser-zoom audit (WCAG 1.4.4 resize text, 1.4.10 reflow) on a disposable rf_test_zoom_*
// database with fictional fixtures. Chromium's own page zoom (the zoom Ctrl+Plus sets) is applied
// through chrome.tabs.setZoom from a throwaway local helper extension in a throwaway profile: no
// viewport emulation and no CSS zoom. Checks public, signed-in and staff pages, forms with
// validation errors and confirmation dialogs, then restores 100%. Writes measurements and
// screenshots (secrets masked) to evidence/zoom-200/.
//   npm run build && npm run audit:zoom
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import * as OTPAuth from 'otpauth';
import { demoSecret } from '../prisma/fixtures.ts';

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://rf_local:rf_local_dev_only@127.0.0.1:55432/postgres';
const DB = `rf_test_zoom_${randomBytes(4).toString('hex')}`;
const PORT = Number(process.env.ZOOM_AUDIT_PORT ?? 3800);
const ORIGIN = `http://localhost:${PORT}`;
const WINDOW = { width: 1280, height: 800 };
const ZOOM = 2;
const DIR = 'evidence/zoom-200';
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

/** Measurements taken in the page at the current zoom. Heuristics; screenshots are reviewed by a person. */
function measure() {
  const vw = document.documentElement.clientWidth;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const name = (el) => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('name') || el.id || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 60);
  const controls = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex]:not([tabindex="-1"])')]
    .filter(visible)
    .filter((el) => !el.classList.contains('skip-link'));
  const offscreen = controls.filter((el) => {
    const r = el.getBoundingClientRect();
    return r.right > vw + 1 || r.left < -1;
  }).map(name);
  const hides = (v) => v === 'hidden' || v === 'clip';
  const clipped = [...document.querySelectorAll('body *')]
    .filter(visible)
    .filter((el) => {
      const cs = getComputedStyle(el);
      return (hides(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) || (hides(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) || (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1);
    })
    .map(name);
  const overlaps = [];
  for (let i = 0; i < controls.length; i++) {
    for (let j = i + 1; j < controls.length; j++) {
      const a = controls[i];
      const b = controls[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w > 2 && h > 2) overlaps.push(`${name(a)} | ${name(b)}`);
    }
  }
  // Something else on top of a control's centre once it is scrolled into view.
  const covered = [];
  const [x0, y0] = [scrollX, scrollY];
  for (const el of controls) {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const ownLabel = hit?.closest?.('label')?.control === el;
    if (hit && hit !== el && !el.contains(hit) && !hit.contains(el) && !ownLabel) covered.push(name(el));
  }
  scrollTo(x0, y0);
  const stickyOrFixed = [...document.querySelectorAll('body *')].filter((el) => ['sticky', 'fixed'].includes(getComputedStyle(el).position)).map(name);
  // Deepest elements reaching past the right edge: the cause of any horizontal scrolling.
  const wide = [...document.querySelectorAll('body *')].filter(visible).filter((el) => !el.classList.contains('skip-link') && el.getBoundingClientRect().right > vw + 1);
  const widest = wide
    .filter((el) => ![...el.children].some((c) => wide.includes(c)))
    .map((el) => `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).trim().split(/\s+/).join('.')}` : ''}: ${name(el)}`);
  const skip = document.querySelector('.skip-link');
  let skipLinkOnFocus = null;
  if (skip) {
    skip.focus();
    const r = skip.getBoundingClientRect();
    skipLinkOnFocus = r.left >= 0 && r.right <= vw && r.top >= 0 && r.bottom <= innerHeight ? 'visible inside the viewport' : 'NOT fully visible';
    skip.blur();
  }
  return {
    devicePixelRatio,
    innerWidth,
    innerHeight,
    outerWidth,
    outerHeight,
    horizontalOverflowPx: document.documentElement.scrollWidth - vw,
    controls: controls.length,
    offscreen,
    clipped,
    overlaps,
    covered,
    stickyOrFixed,
    widest,
    skipLinkOnFocus,
  };
}

const results = [];
const errors = [];
let page;
let sw;
let shotNo = 0;
const tabZoom = async () => (await sw.evaluate(async () => Promise.all((await chrome.tabs.query({})).map((t) => chrome.tabs.getZoom(t.id)))))[0];
const setTabZoom = (factor) => sw.evaluate(async (f) => {
  for (const t of await chrome.tabs.query({})) await chrome.tabs.setZoom(t.id, f);
}, factor);

/** Waits until requests finish, no busy button or loading text remains, and the page height is stable. */
async function settle() {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page
    .waitForFunction(() => !/Loading|…$/.test(document.querySelector('main')?.innerText ?? '') && ![...document.querySelectorAll('button')].some((b) => b.disabled && /…|\.\.\.$/.test(b.textContent ?? '')), null, { timeout: 10_000 })
    .catch(() => {});
  let last = -1;
  for (let i = 0; i < 20; i++) {
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    if (h === last) return;
    last = h;
    await page.waitForTimeout(200);
  }
}
const errorShown = () => page.locator('main [role="alert"]').first().waitFor({ timeout: 10_000 });

async function audit(name) {
  await settle();
  const zoom = await tabZoom();
  const m = await page.evaluate(measure);
  const file = `${String(++shotNo).padStart(2, '0')}-${name}.png`;
  await screenshot(path.join(DIR, file));
  const problems = [
    zoom !== ZOOM && `browser zoom is ${zoom}`,
    m.horizontalOverflowPx > 0 && `horizontal scroll ${m.horizontalOverflowPx}px (${m.widest.join('; ')})`,
    m.skipLinkOnFocus && m.skipLinkOnFocus !== 'visible inside the viewport' && `skip link on focus: ${m.skipLinkOnFocus}`,
    m.offscreen.length > 0 && `controls outside the viewport: ${m.offscreen.join('; ')}`,
    m.clipped.length > 0 && `clipped content: ${m.clipped.join('; ')}`,
    m.overlaps.length > 0 && `overlapping controls: ${m.overlaps.join('; ')}`,
    m.covered.length > 0 && `covered controls: ${m.covered.join('; ')}`,
  ].filter(Boolean);
  results.push({ name, url: new URL(page.url()).pathname, zoom, ...m, screenshot: `${DIR}/${file}`, problems });
  console.log(`${problems.length ? 'CHECK' : 'OK   '}  ${name}${problems.length ? ` -> ${problems.join(' | ')}` : ''}`);
}
let cdp;
const MASK = { color: 'transparent', background: '#8a8a8a', 'text-shadow': 'none' };
/**
 * Masks secrets by colour only (layout unchanged) through CSSOM, which the page's CSP allows,
 * captures the whole zoomed page, then unmasks. Refuses to capture if any mask did not apply.
 */
async function screenshot(file) {
  const unmasked = await page.evaluate((mask) => {
    const secret = [...document.querySelectorAll('.secret-box')];
    const uri = [...document.querySelectorAll('p')].filter((el) => el.textContent.includes('otpauth://'));
    const typed = [...document.querySelectorAll('input')].filter((el) => el.labels?.[0]?.textContent?.includes('Assistance secret'));
    const targets = [...secret, ...uri, ...typed];
    for (const el of targets) {
      el.dataset.zoomAuditMask = '1';
      for (const [k, v] of Object.entries(mask)) el.style.setProperty(k, v, 'important');
    }
    return targets.filter((el) => getComputedStyle(el).color !== 'rgba(0, 0, 0, 0)').length;
  }, MASK);
  if (unmasked > 0) throw new Error(`refusing to capture ${file}: ${unmasked} secret element(s) not masked`);
  const { cssContentSize, cssVisualViewport } = await cdp.send('Page.getLayoutMetrics');
  const scroll = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
  const zoom = await tabZoom();
  const width = Math.ceil(Math.max(cssContentSize.width, cssVisualViewport.clientWidth, scroll.w) * zoom);
  const height = Math.ceil(Math.max(cssContentSize.height, scroll.h) * zoom);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 } });
  writeFileSync(file, Buffer.from(data, 'base64'));
  await page.evaluate((mask) => {
    for (const el of document.querySelectorAll('[data-zoom-audit-mask]')) {
      for (const k of Object.keys(mask)) el.style.removeProperty(k);
      delete el.dataset.zoomAuditMask;
    }
  }, MASK);
}

async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    const main = await page.locator('main').innerText().catch(() => '');
    errors.push({ step: name, url: new URL(page.url()).pathname, error: (e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 300), mainText: main.replace(/\s+/g, ' ').slice(0, 300) });
    await screenshot(path.join(DIR, `error-${name}.png`)).catch(() => {});
    console.log(`ERROR  ${name}: ${errors.at(-1).error} | at ${errors.at(-1).url}: ${errors.at(-1).mainText}`);
  }
}
const submitIn = (scope = page.locator('main')) => scope.locator('form button[type="submit"]').first().click();
async function signIn(username) {
  await context.clearCookies();
  await page.goto(`${ORIGIN}/signin`);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(seedPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByText(`Signed in as ${username}`).first().waitFor();
}
async function signOut() {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(/signed-out|signin|\/$/);
}
async function reloadUntil(locator, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await page.waitForLoadState('networkidle').catch(() => {});
    if (await locator.first().isVisible()) return;
    if (Date.now() > deadline) throw new Error('expected content did not appear');
    await page.waitForTimeout(1000);
    await page.reload();
  }
}

const profileDir = mkdtempSync(path.join(os.tmpdir(), 'rf-zoom-profile-'));
const extDir = mkdtempSync(path.join(os.tmpdir(), 'rf-zoom-ext-'));
writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'rf local zoom audit helper', version: '1.0', background: { service_worker: 'sw.js' } }));
writeFileSync(path.join(extDir, 'sw.js'), '// Zoom is driven by scripts/zoom-audit.mjs through chrome.tabs.setZoom.\n');

let context;
let exitCode = 1;
let environment;
let restoredZoom;
try {
  mkdirSync(DIR, { recursive: true });
  adminSql(`CREATE DATABASE "${DB}"`);
  await startServer();
  context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chromium',
    headless: true,
    viewport: null,
    args: [`--window-size=${WINDOW.width},${WINDOW.height}`, `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  });
  sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  page = context.pages()[0] ?? (await context.newPage());
  await page.goto(`${ORIGIN}/`);
  const at100 = await page.evaluate(() => ({ devicePixelRatio, innerWidth, innerHeight }));
  await setTabZoom(ZOOM);
  const at200 = await page.evaluate(() => ({ devicePixelRatio, innerWidth, innerHeight }));
  cdp = await context.newCDPSession(page);
  const version = await cdp.send('Browser.getVersion');
  environment = {
    browser: `${version.product} (Playwright-managed Chromium, new headless mode)`,
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    windowSize: `${WINDOW.width}x${WINDOW.height} (no viewport emulation)`,
    zoomMethod: 'chrome.tabs.setZoom(tab, 2): Chromium page zoom, the same setting as Ctrl+Plus (per-origin)',
    at100Percent: at100,
    at200Percent: { ...at200, tabZoom: await tabZoom() },
  };
  console.log(`zoom ${environment.at200Percent.tabZoom}: CSS viewport ${at100.innerWidth} -> ${at200.innerWidth} px wide, devicePixelRatio ${at100.devicePixelRatio} -> ${at200.devicePixelRatio}`);

  // Public pages, empty-form validation.
  await step('public', async () => {
    await audit('home');
    await page.goto(`${ORIGIN}/help`);
    await audit('help');
    await page.goto(`${ORIGIN}/shelters`);
    await audit('shelters');
    await page.goto(`${ORIGIN}/signin`);
    await audit('sign-in');
    await submitIn();
    await errorShown();
    await audit('sign-in-errors');
    await page.goto(`${ORIGIN}/signup`);
    await submitIn();
    await errorShown();
    await audit('sign-up-errors');
    await page.goto(`${ORIGIN}/recover`);
    await submitIn();
    await errorShown();
    await audit('recover-errors');
    await page.goto(`${ORIGIN}/no-such-page`);
    await audit('not-found');
  });

  // Leo: dashboard, contact code, check-in form with an error, then a check-in.
  let code = '';
  await step('leo-setup', async () => {
    await signIn('leo');
    await audit('dashboard');
    await page.goto(`${ORIGIN}/privacy`);
    await page.getByRole('button', { name: /Create contact code|Replace contact code/ }).click();
    code = ((await page.getByLabel('Your contact code (shown once)').textContent()) ?? '').trim();
    if (code.replace(/[^0-9A-Z]/g, '').length < 16) throw new Error(`contact code not captured (length ${code.length})`);
    await audit('privacy-contact-code');
    await page.goto(`${ORIGIN}/check-ins`);
    await page.getByRole('button', { name: 'Add a check-in' }).click();
    await page.getByLabel('Shelter', { exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('select[aria-busy="true"]'));
    await audit('check-ins');
    await page.getByRole('button', { name: 'Save check-in' }).click();
    await audit('check-in-errors');
    await page.getByLabel('Shelter', { exact: true }).selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Save check-in' }).click();
    await page.waitForLoadState('networkidle');
    await audit('check-in-saved');
    await signOut();
    await audit('signed-out');
  });

  // Maya: request form with errors, then a code request.
  await step('maya-request', async () => {
    await signIn('maya');
    await page.goto(`${ORIGIN}/requests/new`);
    await audit('find-someone');
    await submitIn();
    await errorShown();
    await audit('find-someone-errors');
    await page.getByLabel('Contact code', { exact: true }).fill(code);
    await page.getByLabel('Introduction').fill('Maya here, checking in. Fictional zoom-audit request.');
    await page.getByRole('button', { name: 'Send private request' }).click();
    await page.getByRole('heading', { name: 'Request saved' }).waitFor();
    await audit('request-saved');
    await page.goto(`${ORIGIN}/requests/outgoing`);
    await audit('outgoing');
    await signOut();
  });

  // Leo: incoming request, block dialog (cancelled), disclosure choice with preview, confirmation.
  await step('leo-answer', async () => {
    await signIn('leo');
    await page.goto(`${ORIGIN}/requests/incoming`);
    await reloadUntil(page.getByText('Fictional zoom-audit request.'));
    await audit('incoming');
    await page.getByRole('button', { name: 'Block this sender' }).first().click();
    await audit('block-dialog');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Answer' }).first().click();
    await page.getByLabel('Message and the approximate area of one check-in').check();
    await page.getByLabel('Which check-in').selectOption({ index: 1 });
    await page.getByRole('region', { name: /Exactly what/ }).waitFor();
    await audit('respond-disclosure-preview');
    await page.getByRole('button', { name: 'Review and share' }).click();
    await audit('respond-confirm');
    await page.getByRole('button', { name: /Confirm: share with/ }).click();
    await page.getByText('Answered').first().waitFor();
    await audit('answered');
    await page.goto(`${ORIGIN}/sharing`);
    await audit('sharing');
    await page.getByRole('button', { name: 'Revoke everything shared' }).click();
    await audit('revoke-all-dialog');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
    await signOut();
  });

  // Maya: the shared answer and notifications.
  await step('maya-view', async () => {
    await signIn('maya');
    await page.goto(`${ORIGIN}/requests/outgoing`);
    await reloadUntil(page.getByText('Response available'));
    await page.getByRole('link', { name: 'View response' }).first().click();
    await page.getByRole('heading', { level: 1 }).waitFor();
    await audit('response-view');
    await page.goto(`${ORIGIN}/notifications`);
    await audit('notifications');
    await signOut();
  });

  // Leo: revoke one share, open the account-deletion form (not submitted).
  await step('leo-revoke', async () => {
    await signIn('leo');
    await page.goto(`${ORIGIN}/sharing`);
    await page.getByRole('button', { name: 'Revoke', exact: true }).first().click();
    await page.getByText('Revoked').first().waitFor();
    await audit('revoked');
    await page.goto(`${ORIGIN}/account`);
    await page.getByRole('button', { name: 'Delete my account' }).click();
    await audit('account-delete-form');
    await signOut();
  });

  // Staff worker A: two-step setup (with a wrong password first), intake errors, case verification.
  await step('staff', async () => {
    await signIn('worker.a');
    await page.getByRole('heading', { name: 'Staff two-step verification' }).waitFor();
    await audit('staff-two-step');
    await page.getByLabel('Confirm your password').fill('not the right password');
    await page.getByRole('button', { name: 'Start setup' }).click();
    await page.getByRole('alert').first().waitFor();
    await audit('staff-two-step-error');
    await page.getByLabel('Confirm your password').fill(seedPassword);
    await page.getByRole('button', { name: 'Start setup' }).click();
    const key = ((await page.getByLabel(/Setup key/).textContent()) ?? '').trim();
    await audit('staff-two-step-setup');
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(key), digits: 6, period: 30, algorithm: 'SHA1' });
    await page.getByLabel('6-digit code').fill(totp.generate());
    await page.getByRole('button', { name: 'Verify' }).click();
    await page.getByRole('button', { name: 'I saved them, continue' }).waitFor();
    await audit('staff-recovery-codes');
    await page.getByRole('button', { name: 'I saved them, continue' }).click();
    await page.getByRole('heading', { name: 'Staff work' }).waitFor();
    await audit('staff-home');
    await page.goto(`${ORIGIN}/staff/intake`);
    await audit('staff-intake');
    await submitIn();
    await errorShown();
    await audit('staff-intake-errors');
    await page.goto(`${ORIGIN}/staff`);
    await page.getByRole('link', { name: /^Sam/ }).click();
    await page.getByLabel('Assistance secret').waitFor();
    await audit('staff-case-verify');
    await page.getByLabel('Assistance secret').fill('AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AA');
    await page.getByRole('button', { name: 'Verify', exact: true }).click();
    await page.getByRole('alert').first().waitFor();
    await audit('staff-case-verify-error');
    await page.getByLabel('Assistance secret').fill(demoSecret(seedSecret, 'assist:sam'));
    await page.getByRole('button', { name: 'Verify', exact: true }).click();
    await page.getByRole('heading', { name: 'Verified for this visit', exact: true }).waitFor();
    await audit('staff-case-workspace');
    await page.getByRole('button', { name: 'Delete at the person’s request' }).click();
    await audit('staff-case-delete-confirm');
    await signOut();
  });

  await setTabZoom(1);
  restoredZoom = await tabZoom();
  const flagged = results.filter((r) => r.problems.length);
  writeFileSync(
    path.join(DIR, 'zoom-audit.json'),
    JSON.stringify({ ranAt: new Date().toISOString(), note: 'local audit, fictional data, disposable database; secrets masked in screenshots', environment, restoredZoom, pages: results, errors }, null, 2),
  );
  console.log(`\n${results.length} views audited at ${ZOOM * 100}%: ${results.length - flagged.length} without automated findings, ${flagged.length} to review; ${errors.length} step errors; zoom restored to ${restoredZoom * 100}%`);
  exitCode = flagged.length || errors.length ? 1 : 0;
} catch (e) {
  console.error(`zoom audit failed: ${e instanceof Error ? e.message : e}`);
} finally {
  await context?.close().catch(() => {});
  server?.kill();
  await new Promise((r) => setTimeout(r, 800));
  try {
    adminSql(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
  } catch {
    console.error(`could not drop ${DB}`);
  }
  rmSync(profileDir, { recursive: true, force: true });
  rmSync(extDir, { recursive: true, force: true });
}
process.exit(exitCode);
