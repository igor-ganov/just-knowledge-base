import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'correct horse battery';

export const createVault = async (page: Page): Promise<void> => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Create your vault' })).toBeVisible();
  await page.getByLabel('Master password').fill(PASSWORD);
  await page.getByLabel('Repeat password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create vault' }).click();
  await expect(page.getByRole('button', { name: '+ New note' })).toBeVisible({ timeout: 30_000 });
};

export const unlockVault = async (page: Page, password: string = PASSWORD): Promise<void> => {
  await expect(page.getByRole('heading', { name: 'Unlock your vault' })).toBeVisible();
  await page.getByLabel('Master password').fill(password);
  await page.getByRole('button', { name: 'Unlock' }).click();
};

export const newNote = async (page: Page, title: string, body: string): Promise<void> => {
  await page.getByRole('button', { name: '+ New note' }).click();
  const titleInput = page.getByLabel('Note title');
  await expect(titleInput).toBeVisible();
  await titleInput.fill(title);
  await page.locator('.cm-content').click();
  await page.keyboard.type(body);
  await expect(page.locator('.cm-content')).toContainText(body.split('\n')[0] ?? body);
};

/** Autosave flush is debounced; wait for the note list to reflect state instead of sleeping. */
export const expectNoteListed = async (page: Page, title: string): Promise<void> => {
  await expect(page.getByRole('navigation', { name: 'Notes' }).getByRole('link', { name: title })).toBeVisible();
};

/** Event-driven persistence gate: the footer flips to “Saved” once data + superblock hit IndexedDB. */
export const expectSaved = async (page: Page): Promise<void> => {
  await expect(page.locator('.sync-state')).toContainText('Saved', { timeout: 15_000 });
};
