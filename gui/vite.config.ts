import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// The app version (what the bundles carry), for the release file names the
// GUI mentions (src/releaseAssets.ts).
import tauriConf from "./src-tauri/tauri.conf.json";
// The commit, dirty flag and build date of feedback reports.
import { buildInfo } from "./scripts/build-info.mjs";

// `vite build --mode e2e` is the Playwright build (GUI-DESIGN section 9): it
// installs the e2e bridge with its ?fixture= scenarios (src/testing/
// e2eBridge.ts). In every other mode __E2E__ is false and the bridge is
// tree-shaken out; scripts/check-dist-clean.mjs checks the release dist/.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  clearScreen: false, // keep Rust errors visible
  define: {
    __E2E__: JSON.stringify(mode === "e2e"),
    __APP_VERSION__: JSON.stringify(tauriConf.version),
    __BUILD_INFO__: JSON.stringify(buildInfo(tauriConf.version, mode)),
  },
  build: mode === "e2e" ? { outDir: "dist-e2e" } : {},
  server: {
    port: 1420, // Tauri's devUrl expects this fixed port
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
}));
