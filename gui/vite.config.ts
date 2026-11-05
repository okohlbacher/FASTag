import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false, // keep Rust errors visible
  server: {
    port: 1420, // Tauri's devUrl expects this fixed port
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
