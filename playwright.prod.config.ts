import { defineConfig, devices } from '@playwright/test';

/** Post-deploy smoke against the production origin (no local server). */
export default defineConfig({
  testDir: 'e2e-prod',
  reporter: [['list']],
  use: {
    baseURL: process.env['PROD_URL'] ?? 'https://just-knowledge-base.pages.dev',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
