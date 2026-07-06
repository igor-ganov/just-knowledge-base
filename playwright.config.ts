import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env['E2E_PORT'] ?? 4871);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  workers: process.env['CI'] === undefined ? undefined : 4,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `bunx astro preview --host 127.0.0.1 --port ${PORT}`,
    port: PORT,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
