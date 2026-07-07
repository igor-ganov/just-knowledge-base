import { expect, test } from '@playwright/test';
import { createVault, expectSaved, newNote, unlockVault } from './helpers';

test.describe('public/private spaces (spec spaces)', () => {
  test('AC-S2 + AC-S3: note moves to the public space and survives reload there', async ({ page }) => {
    await createVault(page);
    await newNote(page, 'Team doc', 'shared knowledge\n');
    await expectSaved(page);

    const privateSection = page.locator('details.space', { has: page.locator('summary', { hasText: 'Private' }) });
    await expect(privateSection.getByRole('link', { name: 'Team doc' })).toBeVisible();

    await page.getByLabel('Note space').selectOption('public');
    await expectSaved(page);
    const publicSection = page.locator('details.space', { has: page.locator('summary', { hasText: 'Public' }) });
    await expect(publicSection.getByRole('link', { name: 'Team doc' })).toBeVisible();
    await expect(privateSection.getByRole('link', { name: 'Team doc' })).not.toBeVisible();

    await page.reload();
    await unlockVault(page);
    await expect(page.getByRole('button', { name: 'New note', exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(publicSection.getByRole('link', { name: 'Team doc' })).toBeVisible();
    await page.getByRole('link', { name: 'Team doc' }).click();
    await expect(page.getByLabel('Note space')).toHaveValue('public');
    await expect(page.locator('.cm-content')).toContainText('shared knowledge');
  });
});
