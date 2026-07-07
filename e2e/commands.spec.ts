import { expect, test } from '@playwright/test';
import { createVault } from './helpers';

test.describe('commands, hotkeys, settings (spec commands-and-hotkeys)', () => {
  test('AC-C5.1: Ctrl+, opens settings; hotkeys section lists commands', async ({ page }) => {
    await createVault(page);
    await page.keyboard.press('Control+,');
    const dialog = page.getByRole('dialog', { name: 'Application settings' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Hotkeys' }).click();
    await expect(dialog.getByRole('table', { name: 'Hotkeys' })).toContainText('New note');
    await expect(dialog.getByRole('table', { name: 'Hotkeys' })).toContainText('Lock vault');
  });

  test('AC-C4.1..4.3: show-hotkeys overlay swaps labels for chips', async ({ page }) => {
    await createVault(page);
    await page.keyboard.press('Control+/');
    const newNoteButton = page.getByRole('button', { name: /Ctrl N/u });
    await expect(newNoteButton).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: '+ New note' })).toBeVisible();
  });

  test('AC-C3.2: rebinding a command persists across reloads', async ({ page }) => {
    await createVault(page);
    await page.keyboard.press('Control+,');
    const dialog = page.getByRole('dialog', { name: 'Application settings' });
    await dialog.getByRole('button', { name: 'Hotkeys' }).click();
    const row = dialog.locator('tr', { hasText: 'New note' });
    await row.getByRole('button', { name: 'Change' }).click();
    await page.keyboard.press('Control+Shift+9');
    await expect(row).toContainText('Ctrl ⇧ 9');
    await dialog.getByRole('button', { name: 'Close' }).click();

    await page.keyboard.press('Control+Shift+9');
    await expect(page.getByLabel('Note title')).toBeVisible();

    await page.reload();
    await page.getByLabel('Master password').fill('correct horse battery');
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByRole('button', { name: '+ New note' })).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press('Control+Shift+9');
    await expect(page.getByLabel('Note title')).toBeVisible();
  });

  test('AC-C1.2: conditions gate hotkeys — Ctrl+N does nothing while locked', async ({ page }) => {
    await createVault(page);
    await page.getByRole('button', { name: 'Lock', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Unlock your vault' })).toBeVisible();
    await page.keyboard.press('Control+n');
    await expect(page.getByRole('heading', { name: 'Unlock your vault' })).toBeVisible();
  });
});
