fn main() {
    // Windows (MSVC): tauri-build puts its app manifest (Common Controls v6)
    // into a resource that only the app binary links (rustc-link-arg-bins).
    // The lib test binary then loads comctl32 v5, which lacks entry points
    // tauri needs (muda's SetWindowSubclass by name, the dialogs'
    // TaskDialogIndirect): since settings.rs builds a mock app
    // (tauri::test), `cargo test --lib` died at load with
    // STATUS_ENTRYPOINT_NOT_FOUND before running a test. The linker embeds
    // the same manifest into every binary instead (app, tests, examples);
    // tauri-build embeds none, so no binary carries two. Tauri's own build.rs
    // does the same for its tests (tauri-apps/tauri#4383).
    let windows_msvc = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc");
    if !windows_msvc {
        tauri_build::build();
        return;
    }
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("windows-app-manifest.xml");
    println!("cargo:rerun-if-changed={}", manifest.display());
    println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
    println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    let windows = tauri_build::WindowsAttributes::new_without_app_manifest();
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("failed to run tauri-build");
}
