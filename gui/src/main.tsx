import React from 'react'
import { createRoot } from 'react-dom/client'
import './api' // installs window.fastag before App mounts
import App from './App'
import type { Origin } from './setup/tasks'
import { applyTheme, loadTheme } from './app/theme'
import './index.css'

// The remembered theme before the first paint (no light flash in dark).
applyTheme(loadTheme())

async function main(): Promise<void> {
  // Where the session starts: the app's own landing task unless the e2e
  // build is told otherwise.
  let start: Origin | undefined
  // A dev build opened in a browser instead of the Tauri window.
  if (import.meta.env.DEV && !('__TAURI_INTERNALS__' in window)) {
    const { installDevBridge } = await import('./testing/devBridge')
    installDevBridge()
  } else if (__E2E__) {
    // The Playwright build only: a constant false elsewhere, so a release
    // build carries neither this branch nor the bridge.
    const { installE2EBridge } = await import('./testing/e2eBridge')
    start = installE2EBridge()
  }
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App start={start} />
    </React.StrictMode>
  )
}

main()
