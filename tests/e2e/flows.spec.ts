import { expect, test, type Page } from '@playwright/test';
import { demoSecret } from '../../prisma/fixtures';
import { apiAs, newActor, register, SEED_SECRET, signIn, signInStaff, uniqueName } from './helpers';

/** The worker delivers asynchronously; reload until the expected text appears. */
async function reloadUntil(page: Page, check: () => Promise<void>, timeout = 20_000) {
  await expect(async () => {
    await page.reload();
    await check();
  }).toPass({ timeout, intervals: [500, 1000, 2000] });
}

async function getContactCode(page: Page): Promise<string> {
  await page.goto('/privacy');
  await page.getByRole('button', { name: /Create contact code|Replace contact code/ }).click();
  return ((await page.getByLabel('Your contact code (shown once)').textContent()) ?? '').trim();
}

test('FLOW-01/PRIV-04 code request, exact-preview safety answer, then revocation, in separate browser contexts', async ({ browser }) => {
  const recipient = await newActor(browser);
  const requester = await newActor(browser, { width: 390, height: 844 });
  await register(recipient.page, uniqueName('rcp'), 'Rory (fictional)');
  await register(requester.page, uniqueName('req'), 'Quinn (fictional)');
  const code = await getContactCode(recipient.page);

  await requester.page.goto('/requests/new');
  await requester.page.getByLabel('Contact code', { exact: true }).fill(code);
  await requester.page.getByLabel('Introduction').fill('Quinn here, your cousin. E2E_SENTINEL_INTRO');
  await expect(requester.page.getByRole('region', { name: 'What they will see if it reaches them' })).toContainText('Quinn (fictional)');
  await requester.page.getByRole('button', { name: 'Send private request' }).click();
  await expect(requester.page.getByRole('heading', { name: 'Request saved' })).toBeVisible();
  await expect(requester.page.getByText(/never say whether a code matched/)).toBeVisible();
  // Status badges are matched exactly: the page's explanation also contains the words "response available".
  await requester.page.goto('/requests/outgoing');
  await expect(requester.page.getByText('No response available yet', { exact: true })).toBeVisible();
  await expect(requester.page.getByText('Response available', { exact: true })).toHaveCount(0);

  await recipient.page.goto('/requests/incoming');
  await reloadUntil(recipient.page, () => expect(recipient.page.getByText('E2E_SENTINEL_INTRO')).toBeVisible());
  await recipient.page.getByRole('button', { name: 'Answer' }).click();
  await recipient.page.getByLabel('Short note (optional)').fill('With a friend. E2E_SENTINEL_NOTE');
  const preview = recipient.page.getByRole('region', { name: /Exactly what Quinn \(fictional\) will see/ });
  await expect(preview).toContainText('I am OK.');
  await expect(preview).toContainText('E2E_SENTINEL_NOTE');
  await expect(preview).toContainText('No location is included.');
  await recipient.page.screenshot({ path: 'evidence/screenshots/respond-preview-1280.png', fullPage: true });
  await recipient.page.getByRole('button', { name: 'Review and share' }).click();
  await recipient.page.getByRole('button', { name: /Confirm: share with Quinn/ }).click();
  await expect(recipient.page.getByText('Answered', { exact: true })).toBeVisible();

  await requester.page.goto('/requests/outgoing');
  await reloadUntil(requester.page, () => expect(requester.page.getByText('Response available', { exact: true })).toBeVisible());
  await requester.page.getByRole('link', { name: 'View response' }).click();
  await expect(requester.page.getByText('E2E_SENTINEL_NOTE')).toBeVisible();
  await expect(requester.page.getByText('No location is included.')).toBeVisible();
  await requester.page.screenshot({ path: 'evidence/screenshots/response-view-390.png', fullPage: true });
  const responseUrl = requester.page.url();
  // Nothing private is written to web storage.
  const storage = await requester.page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  expect(storage).not.toContain('E2E_SENTINEL');

  // The recipient revokes; the requester's next load shows nothing.
  await recipient.page.goto('/sharing');
  await recipient.page.getByRole('button', { name: 'Revoke', exact: true }).click();
  await expect(recipient.page.getByText('Revoked', { exact: true })).toBeVisible();
  await requester.page.goto(responseUrl);
  await expect(requester.page.getByRole('heading', { name: 'This answer is not available' })).toBeVisible();
  await expect(requester.page.getByText('E2E_SENTINEL_NOTE')).toHaveCount(0);
  const direct = await apiAs(requester.page, 'GET', `/responses/${responseUrl.split('/').pop()}`);
  expect(direct.status).toBe(404);

  // An outsider following the same URL sees nothing.
  const outsider = await newActor(browser);
  await register(outsider.page, uniqueName('out'), 'Outsider');
  await outsider.page.goto(responseUrl);
  await expect(outsider.page.getByRole('heading', { name: 'This answer is not available' })).toBeVisible();
  await Promise.all([recipient.context.close(), requester.context.close(), outsider.context.close()]);
});

test('FLOW-05 Sam, without account or device, sends a request and reads the answer through W-A', async ({ browser }) => {
  const leo = await newActor(browser);
  await signIn(leo.page, 'leo');
  const code = await getContactCode(leo.page);

  const wa = await newActor(browser);
  await signInStaff(wa.page, 'worker.a');
  await wa.page.getByRole('link', { name: /^Sam/ }).click();
  await wa.page.getByLabel('Assistance secret').fill(demoSecret(SEED_SECRET, 'assist:sam'));
  await wa.page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(wa.page.getByRole('heading', { name: 'Verified for this visit', exact: true })).toBeVisible();
  await wa.page.getByRole('button', { name: 'Send a request for Sam' }).click();
  await wa.page.getByLabel('Contact code', { exact: true }).fill(code);
  await wa.page.getByLabel('Introduction').fill('Sam is at Riverside and asked us to send this. E2E_SAM');
  await wa.page.getByRole('button', { name: 'Send private request' }).click();
  await expect(wa.page.getByText('E2E_SAM').first()).toBeVisible();

  await leo.page.goto('/requests/incoming');
  await reloadUntil(leo.page, () => expect(leo.page.getByText('E2E_SAM')).toBeVisible());
  const card = leo.page.getByRole('article').filter({ hasText: 'E2E_SAM' });
  await card.getByRole('button', { name: 'Answer' }).click();
  await leo.page.getByLabel('Message and the approximate area of one check-in').check();
  await leo.page.getByLabel('Which check-in').selectOption({ index: 1 });
  await expect(leo.page.getByRole('region', { name: /Exactly what Sam will see/ })).toContainText('Area:');
  await leo.page.getByRole('button', { name: 'Review and share' }).click();
  await leo.page.getByRole('button', { name: /Confirm: share with Sam/ }).click();

  await reloadUntil(wa.page, () => expect(wa.page.getByRole('link', { name: 'View answer with the person' }).first()).toBeVisible());
  await wa.page.getByRole('link', { name: 'View answer with the person' }).first().click();
  await expect(wa.page.getByRole('heading', { name: /Answer from Leo/ })).toBeVisible();
  await expect(wa.page.getByText('Shared with the person you are assisting')).toBeVisible();
  await Promise.all([leo.context.close(), wa.context.close()]);
});

test('FLOW-06 no-code request: coordinator assigns, worker proposes, recipient decides; requester never sees candidates', async ({ browser }) => {
  const maya = await newActor(browser);
  await signIn(maya.page, 'maya');
  await maya.page.goto('/requests/new');
  await maya.page.getByLabel('Without a code: ask one shelter’s team to help').check();
  await maya.page.getByLabel('Clues for the shelter team (optional)').fill('My sister Ana, grey cap. E2E_ROUTED');
  await maya.page.getByLabel('Shelter they might be at (optional)').selectOption({ label: 'Hillcrest School Gym' });
  await maya.page.getByLabel(/I agree that the clues may be shared with Hillcrest School Gym/).check();
  await maya.page.getByLabel('Introduction').fill('Maya looking for Ana. E2E_ROUTED_INTRO');
  await maya.page.getByRole('button', { name: 'Send private request' }).click();
  await expect(maya.page.getByRole('heading', { name: 'Request saved' })).toBeVisible();

  const cb = await newActor(browser);
  await signInStaff(cb.page, 'coord.b');
  const row = cb.page.getByRole('listitem').filter({ hasText: 'E2E_ROUTED' });
  await row.getByLabel('Worker').selectOption({ label: 'worker.b' });
  await row.getByRole('button', { name: 'Assign matching task' }).click();
  await expect(cb.page.getByText('Assigned to worker.b')).toBeVisible();

  const wb = await newActor(browser);
  await signInStaff(wb.page, 'worker.b');
  await wb.page.getByRole('link', { name: 'Open matching task' }).first().click();
  await expect(wb.page.getByText('E2E_ROUTED')).toBeVisible();
  await expect(wb.page.getByText('Bo', { exact: true })).toHaveCount(0);
  await wb.page.getByRole('button', { name: 'Propose Ana' }).click();
  await wb.page.getByRole('button', { name: 'Confirm: deliver request to Ana' }).click();
  await expect(wb.page.getByRole('heading', { name: 'Staff work' })).toBeVisible();

  // Maya's view stays neutral and she has no access to the staff task.
  await maya.page.goto('/requests/outgoing');
  await expect(maya.page.getByRole('listitem').filter({ hasText: 'E2E_ROUTED_INTRO' })).toContainText('No response available yet');

  await wb.page.getByRole('link', { name: /^Ana/ }).click();
  await wb.page.getByLabel('Assistance secret').fill(demoSecret(SEED_SECRET, 'assist:ana'));
  await wb.page.getByRole('button', { name: 'Verify', exact: true }).click();
  await reloadUntil(wb.page, () => expect(wb.page.getByText('E2E_ROUTED_INTRO')).toBeVisible());
  const card = wb.page.getByRole('article').filter({ hasText: 'E2E_ROUTED_INTRO' });
  await card.getByRole('button', { name: 'Answer' }).click();
  await wb.page.getByLabel('Message and the named shelter of one check-in').check();
  await wb.page.getByLabel('Which check-in').selectOption({ index: 1 });
  await wb.page.getByRole('button', { name: 'Review and share' }).click();
  await wb.page.getByRole('button', { name: /Confirm: share with Maya/ }).click();

  await reloadUntil(maya.page, () => expect(maya.page.getByRole('listitem').filter({ hasText: 'E2E_ROUTED_INTRO' })).toContainText('Response available'));
  await maya.page.getByRole('listitem').filter({ hasText: 'E2E_ROUTED_INTRO' }).getByRole('link', { name: 'View response' }).click();
  await expect(maya.page.getByRole('heading', { name: 'Answer from Ana' })).toBeVisible();
  await expect(maya.page.getByText('Hillcrest School Gym').first()).toBeVisible();
  await Promise.all([maya.context.close(), cb.context.close(), wb.context.close()]);
});

test('UX-03 failed submissions are marked not submitted, keep the draft in memory only, and retry once', async ({ browser }) => {
  const { context, page } = await newActor(browser);
  await register(page, uniqueName('net'), 'Net Tester');
  await page.goto('/requests/new');
  await page.getByLabel('Contact code', { exact: true }).fill('0000-0000-0000-0000-0000-0000-00');
  await page.getByLabel('Introduction').fill('E2E_OFFLINE_DRAFT');
  await page.route('**/api/v1/requests', (route) => route.abort('internetdisconnected'));
  await page.getByRole('button', { name: 'Send private request' }).click();
  await expect(page.getByRole('alert')).toContainText('Not submitted');
  await expect(page.getByLabel('Introduction')).toHaveValue('E2E_OFFLINE_DRAFT');
  await page.unroute('**/api/v1/requests');
  await page.route('**/api/v1/requests', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"INTERNAL","message":"x"}}' }));
  await page.getByRole('button', { name: 'Send private request' }).click();
  await expect(page.getByRole('alert')).toContainText('Not submitted');
  await expect(page.getByRole('heading', { name: 'Request saved' })).toHaveCount(0);
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  expect(storage).not.toContain('E2E_OFFLINE_DRAFT');
  await page.unroute('**/api/v1/requests');
  await page.getByRole('button', { name: 'Send private request' }).click();
  await expect(page.getByRole('heading', { name: 'Request saved' })).toBeVisible();
  const outgoing = JSON.parse((await apiAs(page, 'GET', '/requests/outgoing')).body);
  expect(outgoing.requests.filter((r: { introduction: string }) => r.introduction === 'E2E_OFFLINE_DRAFT')).toHaveLength(1);
  await context.close();
});

test('UX-04 account switch on a shared device shows nothing from the previous person', async ({ browser }) => {
  const { context, page } = await newActor(browser);
  await signIn(page, 'leo');
  await page.goto('/check-ins');
  await expect(page.getByText('Hillcrest School Gym').first()).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'You have signed out' })).toBeVisible();
  await signIn(page, 'noor');
  await page.goto('/check-ins');
  await expect(page.getByRole('heading', { name: 'Your check-ins' })).toBeVisible();
  await expect(page.getByText('Hillcrest School Gym')).toHaveCount(0);
  await page.goBack();
  await page.goBack();
  await expect(page.getByText('Leo (Maya’s brother)')).toHaveCount(0);
  await context.close();
});

test('UX-05 empty and declined states use neutral wording with no hidden-person hints', async ({ browser }) => {
  const requester = await newActor(browser);
  const recipient = await newActor(browser);
  await register(requester.page, uniqueName('ux5a'), 'Avery (fictional)');
  await register(recipient.page, uniqueName('ux5b'), 'Blake (fictional)');
  for (const [path, text] of [
    ['/requests/incoming', 'No requests have reached you.'],
    ['/requests/outgoing', 'You have not sent any requests.'],
    ['/sharing', 'You have not shared anything.'],
    ['/shared', 'Nothing is shared with you right now.'],
    ['/check-ins', 'No check-ins yet.'],
  ] as const) {
    await requester.page.goto(path);
    await expect(requester.page.getByText(text)).toBeVisible();
  }
  const code = await getContactCode(recipient.page);
  await requester.page.goto('/requests/new');
  await requester.page.getByLabel('Contact code', { exact: true }).fill(code);
  await requester.page.getByLabel('Introduction').fill('UX5 hello there');
  await requester.page.getByRole('button', { name: 'Send private request' }).click();
  await expect(requester.page.getByRole('heading', { name: 'Request saved' })).toBeVisible();

  await recipient.page.goto('/requests/incoming');
  await reloadUntil(recipient.page, () => expect(recipient.page.getByText('UX5 hello there')).toBeVisible());
  await recipient.page.getByRole('button', { name: 'Decline privately' }).click();
  await expect(recipient.page.getByText('Declined (they were not told)')).toBeVisible();

  await requester.page.goto('/requests/outgoing');
  const item = requester.page.getByRole('listitem').filter({ hasText: 'UX5 hello there' });
  await expect(item).toContainText('No response available yet');
  await expect(item).not.toContainText(/declin|blocked|found|read|Blake/i);
  await Promise.all([requester.context.close(), recipient.context.close()]);
});

test('UX-04 a session that ends mid-form leads to a clear sign-in path and shows no previous data', async ({ browser }) => {
  const { context, page } = await newActor(browser);
  await signIn(page, 'leo');
  await page.goto('/check-ins');
  await expect(page.getByText('Hillcrest School Gym').first()).toBeVisible();
  await page.getByRole('button', { name: 'Add a check-in' }).click();
  await page.getByLabel('Shelter', { exact: true }).selectOption({ index: 1 });
  await context.clearCookies(); // the server-side session can no longer be presented (as after expiry)
  await page.getByRole('button', { name: 'Save check-in' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByText('Your session ended')).toBeVisible();
  await expect(page.getByText('Hillcrest School Gym')).toHaveCount(0);
  await page.goBack();
  await expect(page.getByText('Leo (Maya’s brother)')).toHaveCount(0);
  await context.close();
});

test('SEC-02 script-like text from another person renders as inert text', async ({ browser }) => {
  const requester = await newActor(browser);
  const recipient = await newActor(browser);
  await register(requester.page, uniqueName('xssa'), '<b>Bold</b> alias');
  await register(recipient.page, uniqueName('xssb'), 'Target');
  let dialogs = 0;
  recipient.page.on('dialog', async (d) => {
    dialogs++;
    await d.dismiss();
  });
  const code = await getContactCode(recipient.page);
  const payload = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
  await requester.page.goto('/requests/new');
  await requester.page.getByLabel('Contact code', { exact: true }).fill(code);
  await requester.page.getByLabel('Introduction').fill(payload);
  await requester.page.getByRole('button', { name: 'Send private request' }).click();
  await expect(requester.page.getByRole('heading', { name: 'Request saved' })).toBeVisible();
  await recipient.page.goto('/requests/incoming');
  await reloadUntil(recipient.page, () => expect(recipient.page.getByText(payload)).toBeVisible());
  await expect(recipient.page.getByText('From <b>Bold</b> alias')).toBeVisible();
  expect(await recipient.page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  expect(await recipient.page.locator('main img').count()).toBe(0);
  expect(dialogs).toBe(0);
  await Promise.all([requester.context.close(), recipient.context.close()]);
});
