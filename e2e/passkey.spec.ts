import { expect, test, type Page } from '@playwright/test';
import { expectSaved, PASSWORD } from './helpers';

/**
 * AC-1.0/1.0a/1.0c: passkey unlock with password fallback, exercised through a
 * CDP virtual authenticator with PRF support.
 */
const addVirtualAuthenticator = async (page: Page): Promise<void> => {
  const client = await page.context().newCDPSession(page);
  await client.send('WebAuthn.enable');
  await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
      hasPrf: true,
    },
  });
};

test('passkey: create with passkey, unlock with passkey, password still works', async ({ page }) => {
  await addVirtualAuthenticator(page);
  await page.goto('/');

  const checkbox = page.getByRole('checkbox', { name: /passkey/iu });
  await expect(checkbox).toBeChecked();
  await page.getByLabel('Master password').fill(PASSWORD);
  await page.getByLabel('Repeat password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create vault' }).click();
  await expect(page.getByRole('button', { name: '+ New note' })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: '+ New note' }).click();
  await page.getByLabel('Note title').fill('Passkey note');
  await expectSaved(page);

  await page.getByRole('button', { name: 'Lock', exact: true }).click();
  await page.getByRole('button', { name: /Unlock with passkey/u }).click();
  await expect(page.getByRole('button', { name: '+ New note' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('link', { name: 'Passkey note' })).toBeVisible();

  await page.getByRole('button', { name: 'Lock', exact: true }).click();
  await page.getByLabel('Master password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByRole('button', { name: '+ New note' })).toBeVisible({ timeout: 30_000 });
});

test('passkey: late enrollment from settings on a password-only vault', async ({ page }) => {
  await addVirtualAuthenticator(page);
  await page.goto('/');

  await page.getByRole('checkbox', { name: /passkey/iu }).uncheck();
  await page.getByLabel('Master password').fill(PASSWORD);
  await page.getByLabel('Repeat password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create vault' }).click();
  await expect(page.getByRole('button', { name: '+ New note' })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Master password (to enable passkey unlock)').fill(PASSWORD);
  await page.getByRole('button', { name: /Enable passkey unlock/u }).click();
  await expect(page.getByRole('status')).toContainText('Passkey enabled', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Lock', exact: true }).click();
  await page.getByRole('button', { name: /Unlock with passkey/u }).click();
  await expect(page.getByRole('button', { name: '+ New note' })).toBeVisible({ timeout: 30_000 });
});
