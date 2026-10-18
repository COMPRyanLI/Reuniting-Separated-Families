import { expect, test, type Page } from '@playwright/test';
import { apiAs, newActor, register, signIn, signInStaff, uniqueName } from './helpers';

/** Browser-level versions of manual-guide sections 14-16 and 19, each on fresh fictional records. */

async function intake(page: Page, alias: string, opts: { restricted?: boolean } = {}) {
  await page.goto('/staff/intake');
  await page.getByLabel('Name the person wants to use').fill(alias);
  if (opts.restricted) await page.getByLabel(/restricted referral/).check();
  await page.getByLabel(/The person agreed to this intake/).check();
  await page.getByRole('button', { name: 'Save intake' }).click();
  await expect(page.getByRole('heading', { name: 'Intake saved' })).toBeVisible();
  const reference = ((await page.locator('.card .secret-box').first().textContent()) ?? '').trim();
  const secret = opts.restricted ? null : ((await page.getByLabel('Assistance secret').textContent()) ?? '').trim();
  await page.getByRole('link', { name: 'Open the case' }).click();
  await expect(page.getByText(`Acting for: ${alias}`)).toBeVisible();
  return { reference, secret, caseUrl: page.url() };
}

test('AUTH-04 browser recovery: rotated and foreign secrets fail, current secret works once, old sessions end', async ({ browser }) => {
  const a = await newActor(browser);
  const username = uniqueName('rec');
  const { secret: firstSecret, password } = await register(a.page, username, 'Recovery Person');
  const code = await (async () => {
    await a.page.goto('/privacy');
    await a.page.getByRole('button', { name: 'Create contact code' }).click();
    return ((await a.page.getByLabel('Your contact code (shown once)').textContent()) ?? '').trim();
  })();

  // Replace the recovery secret: wrong password refused, correct one shows a new secret once.
  await a.page.goto('/account');
  await a.page.getByLabel('Confirm your password').first().fill('not my password at all');
  await a.page.getByRole('button', { name: 'Replace recovery secret' }).click();
  await expect(a.page.getByRole('alert')).toContainText('password is not correct');
  await a.page.getByLabel('Confirm your password').first().fill(password);
  await a.page.getByRole('button', { name: 'Replace recovery secret' }).click();
  const current = ((await a.page.getByLabel('Your new recovery secret (shown once)').textContent()) ?? '').trim();
  expect(current).not.toBe(firstSecret);

  const b = await newActor(browser);
  const tryRecover = async (secretValue: string, newPassword: string) => {
    await b.page.goto('/recover');
    await b.page.getByLabel('Username').fill(username);
    await b.page.getByLabel('Recovery secret').fill(secretValue);
    await b.page.getByLabel('New password').fill(newPassword);
    await b.page.getByRole('button', { name: 'Set new password' }).click();
  };
  for (const wrong of [firstSecret, code]) {
    await tryRecover(wrong, 'attacker passphrase 1');
    await expect(b.page.getByRole('alert')).toContainText('Could not recover the account');
  }
  await tryRecover(current, 'brand new passphrase 2');
  await expect(b.page.getByRole('heading', { name: 'Password changed' })).toBeVisible();
  const issued = ((await b.page.getByLabel('Your new recovery secret').textContent()) ?? '').trim();
  expect(issued).not.toBe(current);
  await b.page.getByLabel('I have written down my new recovery secret').check();
  await b.page.getByRole('button', { name: 'Continue' }).click();
  await expect(b.page.getByRole('heading', { name: /Hello, Recovery Person/ })).toBeVisible();

  // The first browser's session was revoked by the recovery.
  expect((await apiAs(a.page, 'GET', '/me')).status).toBe(401);
  const c = await newActor(browser);
  await signIn(c.page, username, password, { expectSuccess: false });
  await expect(c.page.getByRole('alert')).toBeVisible();
  await signIn(c.page, username, 'brand new passphrase 2');
  // Replaying the consumed secret fails.
  await tryRecover(current, 'another passphrase 3');
  await expect(b.page.getByRole('alert')).toContainText('Could not recover the account');
  await Promise.all([a.context.close(), b.context.close(), c.context.close()]);
});

test('STAFF-07 browser transfer: proposal needs the person’s choice, destination verifies, source loses access', async ({ browser }) => {
  const wa = await newActor(browser);
  await signInStaff(wa.page, 'worker.a');
  const alias = `Transfer ${uniqueName('t')}`;
  const { secret, caseUrl } = await intake(wa.page, alias);

  const transfer = wa.page.getByRole('region', { name: 'Move this case to another shelter' });
  await transfer.getByLabel('Destination shelter').selectOption({ label: 'Hillcrest School Gym' });
  await transfer.getByRole('button', { name: 'Propose transfer' }).click();
  await expect(wa.page.getByRole('alert')).toContainText('Confirm the person chose this transfer');
  await transfer.getByLabel('The person chose to move their case there').check();
  await transfer.getByRole('button', { name: 'Propose transfer' }).click();
  await expect(transfer).toContainText('A transfer is waiting for the destination');

  const cb = await newActor(browser);
  await signInStaff(cb.page, 'coord.b');
  const row = cb.page.getByRole('listitem').filter({ hasText: alias });
  await expect(row).toBeVisible();
  // Only the summary is visible before acceptance: no check-ins or messages.
  await expect(row).not.toContainText('Last reported');
  await row.getByLabel('Assign to').selectOption({ label: 'worker.b' });
  await row.getByLabel('Person’s assistance secret').fill('WRONG-0000-0000-0000-0000-0000-00');
  await row.getByRole('button', { name: 'Verify and accept transfer' }).click();
  await expect(row.getByRole('alert')).toContainText('not accepted');
  await row.getByLabel('Person’s assistance secret').fill(secret!);
  await row.getByRole('button', { name: 'Verify and accept transfer' }).click();
  await expect(cb.page.getByRole('listitem').filter({ hasText: alias })).toHaveCount(0);

  // Source access ends; the destination worker must verify the person again.
  await wa.page.goto(caseUrl);
  await expect(wa.page.getByRole('heading', { name: 'Case not available' })).toBeVisible();
  const wb = await newActor(browser);
  await signInStaff(wb.page, 'worker.b');
  await wb.page.getByRole('link', { name: new RegExp(`^${alias}`) }).click();
  await expect(wb.page.getByRole('heading', { name: 'Verify the person for this visit', exact: true })).toBeVisible();
  await expect(wb.page.getByRole('heading', { name: 'Check-ins' })).toHaveCount(0);
  await wb.page.getByLabel('Assistance secret').fill(secret!);
  await wb.page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(wb.page.getByRole('heading', { name: 'Check-ins' })).toBeVisible();
  await Promise.all([wa.context.close(), cb.context.close(), wb.context.close()]);
});

test('STAFF-03/PRIV-08 browser restricted referral, coordinator assignment without access, and case closure', async ({ browser }) => {
  const wa = await newActor(browser);
  await signInStaff(wa.page, 'worker.a');
  await wa.page.goto('/staff/intake');
  const restrictedAlias = `Restricted ${uniqueName('r')}`;
  await wa.page.getByLabel('Name the person wants to use').fill(restrictedAlias);
  await wa.page.getByLabel(/restricted referral/).check();
  // The ordinary sharing options disappear for a restricted referral.
  await expect(wa.page.getByText('Who may send this person requests?')).toHaveCount(0);
  await wa.page.getByLabel(/The person agreed to this intake/).check();
  await wa.page.getByRole('button', { name: 'Save intake' }).click();
  await expect(wa.page.getByText('Restricted referral recorded')).toBeVisible();
  await expect(wa.page.getByLabel('Assistance secret')).toHaveCount(0);
  await wa.page.getByRole('link', { name: 'Open the case' }).click();
  await expect(wa.page.getByRole('heading', { name: 'Restricted referral' })).toBeVisible();
  for (const tool of ['Record a check-in', /^Send a request for/, 'Create contact code', 'Propose transfer']) {
    await expect(wa.page.getByRole('button', { name: tool })).toHaveCount(0);
  }

  // An ordinary disposable case: W-A2 is denied until assigned; the assigning coordinator gets no access.
  const ordinary = await intake(wa.page, `Ordinary ${uniqueName('o')}`);
  const wa2 = await newActor(browser);
  await signInStaff(wa2.page, 'worker.a2');
  await wa2.page.goto(ordinary.caseUrl);
  await expect(wa2.page.getByRole('heading', { name: 'Case not available' })).toBeVisible();
  const ca = await newActor(browser);
  await signInStaff(ca.page, 'coord.a');
  const allocation = ca.page.getByRole('row').filter({ hasText: ordinary.reference });
  await expect(allocation).not.toContainText('Ordinary');
  await allocation.getByLabel(/Staff member for/).selectOption({ label: 'worker.a2 (worker)' });
  await allocation.getByRole('button', { name: 'Assign' }).click();
  await expect(ca.page.getByRole('status')).toContainText(`Assigned ${ordinary.reference}`);
  expect((await apiAs(ca.page, 'GET', `/staff/cases/${ordinary.caseUrl.split('/').pop()}`)).status).toBe(404);
  await wa2.page.reload();
  await expect(wa2.page.getByRole('heading', { name: 'Verify the person for this visit', exact: true })).toBeVisible();
  await expect(wa2.page.getByRole('heading', { name: 'Check-ins' })).toHaveCount(0);

  // Coordinator closes the case; ordinary assistance ends for everyone.
  await ca.page.reload();
  await ca.page.getByRole('row').filter({ hasText: ordinary.reference }).getByRole('button', { name: 'Close case' }).click();
  await expect(ca.page.getByRole('status')).toContainText(`Closed ${ordinary.reference}`);
  await wa.page.goto(ordinary.caseUrl);
  await expect(wa.page.getByRole('heading', { name: 'Case not available' })).toBeVisible();
  await Promise.all([wa.context.close(), wa2.context.close(), ca.context.close()]);
});

test('DATA-01 browser deletion: wrong password keeps the account; deletion ends access and the shared answer', async ({ browser }) => {
  const subject = await newActor(browser);
  const username = uniqueName('del');
  const { password } = await register(subject.page, username, 'Deletable Person');
  await subject.page.goto('/check-ins');
  await subject.page.getByRole('button', { name: 'Add a check-in' }).click();
  await subject.page.getByLabel('Shelter', { exact: true }).selectOption({ label: 'Lakeside Church Hall (Lakeside)' });
  await subject.page.getByRole('button', { name: 'Save check-in' }).click();
  await expect(subject.page.getByRole('article').first()).toBeVisible();
  await subject.page.goto('/privacy');
  await subject.page.getByRole('button', { name: 'Create contact code' }).click();
  const code = ((await subject.page.getByLabel('Your contact code (shown once)').textContent()) ?? '').trim();

  const requester = await newActor(browser);
  await register(requester.page, uniqueName('delreq'), 'Requester of Deletable');
  await requester.page.goto('/requests/new');
  await requester.page.getByLabel('Contact code', { exact: true }).fill(code);
  await requester.page.getByLabel('Introduction').fill('Before deletion E2E_DEL');
  await requester.page.getByRole('button', { name: 'Send private request' }).click();
  await subject.page.goto('/requests/incoming');
  await expect(async () => {
    await subject.page.reload();
    await expect(subject.page.getByText('E2E_DEL')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await subject.page.getByRole('button', { name: 'Answer' }).click();
  await subject.page.getByRole('button', { name: 'Review and share' }).click();
  await subject.page.getByRole('button', { name: /Confirm: share with/ }).click();
  await requester.page.goto('/requests/outgoing');
  await expect(async () => {
    await requester.page.reload();
    await expect(requester.page.getByRole('link', { name: 'View response' })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await requester.page.getByRole('link', { name: 'View response' }).click();
  await expect(requester.page.getByRole('heading', { name: /Answer from Deletable Person/ })).toBeVisible();
  const shareUrl = requester.page.url();

  await subject.page.goto('/account');
  const del = subject.page.getByRole('region', { name: 'Delete your account and information' });
  await del.getByRole('button', { name: 'Delete my account' }).click();
  await del.getByRole('button', { name: 'Cancel' }).click();
  await del.getByRole('button', { name: 'Delete my account' }).click();
  await del.getByLabel('Confirm your password').fill('wrong password here');
  await del.getByRole('button', { name: 'Permanently delete' }).click();
  await expect(del.getByRole('alert')).toBeVisible();
  expect((await apiAs(subject.page, 'GET', '/me')).status).toBe(200);
  await del.getByLabel('Confirm your password').fill(password);
  await del.getByRole('button', { name: 'Permanently delete' }).click();
  await expect(subject.page.getByRole('heading', { name: 'You have signed out' })).toBeVisible();
  expect((await apiAs(subject.page, 'GET', '/me')).status).toBe(401);

  await requester.page.goto(shareUrl);
  await expect(requester.page.getByRole('heading', { name: 'This answer is not available' })).toBeVisible();
  const relogin = await newActor(browser);
  await signIn(relogin.page, username, password, { expectSuccess: false });
  await expect(relogin.page.getByRole('alert')).toBeVisible();
  await Promise.all([subject.context.close(), requester.context.close(), relogin.context.close()]);
});

test('STAFF-08/DATA-01 browser assisted deletion at the person’s request', async ({ browser }) => {
  const wa = await newActor(browser);
  await signInStaff(wa.page, 'worker.a');
  const alias = `Assisted delete ${uniqueName('d')}`;
  const { caseUrl } = await intake(wa.page, alias);
  const section = wa.page.getByRole('region', { name: 'Delete this person’s information' });
  await section.getByRole('button', { name: 'Delete at the person’s request' }).click();
  await section.getByRole('button', { name: 'Confirm deletion' }).click();
  await expect(wa.page.getByRole('heading', { name: 'Staff work' })).toBeVisible();
  await expect(wa.page.getByRole('link', { name: new RegExp(`^${alias}`) })).toHaveCount(0);
  await wa.page.goto(caseUrl);
  await expect(wa.page.getByRole('heading', { name: 'Case not available' })).toBeVisible();
  await wa.context.close();
});
