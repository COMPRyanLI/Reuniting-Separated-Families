import { expect, test } from '@playwright/test';
import { newActor, register, uniqueName } from './helpers';

test('CHECK-01/CHECK-02 own shelter and area check-ins in the browser, historical wording, no GPS prompt', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Tokyo' });
  await context.addInitScript(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition = (() => {
        (window as unknown as { __geo?: boolean }).__geo = true;
      }) as never;
    }
  });
  const page = await context.newPage();
  await register(page, uniqueName('ci'), 'Checkin Person');
  await page.getByRole('link', { name: /Let someone know/ }).click();
  await page.getByRole('button', { name: 'Add a check-in' }).click();
  await page.getByLabel('Shelter', { exact: true }).selectOption({ label: 'Hillcrest School Gym (Hillcrest)' });
  await page.getByRole('button', { name: 'Save check-in' }).click();
  const card = page.getByRole('article').filter({ hasText: 'Hillcrest School Gym' });
  await expect(card).toContainText('Last reported');
  await expect(card).toContainText(/GMT\+9|JST/); // displayed in the browser's timezone
  await expect(card).toContainText('Reported by the person');
  await expect(card).toContainText('Current presence is unconfirmed');
  await expect(card).not.toContainText(/live|safe now/i);

  await page.getByRole('button', { name: 'Add a check-in' }).click();
  await page.getByLabel('In an area (no shelter)').check();
  await page.getByLabel('Area', { exact: true }).selectOption({ label: 'East Marsh' });
  const twoDaysAgo = new Date(Date.now() - 50 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  // datetime-local is interpreted in the browser timezone (Asia/Tokyo, UTC+9).
  const tokyo = new Date(twoDaysAgo.getTime() + 9 * 3600_000);
  await page.getByLabel('When were you there?').fill(`${tokyo.getUTCFullYear()}-${pad(tokyo.getUTCMonth() + 1)}-${pad(tokyo.getUTCDate())}T${pad(tokyo.getUTCHours())}:${pad(tokyo.getUTCMinutes())}`);
  await page.getByRole('button', { name: 'Save check-in' }).click();
  const areaCard = page.getByRole('article').filter({ hasText: 'Area: East Marsh' });
  await expect(areaCard).toContainText('Older report');
  // Most recent observation first, even though the area report was entered last.
  await expect(page.getByRole('article').first()).toContainText('Hillcrest School Gym');

  await card.getByRole('button', { name: 'I have left this place' }).click();
  await expect(page.getByRole('article').filter({ hasText: 'Hillcrest School Gym' })).toContainText('Marked as left');
  expect(await page.evaluate(() => (window as unknown as { __geo?: boolean }).__geo === true)).toBe(false);
  await context.close();
});

test('CHECK-02 future observation time is refused with a visible error', async ({ browser }) => {
  const { context, page } = await newActor(browser);
  await register(page, uniqueName('fut'), 'Future Tester');
  await page.goto('/check-ins');
  await page.getByRole('button', { name: 'Add a check-in' }).click();
  await page.getByLabel('Shelter', { exact: true }).selectOption({ index: 1 });
  const future = new Date(Date.now() + 2 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  await page
    .getByLabel('When were you there?')
    .fill(`${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}T${pad(future.getHours())}:${pad(future.getMinutes())}`);
  await page.getByRole('button', { name: 'Save check-in' }).click();
  await expect(page.getByRole('alert')).toContainText('in the future');
  await expect(page.getByRole('article')).toHaveCount(0);
  await context.close();
});

test('UX-01/UX-03 place lists show a loading state and stay unusable until their options arrive', async ({ browser }) => {
  const { context, page } = await newActor(browser);
  await register(page, uniqueName('slow'), 'Slow Network');
  // Hold the public shelter list until the test releases it (deterministic slow network).
  let release!: () => void;
  const released = new Promise<void>((r) => (release = r));
  await page.route('**/api/v1/shelters', async (route) => {
    await released;
    await route.continue();
  });
  await page.goto('/check-ins');
  await page.getByRole('button', { name: 'Add a check-in' }).click();
  const select = page.getByLabel('Shelter', { exact: true });
  await expect(select).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: 'Loading the shelter list' })).toBeVisible();
  release();
  await expect(select).toBeEnabled();
  await expect(select.locator('option')).not.toHaveCount(1);
  await expect(page.getByRole('status').filter({ hasText: 'Loading the shelter list' })).toHaveCount(0);

  // A failed list load is announced and can be retried; it never looks like an empty list.
  await page.unroute('**/api/v1/shelters');
  await page.route('**/api/v1/shelters', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"SERVICE_UNAVAILABLE","message":"x"}}' }));
  await page.goto('/requests/new');
  await page.getByLabel('Without a code: ask one shelter’s team to help').check();
  await expect(page.getByRole('alert').filter({ hasText: 'Could not load the shelter list' })).toBeVisible();
  await page.unroute('**/api/v1/shelters');
  await page.getByRole('button', { name: 'Try loading shelters again' }).click();
  await expect(page.getByLabel('Shelter they might be at (optional)')).toBeEnabled();
  await expect(page.getByLabel('Shelter they might be at (optional)').locator('option')).not.toHaveCount(1);
  await context.close();
});
