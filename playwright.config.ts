import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env['E2E_PORT'] ?? 4871);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  workers: process.env['CI'] === undefined ? undefined : 4,
  reporter: [['list']],
  use: {
    // localhost, not 127.0.0.1: WebAuthn rejects IP-address RP IDs (passkey E2E).
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `bunx astro preview --host :: --port ${PORT}`,
    port: PORT,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
