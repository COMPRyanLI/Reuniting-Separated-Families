import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import * as OTPAuth from 'otpauth';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export const SEED_PASSWORD = process.env.SEED_PASSWORD ?? '';
export const SEED_SECRET = process.env.SEED_SECRET ?? '';

export function uniqueName(prefix: string): string {
  return `${prefix}.${randomBytes(3).toString('hex')}`;
}

/** Each actor gets a separate browser context: separate cookies, storage and cache. */
export async function newActor(browser: Browser, viewport = { width: 1280, height: 800 }): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  return { context, page };
}

export async function signIn(page: Page, username: string, password = SEED_PASSWORD, opts: { expectSuccess?: boolean } = {}) {
  await page.goto('/signin');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  if (opts.expectSuccess !== false) {
    // Wait until the session exists before navigating elsewhere (navigation would abort the login call).
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  }
}

export async function register(page: Page, username: string, alias: string, password = 'e2e passphrase long enough') {
  await page.goto('/signup');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByLabel('Name others will see').fill(alias);
  await page.getByRole('button', { name: 'Create account' }).click();
  const secret = (await page.getByLabel('Your recovery secret').textContent()) ?? '';
  await page.getByLabel('I have written down my recovery secret').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(alias);
  return { secret, password };
}

/**
 * Staff TOTP secrets and last-used time steps must survive Playwright worker restarts
 * (a worker restarts after any failure), so they live in a per-run JSON file.
 */
interface StaffState {
  secrets: Record<string, string>;
  lastStep: Record<string, number>;
}
const STATE_FILE = process.env.E2E_STATE_FILE;
function loadState(): StaffState {
  if (STATE_FILE && existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as StaffState;
  return { secrets: {}, lastStep: {} };
}
function saveState(state: StaffState) {
  if (STATE_FILE) writeFileSync(STATE_FILE, JSON.stringify(state));
}

function totpNow(secret: string): string {
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30, algorithm: 'SHA1' });
  return totp.generate();
}

/** Signs a staff member in through the real MFA flow (enrolling on first use). */
export async function signInStaff(page: Page, username: string) {
  await signIn(page, username);
  // Every new staff session must complete two-step verification.
  await expect(page.getByRole('heading', { name: 'Staff two-step verification' })).toBeVisible();
  {
    const state = loadState();
    const known = state.secrets[username];
    if (!known) {
      await page.getByLabel('Confirm your password').fill(SEED_PASSWORD);
      await page.getByRole('button', { name: 'Start setup' }).click();
      state.secrets[username] = (await page.getByLabel(/Setup key/).textContent())!.trim();
      saveState(state);
    }
    // Replay protection: never reuse a time step for the same account.
    const last = state.lastStep[username] ?? 0;
    if (Math.floor(Date.now() / 30_000) <= last) await page.waitForTimeout((last + 1) * 30_000 - Date.now() + 500);
    state.lastStep[username] = Math.floor(Date.now() / 30_000);
    saveState(state);
    await page.getByLabel('6-digit code').fill(totpNow(state.secrets[username]!));
    await page.getByRole('button', { name: 'Verify' }).click();
    const saveCodes = page.getByRole('button', { name: 'I saved them, continue' });
    if (!known) await saveCodes.click();
    await expect(page.getByRole('heading', { name: 'Staff work' })).toBeVisible();
  }
}

export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Calls the API with the context's cookies (and CSRF token for mutations) to check server-side authorization. */
export async function apiAs(page: Page, method: 'GET' | 'POST', path: string, body?: unknown) {
  return page.evaluate(
    async ({ method, path, body }) => {
      let csrf = '';
      if (method !== 'GET') {
        const s = await fetch('/api/v1/auth/session');
        if (s.ok) csrf = (await s.json()).csrfToken;
      }
      const res = await fetch(`/api/v1${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: await res.text() };
    },
    { method, path, body },
  );
}
