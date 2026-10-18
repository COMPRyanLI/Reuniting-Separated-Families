import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { demoSecret } from '../../prisma/fixtures';
import { expectNoHorizontalScroll, newActor, SEED_PASSWORD, SEED_SECRET, signIn, signInStaff, uniqueName } from './helpers';

// Run with `npm run test:a11y`. Tagged so the regular e2e run skips it.
async function scan(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = result.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  expect(serious.map((v) => `${label}: ${v.id} (${v.impact}) ${v.nodes.length} node(s)`)).toEqual([]);
  return result.violations.length;
}

test('UX-01 @a11y public and individual pages have no critical or serious automated findings', async ({ browser }) => {
  const { context, page } = await newActor(browser);
  for (const path of ['/', '/help', '/shelters', '/signin', '/signup', '/recover', '/signed-out', '/no-such-page']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await scan(page, path);
  }
  await signIn(page, 'leo');
  const pages: [string, string | RegExp][] = [
    ['/dashboard', /Hello/],
    ['/check-ins', 'Your check-ins'],
    ['/privacy', 'Privacy and contact code'],
    ['/requests/new', 'Find someone'],
    ['/requests/outgoing', 'Your requests'],
    ['/requests/incoming', 'Requests for you'],
    ['/sharing', 'Manage sharing'],
    ['/shared', 'Shared with you'],
    ['/notifications', 'Updates'],
    ['/account', 'Account'],
  ];
  for (const [path, heading] of pages) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await scan(page, path);
  }
  // Open forms and error states too.
  await page.goto('/check-ins');
  await page.getByRole('button', { name: 'Add a check-in' }).click();
  await page.getByRole('button', { name: 'Save check-in' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await scan(page, '/check-ins form with errors');
  await page.goto('/requests/new');
  await page.getByRole('button', { name: 'Send private request' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await scan(page, '/requests/new with errors');
  await context.close();
});

test('UX-01 @a11y staff pages have no critical or serious automated findings', async ({ browser }) => {
  const { context, page } = await newActor(browser);
  await signIn(page, 'worker.b');
  await expect(page.getByRole('heading', { name: 'Staff two-step verification' })).toBeVisible();
  await scan(page, '/staff/verify');
  await context.close();
  const staff = await newActor(browser);
  await signInStaff(staff.page, 'worker.b');
  await scan(staff.page, '/staff');
  await staff.page.goto('/staff/intake');
  await scan(staff.page, '/staff/intake');
  await staff.page.goto('/staff');
  await staff.page.getByRole('link', { name: /^Ana/ }).click();
  await scan(staff.page, 'case (unverified)');
  await staff.page.getByLabel('Assistance secret').fill(demoSecret(SEED_SECRET, 'assist:ana'));
  await staff.page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(staff.page.getByRole('heading', { name: 'Verified for this visit', exact: true })).toBeVisible();
  await scan(staff.page, 'case (verified)');
  await staff.context.close();
  const coord = await newActor(browser);
  await signInStaff(coord.page, 'coord.b');
  await scan(coord.page, '/staff (coordinator)');
  await coord.context.close();
});

/** Presses Tab until the focused element has the given accessible label/text. */
async function tabTo(page: Page, name: RegExp, max = 60) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const label = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return '';
      const id = el.getAttribute('id');
      const lbl = id ? document.querySelector(`label[for="${id}"]`)?.textContent : '';
      return `${lbl ?? ''} ${el.getAttribute('aria-label') ?? ''} ${el.textContent ?? ''}`.trim();
    });
    if (name.test(label)) return;
  }
  throw new Error(`could not reach ${name} with Tab`);
}

test('UX-01 @a11y keyboard-only journey: sign up, add a check-in, send a request, with visible focus', async ({ browser }) => {
  const { context, page } = await newActor(browser);
  await page.goto('/signup');
  // Pages are lazy-loaded: wait for the page before using the keyboard.
  await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible();
  await tabTo(page, /^Username/);
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
  expect(outline).not.toBe('none');
  await page.keyboard.type(uniqueName('kb'));
  await tabTo(page, /^Password/);
  await page.keyboard.type('keyboard only passphrase');
  await tabTo(page, /Name others will see/);
  await page.keyboard.type('Keyboard User');
  await tabTo(page, /^Create account$/);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Save your recovery secret' })).toBeVisible();
  await tabTo(page, /I have written down/);
  await page.keyboard.press('Space');
  await tabTo(page, /^Continue$/);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: /Hello, Keyboard User/ })).toBeVisible();

  await tabTo(page, /Let someone know/);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Your check-ins' })).toBeVisible();
  await tabTo(page, /^Add a check-in$/);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Save check-in' })).toBeVisible();
  // The shelter list loads asynchronously; the select stays disabled (and skipped by Tab) until its options exist.
  await expect(page.getByLabel('Shelter', { exact: true })).toBeEnabled();
  await tabTo(page, /^Shelter/);
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLSelectElement).value)).not.toBe('');
  await tabTo(page, /^Save check-in$/);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('article').first()).toContainText('Last reported');

  await page.goto('/requests/new');
  await expect(page.getByRole('heading', { name: 'Find someone' })).toBeVisible();
  await tabTo(page, /^Contact code/);
  await page.keyboard.type('0000-0000-0000-0000-0000-0000-00');
  await tabTo(page, /^Introduction/);
  await page.keyboard.type('Sent with the keyboard only');
  await tabTo(page, /^Send private request$/);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Request saved' })).toBeVisible();
  await context.close();
});

test('UX-01 @a11y error summary receives focus after a failed sign-in', async ({ browser }) => {
  const { context, page } = await newActor(browser);
  await signIn(page, 'nobody.at.all', 'wrong password!!', { expectSuccess: false });
  await expect(page.getByRole('alert')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('role'))).toBe('alert');
  await context.close();
});

// Found by the 200% browser-zoom audit (scripts/zoom-audit.mjs): the one-line setup link pushed the page sideways.
test('UX-02 @a11y staff two-step setup reflows at 390 px: the long setup link wraps', async ({ browser }) => {
  const staff = await newActor(browser, { width: 390, height: 844 });
  await signIn(staff.page, 'coord.a');
  await expect(staff.page.getByRole('heading', { name: 'Staff two-step verification' })).toBeVisible();
  await staff.page.getByLabel('Confirm your password').fill(SEED_PASSWORD);
  await staff.page.getByRole('button', { name: 'Start setup' }).click();
  await expect(staff.page.getByText(/otpauth:\/\//)).toBeVisible();
  await expectNoHorizontalScroll(staff.page);
  await staff.context.close();
});
