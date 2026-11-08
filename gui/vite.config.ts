import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `vite build --mode e2e` is the Playwright build (GUI-DESIGN section 9): it
// installs the e2e bridge with its ?fixture= scenarios (src/testing/
// e2eBridge.ts). In every other mode __E2E__ is false and the bridge is
// tree-shaken out; scripts/check-dist-clean.mjs checks the release dist/.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  clearScreen: false, // keep Rust errors visible
  define: {
    __E2E__: JSON.stringify(mode === "e2e"),
  },
  build: mode === "e2e" ? { outDir: "dist-e2e" } : {},
  server: {
    port: 1420, // Tauri's devUrl expects this fixed port
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
}));
