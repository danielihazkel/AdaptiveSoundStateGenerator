import { defineConfig, devices } from '@playwright/test';

// The app's tsconfig is browser-only; this file runs under Node.
declare const process: { env: Record<string, string | undefined> };

/**
 * Browser tests (e2e/). The smoke spec runs against the production build
 * served by `vite preview`; audio QA specs that need dev-only hooks use the
 * dev server (see the `qa` project). Chromium only: the app's audio paths
 * are the same across engines, and Web Bluetooth / Wake Lock are Chromium
 * features anyway.
 */
const autoplay = ['--autoplay-policy=no-user-gesture-required'];

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { trace: 'retain-on-failure' },
  projects: [
    {
      name: 'smoke',
      testMatch: /smoke\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:4173',
        launchOptions: { args: autoplay },
      },
    },
    {
      name: 'qa',
      testMatch: /\.qa\.spec\.ts/,
      timeout: 300_000,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:5174',
        launchOptions: { args: autoplay },
      },
    },
  ],
  webServer: [
    {
      command: 'npm run build && npx vite preview --port 4173 --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: 'npx vite --port 5174 --strictPort',
      url: 'http://localhost:5174',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
