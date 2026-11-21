import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
// As in vite.config.ts: the app version for src/releaseAssets.ts.
import tauriConf from './src-tauri/tauri.conf.json'
import { buildInfo } from './scripts/build-info.mjs'

export default defineConfig({
  plugins: [react()],
  define: { __E2E__: 'false', __APP_VERSION__: JSON.stringify(tauriConf.version), __BUILD_INFO__: JSON.stringify(buildInfo(tauriConf.version, 'test')) },
  test: {
    environment: 'jsdom',
    // Tests import from 'vitest' explicitly; globals exist only so RTL's
    // auto-cleanup and act-environment hooks (which probe for a global
    // afterEach/beforeAll) engage.
    globals: true,
    // The Playwright specs run under Playwright and the tauri-driver specs
    // under node --test (e2e-tauri/run.sh), not vitest.
    exclude: ['**/node_modules/**', 'e2e-web/**', 'e2e-tauri/**']
  }
})
