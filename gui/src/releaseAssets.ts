/// Release file names of this build's version (FASTag-<version>-<variant>.<ext>,
/// as CI attaches them). __APP_VERSION__ is the app version in
/// src-tauri/tauri.conf.json, set at build time (vite.config.ts, vitest.config.ts).
export const APP_VERSION: string = __APP_VERSION__

/// The release asset with the taxonomy k-mer index.
export const TAXONOMY_ASSET = `FASTag-${APP_VERSION}-taxonomy-k7.tar.gz`

/// The Windows installer.
export const WINDOWS_SETUP_ASSET = `FASTag-${APP_VERSION}-gui-windows-x64-setup.exe`
