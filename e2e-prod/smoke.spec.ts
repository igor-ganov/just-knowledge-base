import { expect, test } from '@playwright/test';

test('production: vault creation and note editing work end-to-end', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Create your vault' })).toBeVisible();
  await page.getByLabel('Master password').fill('prod smoke passphrase');
  await page.getByLabel('Repeat password').fill('prod smoke passphrase');
  await page.getByRole('button', { name: 'Create vault' }).click();
  await expect(page.getByRole('button', { name: '+ New note' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: '+ New note' }).click();
  await page.getByLabel('Note title').fill('Hello production');
  await page.locator('.cm-content').click();
  await page.keyboard.type('It works, encrypted, on the real origin. #shipped');
  await expect(page.locator('.sync-state')).toContainText('Saved', { timeout: 15_000 });
  await page.reload();
  await page.getByLabel('Master password').fill('prod smoke passphrase');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(
    page.getByRole('navigation', { name: 'Notes' }).getByRole('link', { name: 'Hello production' }),
  ).toBeVisible({ timeout: 30_000 });
});
