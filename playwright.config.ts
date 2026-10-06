import { readFileSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// Smoke tests run against the production build served by `vite preview` (run `npm run build` first;
// `npm run e2e` does it for you). The iPhone project needs WebKit: `npx playwright install webkit`.
const PORT = 4173;
// Where WebKit can't be installed, E2E_IPHONE_BROWSER=chromium runs the iPhone project (same screen,
// touch and user agent) on Chromium instead. CI always uses the real WebKit.
const iphoneBrowser = process.env.E2E_IPHONE_BROWSER === 'chromium' ? ('chromium' as const) : ('webkit' as const);

// Every test starts as a user who has already seen this version's "What's new" (its sheet opens by
// itself after an update, over whatever the test is doing); the test about the sheet overrides this.
const version = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string }).version;
const seenWhatsNew = { cookies: [], origins: [{ origin: `http://localhost:${PORT}`, localStorage: [{ name: 'ptb:prefs:v1', value: JSON.stringify({ state: { lastSeenVersion: version }, version: 1 }) }] }] };

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    // The service worker would cache the app across tests and hide the page behind it.
    serviceWorkers: 'block',
    storageState: seenWhatsNew,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'iphone', use: { ...devices['iPhone 14'], browserName: iphoneBrowser } },
  ],
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
