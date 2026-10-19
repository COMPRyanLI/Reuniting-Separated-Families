import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomBytes } from 'node:crypto';

// Live-site checks with fictional people only. Every account created here is deleted at the end.
test.describe.configure({ mode: 'serial' });

const tag = randomBytes(3).toString('hex');
const people = {
  rory: { username: `hosted.rory.${tag}`, alias: 'Rory (fictional)', password: `hosted rory ${tag} passphrase` },
  quinn: { username: `hosted.quinn.${tag}`, alias: 'Quinn (fictional)', password: `hosted quinn ${tag} passphrase` },
  ola: { username: `hosted.ola.${tag}`, alias: 'Ola (fictional)', password: `hosted ola ${tag} passphrase` },
};
type Who = keyof typeof people;
const actors: Partial<Record<Who, { context: BrowserContext; page: Page }>> = {};
let roryRecovery = '';
let roryCode = '';
let responseUrl = '';

async function actor(browser: Browser, who: Who, viewport = { width: 1280, height: 800 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  actors[who] = { context, page };
  return page;
}

async function signUp(page: Page, who: Who) {
  const p = people[who];
  await page.goto('/signup');
  await page.getByLabel('Username').fill(p.username);
  await page.getByLabel('Password').fill(p.password);
  await page.getByLabel('Name others will see').fill(p.alias);
  await page.getByRole('button', { name: 'Create account' }).click();
  // Latest build: the result heading takes focus so screen readers announce it.
  await expect(page.getByRole('heading', { name: 'Save your recovery secret' })).toBeFocused();
  const secret = ((await page.getByLabel('Your recovery secret').textContent()) ?? '').trim();
  await page.getByLabel('I have written down my recovery secret').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(p.alias);
  return secret;
}

async function signIn(page: Page, who: Who, password = people[who].password) {
  await page.goto('/signin');
  await page.getByLabel('Username').fill(people[who].username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

async function reloadUntil(page: Page, check: () => Promise<void>, timeout = 45_000) {
  await expect(async () => {
    await page.reload();
    await check();
  }).toPass({ timeout, intervals: [1000, 2000, 3000] });
}

async function seriousA11y(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return result.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => v.id);
}

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

test('public pages load, have no serious accessibility findings and keep private API closed', async ({ browser, request }) => {
  const page = await actor(browser, 'ola');
  for (const path of ['/', '/help', '/shelters', '/signin', '/signup']) {
    await page.goto(path);
    await expect(page.getByRole('note')).toContainText('fictional data only');
    expect(await seriousA11y(page), path).toEqual([]);
  }
  await page.goto('/shelters');
  await expect(page.getByText('Riverside Community Center')).toBeVisible();
  await page.goto('/no-such-page');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect((await request.get('/api/v1/me')).status()).toBe(401);
  expect((await request.get('/api/v1/staff/tasks')).status()).toBe(401);
  // No source maps are published.
  const html = await (await request.get('/')).text();
  const asset = html.match(/src="(\/assets\/[^"]+\.js)"/)![1]!;
  expect((await request.get(`${asset}.map`)).status()).not.toBe(200);
  await actors.ola!.context.close();
});

test('sign-in errors do not reveal whether a username exists', async ({ request }) => {
  const unknown = await request.post('/api/v1/auth/login', { data: { username: `nobody.${tag}`, password: 'wrong password 123' }, headers: { Origin: test.info().project.use.baseURL! } });
  const wrong = await request.post('/api/v1/auth/login', { data: { username: 'maya', password: 'wrong password 123' }, headers: { Origin: test.info().project.use.baseURL! } });
  expect(unknown.status()).toBe(401);
  expect(wrong.status()).toBe(401);
  expect((await unknown.json()).error.message).toBe((await wrong.json()).error.message);
});

test('two people: check-in, contact code, private request, exact preview, answer, outsider denied, revoke', async ({ browser }) => {
  const rory = await actor(browser, 'rory');
  const quinn = await actor(browser, 'quinn', { width: 390, height: 844 });
  roryRecovery = await signUp(rory, 'rory');
  await signUp(quinn, 'quinn');

  await rory.goto('/check-ins');
  await rory.getByRole('button', { name: 'Add a check-in' }).click();
  await expect(rory.getByLabel('Shelter', { exact: true })).toBeEnabled();
  await rory.getByLabel('Shelter', { exact: true }).selectOption({ label: 'Hillcrest School Gym (Hillcrest)' });
  await rory.getByRole('button', { name: 'Save check-in' }).click();
  await expect(rory.getByRole('article').filter({ hasText: 'Hillcrest School Gym' })).toBeVisible();

  await rory.goto('/privacy');
  await rory.getByRole('button', { name: /Create contact code|Replace contact code/ }).click();
  roryCode = ((await rory.getByLabel('Your contact code (shown once)').textContent()) ?? '').trim();
  await rory.getByRole('button', { name: 'I noted it, hide it' }).click();

  await quinn.goto('/requests/new');
  await noHorizontalScroll(quinn);
  await quinn.getByRole('button', { name: 'Send private request' }).click();
  await expect(quinn.getByRole('alert')).toContainText('Enter the contact code.');
  await quinn.getByLabel('Contact code', { exact: true }).fill(roryCode);
  await quinn.getByLabel('Introduction').fill(`Quinn here, your cousin. HOSTED_${tag}`);
  await quinn.getByRole('button', { name: 'Send private request' }).click();
  await expect(quinn.getByRole('heading', { name: 'Request saved' })).toBeFocused();

  await rory.goto('/requests/incoming');
  await reloadUntil(rory, () => expect(rory.getByText(`HOSTED_${tag}`)).toBeVisible());
  await rory.getByRole('button', { name: 'Answer' }).first().click();
  await rory.getByLabel('Message and the approximate area of one check-in').check();
  await rory.getByLabel('Which check-in').selectOption({ index: 1 });
  const preview = rory.getByRole('region', { name: /Exactly what Quinn \(fictional\) will see/ });
  await expect(preview).toContainText('Area: Hillcrest');
  await expect(preview).not.toContainText('42 Sample Road');
  await rory.getByRole('button', { name: 'Review and share' }).click();
  await rory.getByRole('button', { name: /Confirm: share with Quinn/ }).click();
  await expect(rory.getByText('Answered').first()).toBeVisible();

  await quinn.goto('/requests/outgoing');
  await reloadUntil(quinn, () => expect(quinn.getByText('Response available')).toBeVisible());
  await quinn.getByRole('link', { name: 'View response' }).click();
  await expect(quinn.getByRole('heading', { name: /Answer from Rory/ })).toBeVisible();
  await expect(quinn.getByText('Area: Hillcrest')).toBeVisible();
  await expect(quinn.getByText('42 Sample Road')).toHaveCount(0);
  await noHorizontalScroll(quinn);
  responseUrl = quinn.url();
  const storage = await quinn.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  expect(storage).not.toContain(`HOSTED_${tag}`);
  expect(storage).not.toContain('Hillcrest');

  // An outsider with the same link sees nothing, in the page and in the API.
  const ola = await actor(browser, 'ola');
  await signUp(ola, 'ola');
  await ola.goto(responseUrl);
  await expect(ola.getByRole('heading', { name: 'This answer is not available' })).toBeVisible();
  const direct = await ola.evaluate(async (id) => (await fetch(`/api/v1/responses/${id}`)).status, responseUrl.split('/').pop()!);
  expect(direct).toBe(404);

  await rory.goto('/sharing');
  await rory.getByRole('button', { name: 'Revoke', exact: true }).click();
  await expect(rory.getByText('Revoked')).toBeVisible();
  await quinn.goto(responseUrl);
  await expect(quinn.getByRole('heading', { name: 'This answer is not available' })).toBeVisible();
});

test('state-changing requests need the session CSRF token and the site origin', async () => {
  const quinn = actors.quinn!.page;
  const results = await quinn.evaluate(async () => {
    const body = JSON.stringify({ shelterId: '00000000-0000-4000-8000-000000000000', observedAt: new Date().toISOString() });
    const noToken = await fetch('/api/v1/me/check-ins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    return { noToken: noToken.status, noTokenCode: (await noToken.json()).error?.code };
  });
  expect(results.noToken).toBe(403);
  expect(results.noTokenCode).toBe('CSRF_REJECTED');
  // Same valid cookie and token, sent from another site's origin: refused.
  const ctx = actors.quinn!.context;
  const token = (await (await ctx.request.get('/api/v1/auth/session')).json()).csrfToken as string;
  const foreign = await ctx.request.post('/api/v1/me/check-ins', {
    headers: { Origin: 'https://attacker.example', 'X-CSRF-Token': token },
    data: { shelterId: '00000000-0000-4000-8000-000000000000', observedAt: new Date().toISOString() },
  });
  expect(foreign.status()).toBe(403);
  const staff = await quinn.evaluate(async () => (await fetch('/api/v1/staff/tasks')).status);
  expect(staff).toBe(403);
});

test('shared device: sign out, then Back shows no private data and the old session is dead', async () => {
  const quinn = actors.quinn!.page;
  await quinn.goto('/requests/outgoing');
  await expect(quinn.getByText(`HOSTED_${tag}`)).toBeVisible();
  await quinn.getByRole('button', { name: 'Sign out' }).click();
  await expect(quinn.getByRole('heading', { name: 'You have signed out' })).toBeVisible();
  await quinn.goBack();
  await expect(quinn.getByText(`HOSTED_${tag}`)).toHaveCount(0);
  expect(await quinn.evaluate(async () => (await fetch('/api/v1/me')).status)).toBe(401);
});

test('password recovery with the recovery secret; the old password stops working', async () => {
  const rory = actors.rory!.page;
  await rory.getByRole('button', { name: 'Sign out' }).click();
  await rory.goto('/recover');
  await rory.getByLabel('Username').fill(people.rory.username);
  await rory.getByLabel('Recovery secret').fill(roryRecovery);
  await rory.getByLabel('New password').fill(`${people.rory.password} new`);
  await rory.getByRole('button', { name: 'Set new password' }).click();
  await expect(rory.getByRole('heading', { name: 'Password changed' })).toBeFocused();
  await rory.getByLabel('I have written down my new recovery secret').check();
  await rory.getByRole('button', { name: /Continue/ }).click();
  await rory.getByRole('button', { name: 'Sign out' }).click();
  await rory.goto('/signin');
  await rory.getByLabel('Username').fill(people.rory.username);
  await rory.getByLabel('Password').fill(people.rory.password);
  await rory.getByRole('button', { name: 'Sign in' }).click();
  await expect(rory.getByRole('alert')).toContainText('Username or password is incorrect.');
  people.rory.password = `${people.rory.password} new`;
  await signIn(rory, 'rory');
});

test('signed-in pages have no serious accessibility findings and fit a phone screen', async ({ browser }) => {
  await actors.quinn!.context.close();
  const page = await actor(browser, 'quinn', { width: 390, height: 844 });
  await signIn(page, 'quinn');
  for (const path of ['/dashboard', '/check-ins', '/requests/new', '/requests/outgoing', '/requests/incoming', '/sharing', '/privacy', '/account']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await noHorizontalScroll(page);
    expect(await seriousA11y(page), path).toEqual([]);
  }
});

test('clean-up: each fictional account deletes itself and can no longer sign in', async () => {
  for (const who of ['rory', 'quinn', 'ola'] as const) {
    const page = actors[who]!.page;
    if (!(await page.getByRole('button', { name: 'Sign out' }).isVisible().catch(() => false))) await signIn(page, who);
    await page.goto('/account');
    await page.getByRole('button', { name: 'Delete my account' }).click();
    await page.getByRole('region', { name: 'Delete your account and information' }).getByLabel('Confirm your password').fill(people[who].password);
    await page.getByRole('button', { name: 'Permanently delete' }).click();
    await page.waitForURL(/signed-out|\/$/);
    await page.goto('/signin');
    await page.getByLabel('Username').fill(people[who].username);
    await page.getByLabel('Password').fill(people[who].password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText('Username or password is incorrect.');
    await actors[who]!.context.close();
  }
});
