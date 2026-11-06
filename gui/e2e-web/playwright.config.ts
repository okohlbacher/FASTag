// Playwright baseline (GUI-DESIGN section 9, P0a): the React app in Chromium
// and WebKit, on the e2e build (`npm run build:e2e`, vite --mode e2e) served
// by `vite preview`. The page talks to the e2e bridge, picked per test with
// ?fixture= (src/testing/e2eBridge.ts), not to Tauri. Playwright's WebKit is
// not WebKitGTK and says nothing about the Linux webview.
//
//   npm run build:e2e && npm run e2e
import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const gui = fileURLToPath(new URL('..', import.meta.url))
const PORT = 4173

export default defineConfig({
  testDir: './specs',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // Fail fast on a hang: 26 tests take well under a minute locally, so a test
  // that runs 30 s or a suite that runs 5 min is stuck (a request the bridge
  // never answers, a locator that never appears), and Playwright reports which
  // test and which step instead of the CI job being cancelled without a word.
  timeout: 30_000,
  globalTimeout: process.env.CI ? 5 * 60_000 : 0,
  expect: { timeout: 5_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1200, height: 800 },
    trace: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 15_000
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1200, height: 800 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1200, height: 800 } } }
  ],
  webServer: {
    command: `npx vite preview --outDir dist-e2e --host 127.0.0.1 --port ${PORT} --strictPort`,
    cwd: gui,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000
  }
})
