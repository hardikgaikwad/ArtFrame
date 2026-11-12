import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against the production build (`vite preview` on port 4174, so a
// preview server on the default 4173 for device testing can keep running), which also
// serves the production security headers, so CSP problems surface here.
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4174',
    acceptDownloads: true,
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4174 --strictPort',
    url: 'http://localhost:4174',
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    { name: 'android-chrome', use: { ...devices['Galaxy S9+'] } },
    { name: 'ipad-webkit', use: { ...devices['iPad (gen 7)'] } },
  ],
});
