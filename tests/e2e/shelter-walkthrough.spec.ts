import { expect, test, type Page } from '@playwright/test';
import { newActor, signInStaff, uniqueName } from './helpers';

// The automated twin of docs/shelter-walkthrough.md (parts B-D): two people without devices,
// at two shelters, reach each other first with a paper contact code and then with no code at all.
// Every action goes through shelter staff in separate browser contexts.

async function reloadUntil(page: Page, check: () => Promise<void>, timeout = 20_000) {
  await expect(async () => {
    await page.reload();
    await check();
  }).toPass({ timeout, intervals: [500, 1000, 2000] });
}

/** Opens a case from the staff list and verifies the person if this visit is not verified yet. */
async function openVerifiedCase(page: Page, alias: string, assistanceSecret: string) {
  await page.goto('/staff');
  await page.getByRole('link', { name: new RegExp(`^${alias}`) }).click();
  await expect(page.getByRole('heading', { level: 2, name: /^(Verify the person for this visit|Verified for this visit)$/ })).toBeVisible();
  if (await page.getByLabel('Assistance secret').isVisible()) {
    await page.getByLabel('Assistance secret').fill(assistanceSecret);
    await page.getByRole('button', { name: 'Verify', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: 'Verified for this visit', exact: true })).toBeVisible();
}

async function intake(page: Page, alias: string, opts: { matchingClue?: string; contactCode?: boolean }) {
  await page.goto('/staff/intake');
  await page.getByLabel('Name the person wants to use').fill(alias);
  if (opts.matchingClue) {
    await page.getByLabel('Contact code and shelter-assisted matching').check();
    await page.getByLabel('Distinguishing clue for matching (optional)').fill(opts.matchingClue);
  }
  if (opts.contactCode) await page.getByLabel('Create a contact code the person can give to family').check();
  await page.getByLabel('The person agreed to this intake after I explained what is recorded').check();
  await page.getByRole('button', { name: 'Save intake' }).click();
  await expect(page.getByRole('heading', { name: 'Intake saved' })).toBeFocused();
  const secret = ((await page.getByLabel('Assistance secret').textContent()) ?? '').trim();
  const code = opts.contactCode ? ((await page.getByLabel('Contact code for the person to share with family (shown once)').textContent()) ?? '').trim() : '';
  return { secret, code };
}

test('FLOW-05/FLOW-06 two people without devices at two shelters: paper contact code, then no code', async ({ browser }) => {
  const rosa = `Rosa ${uniqueName('demo').split('.')[1]}`;
  const tomas = `Tomas ${uniqueName('demo').split('.')[1]}`;
  const wa = await newActor(browser);
  const wb = await newActor(browser);
  await signInStaff(wa.page, 'worker.a');
  await signInStaff(wb.page, 'worker.b');

  // B. Intake: Rosa at Riverside gets a contact code on paper; Tomas at Hillcrest opts into matching.
  const rosaPaper = await intake(wa.page, rosa, { contactCode: true });
  const tomasPaper = await intake(wb.page, tomas, { matchingClue: 'Sister Rosa, grey cap' });
  expect(rosaPaper.code).not.toBe('');

  // C. Tomas's worker sends a request with Rosa's paper code; Rosa answers at her next verified visit.
  await openVerifiedCase(wb.page, tomas, tomasPaper.secret);
  await wb.page.getByRole('button', { name: `Send a request for ${tomas}` }).click();
  await wb.page.getByLabel('Contact code', { exact: true }).fill(rosaPaper.code);
  await wb.page.getByLabel('Introduction').fill(`${tomas} here, at Hillcrest. WALK_CODE`);
  await wb.page.getByRole('button', { name: 'Send private request' }).click();
  await expect(wb.page.getByText('WALK_CODE').first()).toBeVisible();

  await openVerifiedCase(wa.page, rosa, rosaPaper.secret);
  await reloadUntil(wa.page, () => expect(wa.page.getByRole('article').filter({ hasText: 'WALK_CODE' })).toBeVisible());
  const codeCard = wa.page.getByRole('article').filter({ hasText: 'WALK_CODE' });
  await codeCard.getByRole('button', { name: 'Answer' }).click();
  await wa.page.getByLabel('Message and the named shelter of one check-in').check();
  await wa.page.getByLabel('Which check-in').selectOption({ index: 1 });
  await expect(wa.page.getByRole('region', { name: new RegExp(`Exactly what ${tomas} will see`) })).toContainText('Riverside Community Center');
  await wa.page.getByRole('button', { name: 'Review and share' }).click();
  await wa.page.getByRole('button', { name: new RegExp(`Confirm: share with ${tomas}`) }).click();

  await openVerifiedCase(wb.page, tomas, tomasPaper.secret);
  await reloadUntil(wb.page, () => expect(wb.page.getByRole('link', { name: 'View answer with the person' }).first()).toBeVisible());
  await wb.page.getByRole('link', { name: 'View answer with the person' }).first().click();
  await expect(wb.page.getByRole('heading', { name: new RegExp(`Answer from ${rosa}`) })).toBeVisible();
  await expect(wb.page.getByText('Riverside Community Center').first()).toBeVisible();

  // D. No code: Rosa asks Hillcrest's team to look for her brother; the coordinator assigns worker.b,
  // who proposes Tomas; Tomas decides at his next visit; Rosa's worker sees only the answer.
  await openVerifiedCase(wa.page, rosa, rosaPaper.secret);
  await wa.page.getByRole('button', { name: `Send a request for ${rosa}` }).click();
  await wa.page.getByLabel('Without a code: ask one shelter’s team to help').check();
  await wa.page.getByLabel('Clues for the shelter team (optional)').fill('Brother Tomas, grey cap. WALK_CLUE');
  await wa.page.getByLabel('Shelter they might be at (optional)').selectOption({ label: 'Hillcrest School Gym' });
  await wa.page.getByLabel(/The person agrees that the clues may be shared with Hillcrest School Gym/).check();
  await wa.page.getByLabel('Introduction').fill(`${rosa} looking for her brother. WALK_ROUTED`);
  await wa.page.getByRole('button', { name: 'Send private request' }).click();
  await expect(wa.page.getByText('WALK_ROUTED').first()).toBeVisible();

  const cb = await newActor(browser);
  await signInStaff(cb.page, 'coord.b');
  const task = cb.page.getByRole('listitem').filter({ hasText: 'WALK_CLUE' });
  await task.getByLabel('Worker').selectOption({ label: 'worker.b' });
  await task.getByRole('button', { name: 'Assign matching task' }).click();
  await expect(cb.page.getByText('Assigned to worker.b')).toBeVisible();

  await wb.page.goto('/staff');
  await reloadUntil(wb.page, () => expect(wb.page.getByRole('link', { name: 'Open matching task' }).first()).toBeVisible());
  await wb.page.getByRole('link', { name: 'Open matching task' }).first().click();
  await expect(wb.page.getByText('WALK_CLUE')).toBeVisible();
  await wb.page.getByRole('button', { name: `Propose ${tomas}` }).click();
  await wb.page.getByRole('button', { name: `Confirm: deliver request to ${tomas}` }).click();
  await expect(wb.page.getByRole('heading', { name: 'Staff work' })).toBeVisible();

  // Before Tomas decides, Rosa's side learns nothing: not who was proposed, not whether anyone matched.
  await openVerifiedCase(wa.page, rosa, rosaPaper.secret);
  const routedSent = wa.page.getByRole('listitem').filter({ hasText: 'WALK_ROUTED' });
  await expect(routedSent).toContainText('No response available yet');
  await expect(routedSent).not.toContainText(tomas);

  await openVerifiedCase(wb.page, tomas, tomasPaper.secret);
  await reloadUntil(wb.page, () => expect(wb.page.getByRole('article').filter({ hasText: 'WALK_ROUTED' })).toBeVisible());
  const routedCard = wb.page.getByRole('article').filter({ hasText: 'WALK_ROUTED' });
  await routedCard.getByRole('button', { name: 'Answer' }).click();
  await wb.page.getByLabel('A message only').check();
  await wb.page.getByRole('button', { name: 'Review and share' }).click();
  await wb.page.getByRole('button', { name: new RegExp(`Confirm: share with ${rosa}`) }).click();

  await openVerifiedCase(wa.page, rosa, rosaPaper.secret);
  await reloadUntil(wa.page, () => expect(routedSent).toContainText('Response available'));
  await Promise.all([wa.context.close(), wb.context.close(), cb.context.close()]);
});
