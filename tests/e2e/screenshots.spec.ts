import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { demoSecret } from '../../prisma/fixtures';
import { expectNoHorizontalScroll, SEED_SECRET, signIn, signInStaff } from './helpers';

// UX-02: fictional-data screenshots at the three required viewports, saved as submission evidence.
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
];
const DIR = 'evidence/screenshots';
mkdirSync(DIR, { recursive: true });

async function shot(page: Page, name: string) {
  await expectNoHorizontalScroll(page);
  // Essential controls are inside the viewport width (not clipped off-screen).
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll('button, a.button, input, select, textarea')]
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1).length,
  );
  expect(clipped).toBe(0);
  await page.screenshot({ path: `${DIR}/${name}.png`, fullPage: true });
}

for (const vp of VIEWPORTS) {
  test(`UX-02 screenshots at ${vp.width}x${vp.height}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: vp });
    const page = await context.newPage();
    await page.goto('/');
    await shot(page, `home-${vp.width}`);
    await signIn(page, 'leo');
    await shot(page, `dashboard-${vp.width}`);
    await page.goto('/check-ins');
    await expect(page.getByRole('article').first()).toBeVisible();
    await shot(page, `check-ins-${vp.width}`);
    await page.goto('/requests/incoming');
    await shot(page, `incoming-${vp.width}`);
    const answer = page.getByRole('button', { name: 'Answer' }).first();
    if (await answer.isVisible()) {
      await answer.click();
      await page.getByLabel('Message and the approximate area of one check-in').check();
      await page.getByLabel('Which check-in').selectOption({ index: 1 });
      await expect(page.getByRole('region', { name: /Exactly what/ })).toContainText('Area:');
      await shot(page, `respond-preview-${vp.width}`);
    }
    await page.goto('/requests/new');
    await shot(page, `find-someone-${vp.width}`);
    await context.close();

    const staffCtx = await browser.newContext({ viewport: vp });
    const staff = await staffCtx.newPage();
    await signInStaff(staff, 'worker.a');
    await shot(staff, `staff-home-${vp.width}`);
    await staff.getByRole('link', { name: /^Sam/ }).click();
    // Verification lasts 10 minutes; only verify if this worker is not currently verified.
    // Anchored: case cards on the staff list also carry a "Verified for this visit" badge.
    await expect(staff.getByRole('heading', { level: 2, name: /^(Verify the person for this visit|Verified for this visit)$/ })).toBeVisible();
    if (await staff.getByLabel('Assistance secret').isVisible()) {
      await staff.getByLabel('Assistance secret').fill(demoSecret(SEED_SECRET, 'assist:sam'));
      await staff.getByRole('button', { name: 'Verify', exact: true }).click();
    }
    await expect(staff.getByRole('heading', { name: 'Verified for this visit', exact: true })).toBeVisible();
    await shot(staff, `staff-case-${vp.width}`);
    await staffCtx.close();
  });
}
