// Feedback (feedback.rs): the native screenshot of the calling window's
// webview, the platform, and the run on screen.
//
// The screenshot is the webview's visible viewport, taken by the webview
// itself, so it needs no OS permission and holds no other window:
//   macOS   WKWebView takeSnapshotWithConfiguration:completionHandler:
//   Windows ICoreWebView2::CapturePreview(PNG) into an in-memory IStream
//   Linux   webkit_web_view_get_snapshot (visible region) -> cairo -> PNG
// WebviewWindow::with_webview runs the start on the main thread; the
// callback comes later on that thread and sends the PNG through a channel,
// which the command awaits on a blocking-pool thread with a 5 s timeout, so
// the UI thread never waits. Anywhere native capture is not available the
// reply is `failed` with the reason, and the frontend falls back to the DOM
// rasteriser.
//
// The reply is one binary frame (feedback::frame): the JSON CaptureReply,
// then the PNG bytes.

use std::path::Path;
use std::sync::mpsc::{channel, Sender};
use std::time::Duration;

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Runtime, WebviewWindow};

use crate::feedback::{self, InputInfo, RunInfo};

pub const TIMEOUT: Duration = Duration::from_secs(5);

type Result<T> = std::result::Result<T, String>;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct CaptureReply {
    /// ok | failed
    pub status: &'static str,
    /// native | none
    pub method: &'static str,
    /// The platform API that took it.
    pub api: Option<&'static str>,
    pub width: u32,
    pub height: u32,
    /// Image pixels per CSS pixel.
    pub scale: f64,
    pub error: Option<String>,
}

#[cfg(target_os = "macos")]
mod native {
    use super::*;
    use block2::RcBlock;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
    use objc2_foundation::{NSDictionary, NSError};
    use objc2_web_kit::WKWebView;

    pub const API: &str = "WKWebView.takeSnapshot";

    fn png_of(img: &NSImage) -> Result<Vec<u8>> {
        let tiff = img.TIFFRepresentation().ok_or("the snapshot has no bitmap")?;
        let rep = NSBitmapImageRep::imageRepWithData(&tiff).ok_or("the snapshot has no bitmap")?;
        // SAFETY: an empty properties dictionary.
        let png = unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new()) }
            .ok_or("the snapshot could not be encoded as PNG")?;
        Ok(png.to_vec())
    }

    pub fn start<R: Runtime>(w: &WebviewWindow<R>, tx: Sender<Result<Vec<u8>>>) -> Result<()> {
        w.with_webview(move |pw| {
            // SAFETY: on macOS the platform webview is the WKWebView, and
            // this closure runs on the main thread.
            let wk: &WKWebView = unsafe { &*(pw.inner() as *const WKWebView) };
            let tx = tx.clone();
            let done: RcBlock<dyn Fn(*mut NSImage, *mut NSError)> = RcBlock::new(move |img: *mut NSImage, err: *mut NSError| {
                // SAFETY: WebKit passes a valid image or an error.
                let r = match unsafe { img.as_ref() } {
                    Some(img) => png_of(img),
                    None => Err(unsafe { err.as_ref() }
                        .map(|e| e.localizedDescription().to_string())
                        .unwrap_or_else(|| "WebKit returned no snapshot".into())),
                };
                let _ = tx.send(r);
            });
            // SAFETY: a nil configuration snapshots the visible bounds.
            unsafe { wk.takeSnapshotWithConfiguration_completionHandler(None, &done) };
        })
        .map_err(|e| e.to_string())
    }
}

#[cfg(windows)]
mod native {
    use super::*;
    use webview2_com::CapturePreviewCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG;
    use windows::Win32::Foundation::HGLOBAL;
    use windows::Win32::System::Com::StructuredStorage::CreateStreamOnHGlobal;
    use windows::Win32::System::Com::{IStream, STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET};

    pub const API: &str = "ICoreWebView2.CapturePreview";

    fn read_stream(s: &IStream) -> Result<Vec<u8>> {
        // SAFETY: plain COM calls on a stream we own.
        unsafe {
            let mut st = STATSTG::default();
            s.Stat(&mut st, STATFLAG_NONAME).map_err(|e| e.to_string())?;
            let len = usize::try_from(st.cbSize).map_err(|e| e.to_string())?;
            s.Seek(0, STREAM_SEEK_SET, None).map_err(|e| e.to_string())?;
            let mut buf = vec![0u8; len];
            let mut read = 0u32;
            s.Read(buf.as_mut_ptr().cast(), len as u32, Some(&mut read)).ok().map_err(|e| e.to_string())?;
            buf.truncate(read as usize);
            Ok(buf)
        }
    }

    pub fn start<R: Runtime>(w: &WebviewWindow<R>, tx: Sender<Result<Vec<u8>>>) -> Result<()> {
        w.with_webview(move |pw| {
            let begin = || -> Result<()> {
                // SAFETY: COM calls on the UI thread that owns the webview.
                unsafe {
                    let core = pw.controller().CoreWebView2().map_err(|e| e.to_string())?;
                    let stream: IStream = CreateStreamOnHGlobal(HGLOBAL::default(), true).map_err(|e| e.to_string())?;
                    let s2 = stream.clone();
                    let tx2 = tx.clone();
                    let handler = CapturePreviewCompletedHandler::create(Box::new(move |r: windows::core::Result<()>| {
                        let _ = tx2.send(r.map_err(|e| e.to_string()).and_then(|_| read_stream(&s2)));
                        Ok(())
                    }));
                    core.CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG, &stream, &handler)
                        .map_err(|e| e.to_string())
                }
            };
            if let Err(e) = begin() {
                let _ = tx.send(Err(e));
            }
        })
        .map_err(|e| e.to_string())
    }
}

#[cfg(target_os = "linux")]
mod native {
    use super::*;
    use webkit2gtk::{SnapshotOptions, SnapshotRegion, WebViewExt};

    pub const API: &str = "webkit_web_view_get_snapshot";

    pub fn start<R: Runtime>(w: &WebviewWindow<R>, tx: Sender<Result<Vec<u8>>>) -> Result<()> {
        w.with_webview(move |pw| {
            let wv = pw.inner();
            wv.snapshot(SnapshotRegion::Visible, SnapshotOptions::NONE, None::<&webkit2gtk::gio::Cancellable>, move |r| {
                let png = r.map_err(|e| e.to_string()).and_then(|surface| {
                    let img = cairo::ImageSurface::try_from(surface).map_err(|_| "the snapshot is not an image surface".to_string())?;
                    let mut buf = Vec::new();
                    img.write_to_png(&mut buf).map_err(|e| e.to_string())?;
                    Ok(buf)
                });
                let _ = tx.send(png);
            });
        })
        .map_err(|e| e.to_string())
    }
}

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
mod native {
    use super::*;
    pub const API: &str = "";
    pub fn start<R: Runtime>(_w: &WebviewWindow<R>, _tx: Sender<Result<Vec<u8>>>) -> Result<()> {
        Err("native capture is not available on this platform".into())
    }
}

/// The reply for @p png (or the reason it failed), @p logical_width: the
/// webview's width in CSS pixels.
pub fn reply(png: Result<Vec<u8>>, logical_width: f64) -> (CaptureReply, Option<Vec<u8>>) {
    let failed = |error: String| CaptureReply {
        status: "failed",
        method: "none",
        api: None,
        width: 0,
        height: 0,
        scale: 0.0,
        error: Some(error),
    };
    match png {
        Err(e) => (failed(e), None),
        Ok(png) => match feedback::png_size(&png) {
            None => (failed("the snapshot is not a PNG".into()), None),
            Some((0, _)) | Some((_, 0)) => (failed("the snapshot is empty".into()), None),
            Some((w, h)) => (
                CaptureReply {
                    status: "ok",
                    method: "native",
                    api: Some(native::API),
                    width: w,
                    height: h,
                    scale: if logical_width > 0.0 { w as f64 / logical_width } else { 1.0 },
                    error: None,
                },
                Some(png),
            ),
        },
    }
}

/// A snapshot of the calling window's visible viewport (see the header).
#[tauri::command]
pub async fn feedback_capture(window: WebviewWindow) -> tauri::ipc::Response {
    let logical = window
        .inner_size()
        .ok()
        .zip(window.scale_factor().ok())
        .map_or(0.0, |(s, f)| s.width as f64 / f.max(0.01));
    let (tx, rx) = channel();
    let png = match native::start(&window, tx) {
        Err(e) => Err(e),
        Ok(()) => tauri::async_runtime::spawn_blocking(move || {
            rx.recv_timeout(TIMEOUT).unwrap_or_else(|_| Err(format!("the webview did not answer within {} s", TIMEOUT.as_secs())))
        })
        .await
        .unwrap_or_else(|e| Err(e.to_string())),
    };
    let (meta, png) = reply(png, logical);
    let meta = serde_json::to_value(&meta).unwrap_or(json!({"status": "failed", "error": "serialisation"}));
    tauri::ipc::Response::new(feedback::frame(&meta, png.as_deref()))
}

/// Debug builds only: with FASTAG_FEEDBACK_SELFTEST=<file.png> set, the app
/// takes the native snapshot of its main window once the page has loaded,
/// through the same path as feedback_capture, writes the PNG to <file.png>
/// and its CaptureReply to <file.png>.json, and exits (0: ok). A check of
/// the real webview where the window cannot be driven (a locked screen, CI).
#[cfg(debug_assertions)]
pub(crate) const SELFTEST: &str = "FASTAG_FEEDBACK_SELFTEST";

#[cfg(debug_assertions)]
pub(crate) fn self_test(app: &AppHandle, out: &Path) -> i32 {
    use tauri::Manager;
    std::thread::sleep(Duration::from_secs(4));
    let Some(w) = app.get_webview_window("main") else { return 2 };
    let logical = w.inner_size().ok().zip(w.scale_factor().ok()).map_or(0.0, |(s, f)| s.width as f64 / f.max(0.01));
    let (tx, rx) = channel();
    let png = native::start(&w, tx).and_then(|()| rx.recv_timeout(TIMEOUT).unwrap_or_else(|_| Err("timeout".into())));
    let (meta, png) = reply(png, logical);
    let _ = std::fs::write(out.with_extension("png.json"), serde_json::to_vec_pretty(&meta).unwrap_or_default());
    match png {
        Some(p) if std::fs::write(out, &p).is_ok() => 0,
        _ => 1,
    }
}

// ---------------------------------------------------------------- platform

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PlatformReply {
    pub os: String,
    pub os_version: String,
    pub arch: String,
    pub webview: String,
    pub webview_version: String,
    pub display_scale: f64,
    /// The CLI the app runs (fastag.rs resolve_binary): its source and size.
    pub engine_source: String,
    pub engine_bin_size: Option<u64>,
    /// For the log scrubber only (never stored): the home folder and the
    /// user name, which it replaces.
    pub home: Option<String>,
    pub user: Option<String>,
}

/// Characters a version string keeps (the public schema's pattern).
fn clean_version(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_alphanumeric() || " ._()+-".contains(*c)).take(64).collect::<String>().trim().to_string()
}

#[cfg(target_os = "macos")]
fn os_version() -> String {
    let plist = std::fs::read_to_string("/System/Library/CoreServices/SystemVersion.plist").unwrap_or_default();
    plist
        .split("<key>ProductVersion</key>")
        .nth(1)
        .and_then(|r| r.split("<string>").nth(1))
        .and_then(|r| r.split("</string>").next())
        .map(clean_version)
        .unwrap_or_default()
}

#[cfg(target_os = "linux")]
fn os_version() -> String {
    let rel = std::fs::read_to_string("/etc/os-release").unwrap_or_default();
    let get = |k: &str| {
        rel.lines()
            .find_map(|l| l.strip_prefix(k).and_then(|v| v.strip_prefix('=')))
            .map(|v| v.trim_matches('"').to_string())
    };
    let name = get("ID").unwrap_or_default();
    let ver = get("VERSION_ID").unwrap_or_default();
    clean_version(&format!("{name} {ver}"))
}

#[cfg(windows)]
fn os_version() -> String {
    // RtlGetVersion, unlike GetVersionExW, is not capped by the manifest.
    #[repr(C)]
    struct OsVersionInfoW {
        size: u32,
        major: u32,
        minor: u32,
        build: u32,
        platform: u32,
        csd: [u16; 128],
    }
    #[link(name = "ntdll")]
    extern "system" {
        fn RtlGetVersion(info: *mut OsVersionInfoW) -> i32;
    }
    let mut v = OsVersionInfoW { size: std::mem::size_of::<OsVersionInfoW>() as u32, major: 0, minor: 0, build: 0, platform: 0, csd: [0; 128] };
    // SAFETY: fills the struct whose size it is given.
    if unsafe { RtlGetVersion(&mut v) } != 0 {
        return String::new();
    }
    format!("{}.{}.{}", v.major, v.minor, v.build)
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
fn os_version() -> String {
    String::new()
}

pub fn webview_engine() -> &'static str {
    match std::env::consts::OS {
        "macos" => "wkwebview",
        "windows" => "webview2",
        "linux" => "webkitgtk",
        _ => "browser",
    }
}

#[tauri::command]
pub fn feedback_platform(app: AppHandle, window: WebviewWindow) -> PlatformReply {
    let os = match std::env::consts::OS {
        o @ ("macos" | "windows" | "linux") => o.to_string(),
        _ => "other".to_string(),
    };
    let r = crate::fastag::resolve_binary(&app);
    let env = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
    PlatformReply {
        os,
        os_version: os_version(),
        arch: std::env::consts::ARCH.to_string(),
        webview: webview_engine().to_string(),
        webview_version: tauri::webview_version().map(|v| clean_version(&v)).unwrap_or_default(),
        display_scale: window.scale_factor().unwrap_or(1.0),
        engine_source: r.source.to_string(),
        engine_bin_size: std::fs::metadata(&r.bin).ok().filter(|m| m.is_file()).map(|m| m.len()),
        home: env("HOME").or_else(|| env("USERPROFILE")),
        user: env("USER").or_else(|| env("USERNAME")),
    }
}

// ------------------------------------------------------------ the run shown

/// A value that names a file, as `<role.ext>`.
fn placeholder(role: &str, value: &str) -> String {
    let ext = Path::new(value)
        .extension()
        .map(|e| e.to_string_lossy().chars().filter(|c| c.is_ascii_alphanumeric()).take(16).collect::<String>())
        .unwrap_or_default();
    if ext.is_empty() {
        format!("<{role}>")
    } else {
        format!("<{role}.{ext}>")
    }
}

fn looks_like_path(v: &str) -> bool {
    v.contains('/') || v.contains('\\') || (v.len() > 1 && v.as_bytes()[1] == b':')
}

/// An enum value or number the argv may keep.
fn is_token(v: &str) -> bool {
    !v.is_empty() && v.len() <= 64 && v.bytes().all(|b| b.is_ascii_alphanumeric() || b"_.+-,:".contains(&b)) && !looks_like_path(v)
}

/// The command line of a run with every path replaced by `<role.ext>` and
/// every free-text value by `<text>`: argv[0] becomes FASTag; a value of a
/// file-typed option (the manifest's input-file/output-file, -in, -out,
/// -ini) becomes `<input.mzML>` or `<output.tsv>`; numbers and enum-like
/// tokens stay.
pub fn redact_argv(argv: &[String]) -> Vec<String> {
    let types = &*crate::fastag::PARAM_TYPES;
    let mut out = Vec::with_capacity(argv.len());
    let mut flag: Option<String> = None;
    for (i, a) in argv.iter().enumerate() {
        if i == 0 {
            out.push("FASTag".to_string());
            continue;
        }
        let name = a.strip_prefix('-').filter(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_'));
        if let Some(n) = name.filter(|n| n.as_bytes()[0].is_ascii_alphabetic()) {
            out.push(a.clone());
            flag = Some(n.to_string());
            continue;
        }
        let ty = flag.as_deref().and_then(|f| match f {
            "in" | "ini" => Some("input-file"),
            "out" => Some("output-file"),
            _ => types.get(f).map(|t| t.ty.as_str()),
        });
        let v = match ty {
            Some("input-file") => placeholder("input", a),
            Some("output-file") => placeholder("output", a),
            Some("int" | "double") if a.parse::<f64>().is_ok() => a.clone(),
            _ if looks_like_path(a) => placeholder("path", a),
            _ if is_token(a) => a.clone(),
            _ => "<text>".to_string(),
        };
        out.push(v);
    }
    out.truncate(200);
    out
}

/// A CLI message without the paths in it.
pub fn redact_message(m: &str) -> String {
    m.split(' ').map(|t| if looks_like_path(t) { "<path>" } else { t }).collect::<Vec<_>>().join(" ").chars().take(2000).collect()
}

/// The run record of the run whose output @p out is shown (history.rs).
pub fn run_info(dir: &Path, out: &Path) -> Option<RunInfo> {
    let r = crate::history::of_output(dir, out)?;
    let status = match r.status {
        crate::history::Status::Ok => "succeeded",
        crate::history::Status::Cancelled => "cancelled",
        crate::history::Status::Failed => "failed",
    };
    let input = Path::new(&r.input);
    let meta = std::fs::metadata(input).ok();
    let ext = input
        .extension()
        .map(|e| e.to_string_lossy().chars().filter(|c| c.is_ascii_alphanumeric()).take(16).collect())
        .unwrap_or_default();
    let mtime = meta
        .as_ref()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| feedback::iso_utc(d.as_secs()));
    Some(RunInfo {
        id: Some(r.id.chars().filter(|c| c.is_ascii_alphanumeric() || "_.:-".contains(*c)).take(64).collect()),
        status: status.to_string(),
        exit_code: r.exit_code.map(i64::from),
        phase: None,
        message: r.message.as_deref().map(redact_message),
        duration_ms: Some(r.end.saturating_sub(r.start)),
        argv: redact_argv(&r.argv),
        workflow: r.workflow.filter(|w| feedback::is_ident(w)),
        input: Some(InputInfo { ext, size: meta.as_ref().map(|m| m.len()), mtime_utc: mtime }),
    })
}

#[tauri::command]
pub fn feedback_run(app: AppHandle, out: Option<String>) -> Option<RunInfo> {
    let out = out.filter(|o| !o.is_empty())?;
    run_info(&crate::history::dir(&app)?, Path::new(&out))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn argv_without_paths_or_free_text() {
        let a = redact_argv(&s(&[
            "/Applications/FASTag.app/Contents/Resources/bin/FASTag",
            "-in",
            "/Users/alice/patient 12/run01.mzML",
            "-out",
            "C:\\Users\\bob\\out.tags.tsv",
            "-fragment_tolerance",
            "20",
            "-fragment_tolerance_unit",
            "ppm",
            "-recon_fasta",
            "/data/human.fasta",
            "-digest_out",
            "digest.tsv",
            "-species",
            "-search_decoy_prefix",
            "my secret note",
        ]));
        assert_eq!(
            a,
            s(&[
                "FASTag",
                "-in",
                "<input.mzML>",
                "-out",
                "<output.tsv>",
                "-fragment_tolerance",
                "20",
                "-fragment_tolerance_unit",
                "ppm",
                "-recon_fasta",
                "<input.fasta>",
                "-digest_out",
                "<output.tsv>",
                "-species",
                "-search_decoy_prefix",
                "<text>",
            ])
        );
        let joined = a.join(" ");
        assert!(!joined.contains("alice") && !joined.contains("bob") && !joined.contains("patient"));
        // A negative number after a flag stays a value.
        assert_eq!(redact_argv(&s(&["x", "-min_score", "-1.5"]))[2], "-1.5");
    }

    #[test]
    fn messages_lose_paths() {
        assert_eq!(redact_message("cannot open /Users/alice/x.mzML: denied"), "cannot open <path> denied");
    }

    #[test]
    fn capture_replies() {
        let (r, png) = reply(Err("no".into()), 100.0);
        assert_eq!((r.status, r.method, r.error.as_deref()), ("failed", "none", Some("no")));
        assert!(png.is_none());
        let (r, png) = reply(Ok(crate::feedback::tests::png(200, 100)), 100.0);
        assert_eq!((r.status, r.method, r.width, r.height, r.scale), ("ok", "native", 200, 100, 2.0));
        assert!(png.is_some());
        let (r, _) = reply(Ok(b"not a png".to_vec()), 100.0);
        assert_eq!(r.status, "failed");
    }
}
