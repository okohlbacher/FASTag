import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // Tests import from 'vitest' explicitly; globals exist only so RTL's
    // auto-cleanup and act-environment hooks (which probe for a global
    // afterEach/beforeAll) engage.
    globals: true
  }
})
