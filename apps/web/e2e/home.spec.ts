import { expect, test } from '@playwright/test';

test('an unauthenticated visit to a protected route lands on the sign-in page', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});
