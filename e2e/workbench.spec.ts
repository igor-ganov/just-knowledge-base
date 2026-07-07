import { expect, test } from '@playwright/test';

test.describe('component workbench (spec component-workbench)', () => {
  test('hosts components in isolation with live prop controls', async ({ page }) => {
    await page.goto('/workbench');
    await expect(page.getByRole('heading', { name: 'Workbench' })).toBeVisible();

    await expect(page.locator('kb-lock-screen')).toBeVisible();
    await expect(page.getByRole('button', { name: /Unlock with passkey/u })).toBeVisible();

    const busy = page.getByLabel('Busy');
    await busy.check();
    await expect(page.getByRole('button', { name: 'Working…' })).toBeVisible();

    await page.getByRole('button', { name: 'kb-file-panel' }).click();
    await expect(page.locator('kb-file-panel')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Alpha note' })).toBeVisible();
    await expect(page.getByText('@igor-ganov')).toBeVisible();
  });
});
