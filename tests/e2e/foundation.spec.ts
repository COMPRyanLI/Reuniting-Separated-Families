import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll } from './helpers';

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
]) {
  test(`FND-02 home and nested-route reload at ${viewport.width}px`, async ({ browser }) => {
    const context = await browser.newContext({ viewport });
    // Record any attempt to use device location.
    await context.addInitScript(() => {
      const mark = () => {
        (window as unknown as { __geo?: boolean }).__geo = true;
      };
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition = mark as never;
        navigator.geolocation.watchPosition = (() => {
          mark();
          return 0;
        }) as never;
      }
    });
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.getByText('Demo - fictional data only')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.goto('/help');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'How this works, and its limits' })).toBeVisible();
    await expect(page.getByText('Demo - fictional data only')).toBeVisible();
    await expectNoHorizontalScroll(page);
    // No browser location permission is requested anywhere.
    const geoRequested = await page.evaluate(() => (window as unknown as { __geo?: boolean }).__geo === true);
    expect(geoRequested).toBe(false);
    await context.close();
  });
}

test('FND-02 readiness endpoint reports the database', async ({ request }) => {
  const res = await request.get('/api/health/ready');
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ status: 'ready', checks: { database: 'ok' } });
});

test('FND-03 served HTML and assets contain no secret sentinels', async ({ request }) => {
  const sentinels = (process.env.E2E_SENTINELS ?? '').split(',').filter(Boolean);
  expect(sentinels.length).toBeGreaterThanOrEqual(3);
  const html = await (await request.get('/')).text();
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]!);
  expect(assets.length).toBeGreaterThan(0);
  const bodies = [html];
  for (const a of assets) bodies.push(await (await request.get(a)).text());
  bodies.push(await (await request.get('/api/health/ready')).text());
  bodies.push(await (await request.get('/api/v1/does-not-exist')).text());
  for (const body of bodies) {
    for (const s of sentinels) {
      expect(body).not.toContain(s);
      expect(body).not.toContain(Buffer.from(s, 'base64').toString('utf8').slice(0, 20));
    }
    expect(body).not.toContain('DATABASE_URL');
    expect(body).not.toContain('postgresql://');
  }
});
