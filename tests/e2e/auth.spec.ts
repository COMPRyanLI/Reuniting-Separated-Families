import { expect, test } from '@playwright/test';
import { apiAs, newActor, register, signIn, uniqueName } from './helpers';

test('AUTH-01/AUTH-02 browser signup without personal identifiers; session cookie is HttpOnly and nothing sensitive is in web storage', async ({ browser }) => {
  const { context, page } = await newActor(browser, { width: 390, height: 844 });
  const username = uniqueName('e2e');
  await page.goto('/signup');
  // Only username, password and alias are asked for.
  await expect(page.getByLabel('Username')).toBeVisible();
  await expect(page.locator('input')).toHaveCount(3);
  const { secret } = await register(page, username, 'E2E Person');
  expect(secret).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{2,4}){6}$/);

  const cookies = await context.cookies();
  const session = cookies.find((c) => c.name === 'rf_session');
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe('Lax');
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  expect(storage).not.toContain(session!.value);
  expect(storage).not.toContain(secret);
  expect(await page.evaluate(() => document.cookie)).not.toContain(session!.value);
  await context.close();
});

test('AUTH-03/UX-04 sign-out clears the view; back button and old session show nothing private', async ({ browser }) => {
  const { context, page } = await newActor(browser);
  const username = uniqueName('e2e');
  await register(page, username, 'Back Button Tester');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'You have signed out' })).toBeVisible();
  await page.goBack();
  await expect(page.getByText('Back Button Tester')).toHaveCount(0);
  // Opening the private page directly redirects to sign-in and shows nothing private.
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByText('Back Button Tester')).toHaveCount(0);
  const me = await apiAs(page, 'GET', '/me');
  expect(me.status).toBe(401);
  await context.close();
});

test('AUTH-02 generic sign-in error for unknown user and wrong password', async ({ browser }) => {
  const { context, page } = await newActor(browser);
  await signIn(page, 'maya', 'wrong password here', { expectSuccess: false });
  const wrong = await page.getByRole('alert').textContent();
  await signIn(page, uniqueName('ghost'), 'wrong password here', { expectSuccess: false });
  const unknown = await page.getByRole('alert').textContent();
  expect(wrong).toBe(unknown);
  await context.close();
});
