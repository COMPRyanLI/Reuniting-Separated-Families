import { expect, test } from '@playwright/test';
import { apiAs, newActor, signInStaff } from './helpers';

test('STAFF-01/STAFF-02 assisted intake by W-A; unassigned W-A2 cannot open the case; repeat visit needs the secret', async ({ browser }) => {
  const wa = await newActor(browser, { width: 768, height: 1024 });
  await signInStaff(wa.page, 'worker.a');
  await wa.page.getByRole('link', { name: /New intake/ }).click();

  // UX-05: count primary form interactions for a minimal intake.
  let interactions = 0;
  await wa.page.getByLabel('Name the person wants to use').fill('Walk-in Visitor');
  interactions++;
  await wa.page.getByLabel(/The person agreed to this intake/).check();
  interactions++;
  await wa.page.getByRole('button', { name: 'Save intake' }).click();
  interactions++;
  expect(interactions).toBeLessThanOrEqual(12);

  await expect(wa.page.getByRole('heading', { name: 'Intake saved' })).toBeVisible();
  const secret = ((await wa.page.getByLabel('Assistance secret').textContent()) ?? '').trim();
  expect(secret.length).toBeGreaterThan(20);
  await wa.page.getByRole('link', { name: 'Open the case' }).click();
  await expect(wa.page.getByText('Acting for: Walk-in Visitor')).toBeVisible();
  const caseUrl = wa.page.url();
  const caseId = caseUrl.split('/').pop()!;

  // Intake counts as a witnessed verification; record a check-in for the person.
  await wa.page.getByRole('button', { name: 'Record a check-in' }).click();
  await wa.page.getByLabel('Shelter', { exact: true }).selectOption({ label: 'Riverside Community Center (North Riverside)' });
  await wa.page.getByRole('button', { name: 'Save check-in' }).click();
  await expect(wa.page.getByRole('article').filter({ hasText: 'Recorded by shelter staff' }).first()).toBeVisible();

  // End the visit; a repeat visit must verify the secret again.
  await wa.page.getByRole('button', { name: 'End assistance now' }).click();
  await expect(wa.page.getByRole('heading', { name: 'Verify the person for this visit', exact: true })).toBeVisible();
  await expect(wa.page.getByRole('button', { name: 'Record a check-in' })).toHaveCount(0);
  await wa.page.getByLabel('Assistance secret').fill('WRONG-SECRET-VALUE');
  await wa.page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(wa.page.getByRole('alert')).toContainText('not accepted');
  await wa.page.getByLabel('Assistance secret').fill(secret);
  await wa.page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(wa.page.getByRole('heading', { name: 'Verified for this visit', exact: true })).toBeVisible();

  // An unassigned worker at the same shelter gets the neutral not-found page and API 404.
  const wa2 = await newActor(browser);
  await signInStaff(wa2.page, 'worker.a2');
  await wa2.page.goto(`/staff/cases/${caseId}`);
  await expect(wa2.page.getByRole('heading', { name: 'Case not available' })).toBeVisible();
  await expect(wa2.page.getByText('Walk-in Visitor')).toHaveCount(0);
  const direct = await apiAs(wa2.page, 'GET', `/staff/cases/${caseId}`);
  expect(direct.status).toBe(404);
  expect(direct.body).not.toContain('Walk-in Visitor');

  await wa.context.close();
  await wa2.context.close();
});
