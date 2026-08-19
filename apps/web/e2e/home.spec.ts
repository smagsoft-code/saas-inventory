import { expect, test } from '@playwright/test';

test('home page renders the project name', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'SaaS Inventory' })).toBeVisible();
});
