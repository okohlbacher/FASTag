import React from 'react'
import { createRoot } from 'react-dom/client'
import './api' // installs window.fastag before App mounts
import App from './App'
import { applyTheme, loadTheme } from './app/theme'
import './index.css'

// The remembered theme before the first paint (no light flash in dark).
applyTheme(loadTheme())

async function main(): Promise<void> {
  // A dev build opened in a browser instead of the Tauri window.
  if (import.meta.env.DEV && !('__TAURI_INTERNALS__' in window)) {
    const { installDevBridge } = await import('./testing/devBridge')
    installDevBridge()
  } else if (__E2E__) {
    // The Playwright build only: a constant false elsewhere, so a release
    // build carries neither this branch nor the bridge.
    const { installE2EBridge } = await import('./testing/e2eBridge')
    installE2EBridge()
  }
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

main()
