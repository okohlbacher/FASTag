/// <reference types="vite/client" />

/// True only in the Playwright e2e build (vite.config.ts, `--mode e2e`).
declare const __E2E__: boolean

/// The app version in src-tauri/tauri.conf.json (vite.config.ts, vitest.config.ts).
declare const __APP_VERSION__: string

/// The build's identity for feedback reports (scripts/build-info.mjs).
declare const __BUILD_INFO__: {
  version: string
  commit: string
  dirty: boolean | null
  build_date: string | null
  channel: 'release' | 'prerelease' | 'dev' | 'e2e'
}
