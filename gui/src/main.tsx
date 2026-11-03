import React from 'react'
import { createRoot } from 'react-dom/client'
import './api' // installs window.fastag before App mounts
import App from './App'
import './index.css'

async function main(): Promise<void> {
  // A dev build opened in a browser instead of the Tauri window.
  if (import.meta.env.DEV && !('__TAURI_INTERNALS__' in window)) {
    const { installDevBridge } = await import('./testing/devBridge')
    installDevBridge()
  }
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

main()
