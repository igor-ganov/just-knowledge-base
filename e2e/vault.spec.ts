import { expect, test } from '@playwright/test';
import { createVault, expectNoteListed, expectSaved, newNote, unlockVault } from './helpers';

test.describe('vault lifecycle (US-1)', () => {
  test('AC-1.1: creating a vault opens the workspace', async ({ page }) => {
    await createVault(page);
    await expect(page.getByRole('searchbox', { name: 'Search notes' })).toBeVisible();
  });

  test('AC-1.2 + AC-2.5: notes survive reload and unlock', async ({ page }) => {
    await createVault(page);
    await newNote(page, 'Persistent note', 'it must survive');
    await expectNoteListed(page, 'Persistent note');
    await expectSaved(page);
    await page.reload();
    await unlockVault(page);
    await expect(page.getByRole('button', { name: '+ New note' })).toBeVisible({ timeout: 30_000 });
    await expectNoteListed(page, 'Persistent note');
    await page.getByRole('link', { name: 'Persistent note' }).click();
    await expect(page.locator('.cm-content')).toContainText('it must survive');
  });

  test('AC-1.3: wrong password shows one uniform error and stays locked', async ({ page }) => {
    await createVault(page);
    await page.reload();
    await unlockVault(page, 'totally wrong password');
    await expect(page.getByRole('alert')).toContainText('Wrong password');
    await expect(page.getByRole('button', { name: '+ New note' })).not.toBeVisible();
  });

  test('AC-1.5: manual lock returns to the lock screen', async ({ page }) => {
    await createVault(page);
    await page.getByRole('button', { name: 'Lock', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Unlock your vault' })).toBeVisible();
  });
});

test.describe('notes and markdown (US-2)', () => {
  test('AC-2.3: markdown renders in preview', async ({ page }) => {
    await createVault(page);
    await newNote(page, 'Formatted', '# Heading\n\nsome **bold** text\n- item one');
    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(page.getByRole('heading', { name: 'Heading' })).toBeVisible();
    await expect(page.locator('.preview strong')).toHaveText('bold');
    await expect(page.locator('.preview li')).toHaveText('item one');
  });

  test('AC-2.4: deleted note disappears from the list', async ({ page }) => {
    await createVault(page);
    await newNote(page, 'Doomed', 'delete me');
    await expectNoteListed(page, 'Doomed');
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('navigation', { name: 'Notes' }).getByRole('link', { name: 'Doomed' })).not.toBeVisible();
  });
});

test.describe('wiki-links and backlinks (US-3)', () => {
  test('AC-3.1 + AC-3.4: link navigates, backlink appears', async ({ page }) => {
    await createVault(page);
    await newNote(page, 'Target', 'the destination');
    await newNote(page, 'Source', 'see [[Target]]');
    await expectNoteListed(page, 'Source');
    await page.getByRole('button', { name: 'Preview' }).click();
    await page.locator('.preview a.wiki-link').click();
    await expect(page.getByLabel('Note title')).toHaveValue('Target');
    await expect(page.locator('aside[aria-label="Backlinks"]')).toContainText('Source');
  });

  test('AC-3.2: unresolved link is distinct and creates the note on click', async ({ page }) => {
    await createVault(page);
    await newNote(page, 'Origin', 'go to [[Not Yet Created]]');
    await page.getByRole('button', { name: 'Preview' }).click();
    const unresolved = page.locator('.preview a.wiki-link--unresolved');
    await expect(unresolved).toBeVisible();
    await unresolved.click();
    await expect(page.getByLabel('Note title')).toHaveValue('Not Yet Created');
    await expectNoteListed(page, 'Not Yet Created');
  });

  test('AC-3.3: [[ offers autocomplete over existing titles', async ({ page }) => {
    await createVault(page);
    await newNote(page, 'Autocomplete Target', 'x');
    await page.getByRole('button', { name: '+ New note' }).click();
    await page.locator('.cm-content').click();
    await page.keyboard.type('link to [[Auto');
    const option = page.locator('.cm-tooltip-autocomplete li').first();
    await expect(option).toContainText('Autocomplete Target');
    await option.click();
    await expect(page.locator('.cm-content')).toContainText('|Autocomplete Target]]');
  });
});

test.describe('tags (US-4)', () => {
  test('AC-4.1..4.3: tags index, count, and filter', async ({ page }) => {
    await createVault(page);
    await newNote(page, 'Tagged one', 'about #testing stuff');
    await newNote(page, 'Tagged two', 'more #testing and #extra');
    await newNote(page, 'Untagged', 'nothing here');
    const tagButton = page.getByRole('button', { name: '#testing (2)' });
    await expect(tagButton).toBeVisible();
    await tagButton.click();
    await expectNoteListed(page, 'Tagged one');
    await expectNoteListed(page, 'Tagged two');
    await expect(page.getByRole('navigation', { name: 'Notes' }).getByRole('link', { name: 'Untagged' })).not.toBeVisible();
  });
});

test.describe('search (US-5)', () => {
  test('AC-5.1 + AC-5.3: live results, choosing opens the note', async ({ page }) => {
    await createVault(page);
    await newNote(page, 'Quantum notes', 'entanglement is spooky');
    await newNote(page, 'Cooking', 'pasta carbonara recipe');
    await page.getByRole('searchbox', { name: 'Search notes' }).fill('entangle');
    await expectNoteListed(page, 'Quantum notes');
    await expect(page.getByRole('navigation', { name: 'Notes' }).getByRole('link', { name: 'Cooking' })).not.toBeVisible();
    await page.getByRole('link', { name: 'Quantum notes' }).click();
    await expect(page.getByLabel('Note title')).toHaveValue('Quantum notes');
  });
});

test.describe('offline PWA (US-6)', () => {
  test('AC-6.2 + AC-6.3: app loads and unlocks fully offline', async ({ page, context }) => {
    await createVault(page);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await unlockVault(page);
    await expect(page.getByRole('button', { name: '+ New note' })).toBeVisible();

    await context.setOffline(true);
    await page.reload();
    await unlockVault(page);
    await expect(page.getByRole('button', { name: '+ New note' })).toBeVisible();
    await page.getByRole('button', { name: '+ New note' }).click();
    await page.locator('.cm-content').click();
    await page.keyboard.type('written offline');
    await expect(page.locator('.cm-content')).toContainText('written offline');
  });
});
