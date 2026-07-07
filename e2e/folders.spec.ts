import { expect, test } from '@playwright/test';
import { createVault, expectSaved, unlockVault } from './helpers';

test.describe('folders and shell (spec folders-and-shell)', () => {
  test('AC-F1.1 + AC-F1.2: create folder, create note inside it, tree shows both', async ({ page }) => {
    await createVault(page);
    await page.getByRole('button', { name: '＋ Folder' }).click();
    const folder = page.locator('summary', { hasText: 'New folder 1' });
    await expect(folder).toBeVisible();
    await folder.getByRole('button', { name: /New note in/u }).click();
    await page.getByLabel('Note title').fill('Inside folder');
    await expectSaved(page);
    await expect(
      page.getByRole('navigation', { name: 'Notes' }).getByRole('link', { name: 'Inside folder' }),
    ).toBeVisible();
  });

  test('AC-F1.3: moving a note between folders updates the tree', async ({ page }) => {
    await createVault(page);
    await page.getByRole('button', { name: '＋ Folder' }).click();
    await page.getByRole('button', { name: 'New note', exact: true }).click();
    await page.getByLabel('Note title').fill('Wanderer');
    await page.getByLabel('Move to folder').selectOption({ label: 'New folder 1' });
    await expectSaved(page);
    const folder = page.locator('details', { has: page.locator('summary', { hasText: 'New folder 1' }) });
    await expect(folder.getByRole('link', { name: 'Wanderer' })).toBeVisible();
  });

  test('AC-F1.5: folder structure survives reload', async ({ page }) => {
    await createVault(page);
    await page.getByRole('button', { name: '＋ Folder' }).click();
    await expect(page.locator('summary', { hasText: 'New folder 1' })).toBeVisible();
    await expectSaved(page);
    await page.reload();
    await unlockVault(page);
    await expect(page.locator('summary', { hasText: 'New folder 1' })).toBeVisible();
  });

  test('AC-F2.1: floating button and Ctrl+B toggle the file panel', async ({ page }) => {
    await createVault(page);
    const panel = page.locator('aside.files');
    await expect(panel).toHaveAttribute('data-open', 'true');
    await page.getByRole('button', { name: 'Toggle file panel' }).click();
    await expect(panel).toHaveAttribute('data-open', 'false');
    await page.keyboard.press('Control+b');
    await expect(panel).toHaveAttribute('data-open', 'true');
  });
});
