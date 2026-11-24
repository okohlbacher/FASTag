// In-app feedback (skill gui-feedback; gui/src/feedback/ is the frontend):
// the local report store and the public export.
//
// Two artefacts, never confused:
// - the local report, `<feedback dir>/<YYYYMMDDTHHMMSSZ>_<id8>/report.json`
//   (+ `screenshot.png`, the flattened, annotated image), schema
//   `fastag-feedback/1` (gui/src/feedback/schema/report.schema.json); it never
//   leaves the machine;
// - the public export, `export.json` (`fastag-feedback-public/1`,
//   gui/src/feedback/schema/feedback-public.schema.json), built fresh from
//   typed, allow-listed fields of the report when the user shares it, and
//   zipped with the PNG (if included) into `<id>.feedback.zip` beside it. The
//   preview, Copy diagnostics and the attachment are this one JSON.
//
// The feedback dir is `<app_local_data_dir>/feedback`; every function below
// takes it as a parameter, so the tests run on a temporary folder. Ids come
// from the backend (UUID v4) and are resolved only inside that folder: a
// folder name must have the report pattern, be a real directory (no symlink),
// and its report.json must name the same id.
//
// The native screenshot, the platform and the run on screen are in
// feedback_capture.rs.

use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Manager};

pub const SCHEMA: &str = "fastag-feedback/1";
pub const PUBLIC_SCHEMA: &str = "fastag-feedback-public/1";
pub const REPORT_FILE: &str = "report.json";
pub const SCREENSHOT_FILE: &str = "screenshot.png";
pub const EXPORT_FILE: &str = "export.json";

/// The image caps (the frontend downscales to them before it sends).
pub const MAX_LONG_SIDE: u32 = 2560;
pub const MAX_PIXELS: u64 = 8_000_000;
/// A PNG of the capped size is at most ~32 MB uncompressed RGBA; refuse more.
pub const MAX_PNG_BYTES: usize = 40 * 1024 * 1024;
/// The whole store: a save that would pass it is refused.
pub const STORE_CAP: u64 = 200 * 1024 * 1024;
/// Reports older than this are removed when the store is listed.
pub const RETENTION_DAYS: u64 = 180;
/// The issue form a report is handed to.
pub const ISSUE_PREFIX: &str = "https://github.com/okohlbacher/FASTag/issues/";

// One writer at a time: a save, a delete and an export of the same folder.
static LOCK: Mutex<()> = Mutex::new(());

fn lock() -> std::sync::MutexGuard<'static, ()> {
    LOCK.lock().unwrap_or_else(|p| p.into_inner())
}

/// Per report id, the request number (Exported.seq) of the export its zip
/// now holds, or of the newest one that started writing it. Read and
/// written under LOCK only. An export request older than it is refused
/// (export_ordered), so a late older request never overwrites the zip of a
/// newer one; feedback_reveal shows the zip only for the request the
/// renderer accepted (reveal_target).
static EXPORT_SEQ: Mutex<BTreeMap<String, u64>> = Mutex::new(BTreeMap::new());

/// The refusal of an export request older than the one that wrote the zip.
pub const STALE_EXPORT: &str = "a newer export of this report was built after this request";

// ---------------------------------------------------------------- the report

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct AppInfo {
    pub version: String,
    pub commit: String,
    pub dirty: Option<bool>,
    pub build_date: Option<String>,
    pub channel: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct EngineInfo {
    pub version: Option<String>,
    pub source: String,
    pub bin_size: Option<u64>,
    pub ok: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct PlatformInfo {
    pub os: String,
    pub os_version: String,
    pub arch: String,
    pub webview: String,
    pub webview_version: String,
    pub locale: String,
    pub display_scale: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct WindowInfo {
    pub width: u32,
    pub height: u32,
    pub dpr: f64,
    pub theme: String,
    pub theme_setting: String,
    pub zoom: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ViewInfo {
    pub view: String,
    pub workflow: Option<String>,
    pub tab: Option<String>,
    pub dialog: Option<String>,
    pub mode: String,
    pub help_open: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct InputInfo {
    pub ext: String,
    pub size: Option<u64>,
    pub mtime_utc: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct RunInfo {
    pub id: Option<String>,
    pub status: String,
    pub exit_code: Option<i64>,
    pub phase: Option<String>,
    pub message: Option<String>,
    pub duration_ms: Option<u64>,
    pub argv: Vec<String>,
    pub workflow: Option<String>,
    pub input: Option<InputInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct LogEntry {
    pub level: String,
    pub text: String,
    pub t: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct CaptureInfo {
    pub status: String,
    pub method: String,
    pub api: Option<String>,
    pub error: Option<String>,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
    pub attempt_id: String,
    pub captured_utc: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Annotation {
    pub n: u32,
    #[serde(rename = "type")]
    pub kind: String,
    pub px: Vec<f64>,
    pub text: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(deny_unknown_fields)]
pub struct Share {
    pub screenshot: bool,
    pub diagnostics: bool,
    pub log: bool,
}

/// What the frontend sends to feedback_save: everything but the fields the
/// backend owns (schema, id, created_utc, tz_offset_min, status, issue_url).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Draft {
    pub kind: String,
    pub title: String,
    pub description: String,
    pub steps: String,
    pub expected: String,
    pub actual: String,
    pub app: AppInfo,
    pub engine: EngineInfo,
    pub platform: PlatformInfo,
    pub window: WindowInfo,
    pub view: ViewInfo,
    pub params: BTreeMap<String, Value>,
    pub run: Option<RunInfo>,
    pub log: Vec<LogEntry>,
    pub capture: CaptureInfo,
    pub annotations: Vec<Annotation>,
    pub share: Share,
    pub consent_text_version: String,
}

/// One saved report: the backend's fields and the draft.
#[derive(Debug, Clone, PartialEq)]
pub struct Report {
    pub id: String,
    pub created_utc: String,
    pub tz_offset_min: i32,
    pub status: String,
    pub issue_url: Option<String>,
    pub draft: Draft,
}

const OWN_FIELDS: [&str; 6] = ["schema", "id", "created_utc", "tz_offset_min", "status", "issue_url"];

impl Report {
    pub fn to_json(&self) -> Value {
        let mut m = match serde_json::to_value(&self.draft) {
            Ok(Value::Object(m)) => m,
            _ => Map::new(),
        };
        m.insert("schema".into(), json!(SCHEMA));
        m.insert("id".into(), json!(self.id));
        m.insert("created_utc".into(), json!(self.created_utc));
        m.insert("tz_offset_min".into(), json!(self.tz_offset_min));
        m.insert("status".into(), json!(self.status));
        m.insert("issue_url".into(), json!(self.issue_url));
        Value::Object(m)
    }

    pub fn from_json(v: Value) -> Result<Report, String> {
        let Value::Object(mut m) = v else { return Err("report.json is not an object".into()) };
        if m.get("schema").and_then(Value::as_str) != Some(SCHEMA) {
            return Err(format!("report.json is not {SCHEMA}"));
        }
        let s = |m: &Map<String, Value>, k: &str| m.get(k).and_then(Value::as_str).map(str::to_string);
        let id = s(&m, "id").ok_or("report.json has no id")?;
        let created_utc = s(&m, "created_utc").ok_or("report.json has no created_utc")?;
        let status = s(&m, "status").ok_or("report.json has no status")?;
        let tz_offset_min = m.get("tz_offset_min").and_then(Value::as_i64).ok_or("report.json has no tz_offset_min")? as i32;
        let issue_url = s(&m, "issue_url");
        for k in OWN_FIELDS {
            m.remove(k);
        }
        let draft: Draft = serde_json::from_value(Value::Object(m)).map_err(|e| format!("report.json: {e}"))?;
        let r = Report { id, created_utc, tz_offset_min, status, issue_url, draft };
        r.validate()?;
        Ok(r)
    }

    pub fn validate(&self) -> Result<(), String> {
        if !is_uuid_v4(&self.id) {
            return Err("id is not a UUID v4".into());
        }
        if !is_utc_stamp(&self.created_utc) {
            return Err("created_utc is not an ISO UTC time".into());
        }
        if !(-840..=840).contains(&self.tz_offset_min) {
            return Err("tz_offset_min out of range".into());
        }
        one_of("status", &self.status, &["saved", "handoff_opened", "submitted"])?;
        if let Some(u) = &self.issue_url {
            if !is_issue_url(u) {
                return Err(format!("issue_url must be {ISSUE_PREFIX}<number>"));
            }
        }
        validate_draft(&self.draft)
    }
}

// ------------------------------------------------------------- validation

fn max_len(name: &str, s: &str, max: usize) -> Result<(), String> {
    let n = s.chars().count();
    if n > max {
        return Err(format!("{name} is {n} characters long (at most {max})"));
    }
    Ok(())
}

fn opt_len(name: &str, s: &Option<String>, max: usize) -> Result<(), String> {
    s.as_deref().map_or(Ok(()), |s| max_len(name, s, max))
}

fn one_of(name: &str, s: &str, allowed: &[&str]) -> Result<(), String> {
    if allowed.contains(&s) {
        Ok(())
    } else {
        Err(format!("{name} must be one of {}", allowed.join(", ")))
    }
}

/// `^[A-Za-z0-9_.:-]+$`, at most 64 characters (the schemas' ident).
pub fn is_ident(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b"_.:-".contains(&b))
}

fn ident(name: &str, s: &str) -> Result<(), String> {
    if is_ident(s) {
        Ok(())
    } else {
        Err(format!("{name} must be a machine id"))
    }
}

fn opt_ident(name: &str, s: &Option<String>) -> Result<(), String> {
    s.as_deref().map_or(Ok(()), |s| ident(name, s))
}

fn is_ext(s: &str) -> bool {
    s.len() <= 16 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.')
}

fn finite(name: &str, x: f64, lo: f64, hi: f64) -> Result<(), String> {
    if x.is_finite() && x >= lo && x <= hi {
        Ok(())
    } else {
        Err(format!("{name} out of range"))
    }
}

pub fn is_uuid_v4(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 36 {
        return false;
    }
    for (i, &c) in b.iter().enumerate() {
        let ok = match i {
            8 | 13 | 18 | 23 => c == b'-',
            14 => c == b'4',
            19 => b"89ab".contains(&c),
            _ => c.is_ascii_digit() || (b'a'..=b'f').contains(&c),
        };
        if !ok {
            return false;
        }
    }
    true
}

fn is_utc_stamp(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 20
        && b.iter().enumerate().all(|(i, &c)| match i {
            4 | 7 => c == b'-',
            10 => c == b'T',
            13 | 16 => c == b':',
            19 => c == b'Z',
            _ => c.is_ascii_digit(),
        })
}

pub fn is_issue_url(u: &str) -> bool {
    u.strip_prefix(ISSUE_PREFIX)
        .is_some_and(|n| !n.is_empty() && n.len() <= 9 && n.bytes().all(|b| b.is_ascii_digit()))
}

fn is_commit(s: &str) -> bool {
    s == "unknown" || ((7..=40).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
}

/// A parameter name: `^[a-z][a-z0-9_]*$`, at most 64.
fn is_param_name(s: &str) -> bool {
    let b = s.as_bytes();
    !b.is_empty() && b.len() <= 64 && b[0].is_ascii_lowercase() && b.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'_')
}

/// A parameter value of the allow-list: null, a bool, a number, a short
/// string (an enum value) or a path as {role, ext}.
fn valid_param(v: &Value) -> bool {
    match v {
        Value::Null | Value::Bool(_) => true,
        Value::Number(n) => n.as_f64().is_some_and(f64::is_finite),
        Value::String(s) => s.chars().count() <= 200,
        Value::Object(o) => {
            o.keys().all(|k| k == "role" || k == "ext")
                && o.get("role").and_then(Value::as_str).is_some_and(is_ident)
                && o.get("ext").is_none_or(|e| e.as_str().is_some_and(is_ext))
        }
        Value::Array(_) => false,
    }
}

pub fn validate_draft(d: &Draft) -> Result<(), String> {
    one_of("kind", &d.kind, &["bug", "ui", "idea", "question"])?;
    if d.title.trim().is_empty() {
        return Err("the title is empty".into());
    }
    max_len("title", &d.title, 120)?;
    max_len("description", &d.description, 4000)?;
    max_len("steps", &d.steps, 2000)?;
    max_len("expected", &d.expected, 2000)?;
    max_len("actual", &d.actual, 2000)?;

    let a = &d.app;
    max_len("app.version", &a.version, 64)?;
    if !is_commit(&a.commit) {
        return Err("app.commit must be a hex commit or \"unknown\"".into());
    }
    opt_len("app.build_date", &a.build_date, 40)?;
    one_of("app.channel", &a.channel, &["release", "prerelease", "dev", "e2e"])?;

    let e = &d.engine;
    opt_len("engine.version", &e.version, 200)?;
    one_of("engine.source", &e.source, &["env", "bundled", "path", "missing", "unknown"])?;

    let p = &d.platform;
    one_of("platform.os", &p.os, &["macos", "windows", "linux", "other"])?;
    max_len("platform.os_version", &p.os_version, 64)?;
    max_len("platform.arch", &p.arch, 16)?;
    one_of("platform.webview", &p.webview, &["wkwebview", "webview2", "webkitgtk", "browser"])?;
    max_len("platform.webview_version", &p.webview_version, 64)?;
    max_len("platform.locale", &p.locale, 35)?;
    finite("platform.display_scale", p.display_scale, 0.0, 16.0)?;

    let w = &d.window;
    if w.width > 100_000 || w.height > 100_000 {
        return Err("window size out of range".into());
    }
    finite("window.dpr", w.dpr, 0.0, 16.0)?;
    finite("window.zoom", w.zoom, 0.0, 16.0)?;
    one_of("window.theme", &w.theme, &["light", "dark"])?;
    one_of("window.theme_setting", &w.theme_setting, &["system", "light", "dark"])?;

    let v = &d.view;
    ident("view.view", &v.view)?;
    opt_ident("view.workflow", &v.workflow)?;
    opt_ident("view.tab", &v.tab)?;
    opt_ident("view.dialog", &v.dialog)?;
    one_of("view.mode", &v.mode, &["single", "batch"])?;

    if d.params.len() > 200 {
        return Err("more than 200 parameters".into());
    }
    for (k, val) in &d.params {
        if !is_param_name(k) {
            return Err(format!("parameter name {k:?} is not allowed"));
        }
        if !valid_param(val) {
            return Err(format!("parameter {k} must be a scalar or {{role, ext}}"));
        }
    }

    if let Some(r) = &d.run {
        if let Some(id) = &r.id {
            if id.len() > 64 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b"_.:-".contains(&b)) {
                return Err("run.id must be a machine id".into());
            }
        }
        one_of("run.status", &r.status, &["none", "running", "succeeded", "failed", "cancelled"])?;
        if let Some(c) = r.exit_code {
            if !(-2_147_483_648..=4_294_967_295).contains(&c) {
                return Err("run.exit_code out of range".into());
            }
        }
        opt_len("run.phase", &r.phase, 120)?;
        opt_len("run.message", &r.message, 2000)?;
        if r.argv.len() > 200 {
            return Err("run.argv has more than 200 entries".into());
        }
        for a in &r.argv {
            max_len("run.argv entry", a, 1000)?;
        }
        opt_ident("run.workflow", &r.workflow)?;
        if let Some(i) = &r.input {
            if !is_ext(&i.ext) {
                return Err("run.input.ext must be an extension".into());
            }
            opt_len("run.input.mtime_utc", &i.mtime_utc, 40)?;
        }
    }

    if d.log.len() > 50 {
        return Err("more than 50 log entries".into());
    }
    for l in &d.log {
        one_of("log level", &l.level, &["error", "warn"])?;
        max_len("log text", &l.text, 2000)?;
    }

    let c = &d.capture;
    one_of("capture.status", &c.status, &["ok", "degraded", "failed", "removed", "none"])?;
    one_of("capture.method", &c.method, &["native", "dom", "none"])?;
    opt_len("capture.api", &c.api, 64)?;
    opt_len("capture.error", &c.error, 500)?;
    if c.width > MAX_LONG_SIDE || c.height > MAX_LONG_SIDE {
        return Err(format!("capture size above {MAX_LONG_SIDE} px"));
    }
    finite("capture.scale", c.scale, 0.0, 16.0)?;
    ident("capture.attempt_id", &c.attempt_id)?;
    max_len("capture.captured_utc", &c.captured_utc, 40)?;

    if d.annotations.len() > 100 {
        return Err("more than 100 annotations".into());
    }
    for a in &d.annotations {
        if !(1..=1000).contains(&a.n) {
            return Err("annotation number out of range".into());
        }
        one_of("annotation type", &a.kind, &["rect", "arrow", "pen", "text", "redact"])?;
        if a.px.len() > 4000 {
            return Err("annotation has too many points".into());
        }
        for x in &a.px {
            finite("annotation point", *x, -100_000.0, 100_000.0)?;
        }
        opt_len("annotation text", &a.text, 200)?;
    }
    ident("consent_text_version", &d.consent_text_version)?;
    Ok(())
}

// --------------------------------------------------------------------- PNG

const PNG_SIG: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];

/// CRC-32 (IEEE, the one of PNG and zip).
pub fn crc32(data: &[u8]) -> u32 {
    static TABLE: std::sync::LazyLock<[u32; 256]> = std::sync::LazyLock::new(|| {
        let mut t = [0u32; 256];
        for (n, e) in t.iter_mut().enumerate() {
            let mut c = n as u32;
            for _ in 0..8 {
                c = if c & 1 != 0 { 0xedb8_8320 ^ (c >> 1) } else { c >> 1 };
            }
            *e = c;
        }
        t
    });
    let mut c = 0xffff_ffffu32;
    for &b in data {
        c = TABLE[((c ^ b as u32) & 0xff) as usize] ^ (c >> 8);
    }
    c ^ 0xffff_ffff
}

/// Width and height from a PNG's IHDR.
pub fn png_size(png: &[u8]) -> Option<(u32, u32)> {
    if png.len() < 24 || png[..8] != PNG_SIG || &png[12..16] != b"IHDR" {
        return None;
    }
    let w = u32::from_be_bytes(png[16..20].try_into().ok()?);
    let h = u32::from_be_bytes(png[20..24].try_into().ok()?);
    Some((w, h))
}

/// The PNG checked chunk by chunk (lengths, CRCs, IHDR first, IEND last)
/// and rewritten with the image chunks only (IHDR, PLTE, tRNS, IDAT, IEND):
/// no text, time, EXIF or colour-profile metadata reaches the store.
pub fn png_clean(png: &[u8]) -> Result<Vec<u8>, String> {
    if png.len() > MAX_PNG_BYTES {
        return Err(format!("the screenshot is larger than {} MB", MAX_PNG_BYTES / (1024 * 1024)));
    }
    if png.len() < 8 || png[..8] != PNG_SIG {
        return Err("the screenshot is not a PNG".into());
    }
    let mut out = PNG_SIG.to_vec();
    let mut at = 8usize;
    let mut first = true;
    let mut ended = false;
    while at < png.len() {
        if png.len() - at < 12 {
            return Err("the PNG is truncated".into());
        }
        let len = u32::from_be_bytes(png[at..at + 4].try_into().unwrap()) as usize;
        let end = at.checked_add(12).and_then(|x| x.checked_add(len)).filter(|&e| e <= png.len()).ok_or("the PNG is truncated")?;
        let ty = &png[at + 4..at + 8];
        let crc = u32::from_be_bytes(png[end - 4..end].try_into().unwrap());
        if crc32(&png[at + 4..end - 4]) != crc {
            return Err("the PNG has a damaged chunk".into());
        }
        if first && ty != b"IHDR" {
            return Err("the PNG does not start with IHDR".into());
        }
        first = false;
        if matches!(ty, b"IHDR" | b"PLTE" | b"tRNS" | b"IDAT" | b"IEND") {
            out.extend_from_slice(&png[at..end]);
        }
        at = end;
        if ty == b"IEND" {
            ended = true;
            break;
        }
    }
    if !ended {
        return Err("the PNG has no IEND".into());
    }
    Ok(out)
}

/// The image caps: ≤ 2,560 px on the long side and ≤ 8 M pixels.
pub fn check_caps(w: u32, h: u32) -> Result<(), String> {
    if w == 0 || h == 0 {
        return Err("the screenshot is empty".into());
    }
    if w.max(h) > MAX_LONG_SIDE || (w as u64) * (h as u64) > MAX_PIXELS {
        return Err(format!(
            "the screenshot is {w}×{h} px; at most {MAX_LONG_SIDE} px on the long side and 8 million pixels"
        ));
    }
    Ok(())
}

// -------------------------------------------------------------------- time

/// (year, month, day, hour, minute, second) of Unix time @p secs, UTC.
pub fn utc_parts(secs: u64) -> (i64, u32, u32, u32, u32, u32) {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    // H. Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d, (rem / 3600) as u32, (rem / 60 % 60) as u32, (rem % 60) as u32)
}

pub fn iso_utc(secs: u64) -> String {
    let (y, mo, d, h, mi, s) = utc_parts(secs);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z")
}

/// The folder stamp, `YYYYMMDDTHHMMSSZ` (no ':', which Windows forbids).
pub fn folder_stamp(secs: u64) -> String {
    let (y, mo, d, h, mi, s) = utc_parts(secs);
    format!("{y:04}{mo:02}{d:02}T{h:02}{mi:02}{s:02}Z")
}

fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// The local time zone's offset from UTC in minutes at @p secs (east positive).
pub fn tz_offset_min(secs: u64) -> i32 {
    #[cfg(unix)]
    {
        let t = secs as libc::time_t;
        let mut tm: libc::tm = unsafe { std::mem::zeroed() };
        // SAFETY: localtime_r writes only into tm.
        if unsafe { libc::localtime_r(&t, &mut tm) }.is_null() {
            return 0;
        }
        (tm.tm_gmtoff / 60).clamp(-840, 840) as i32
    }
    #[cfg(windows)]
    {
        let _ = secs;
        use windows_sys::Win32::System::Time::{GetTimeZoneInformation, TIME_ZONE_INFORMATION};
        let mut tz: TIME_ZONE_INFORMATION = unsafe { std::mem::zeroed() };
        // SAFETY: fills tz; 2 = TIME_ZONE_ID_DAYLIGHT.
        let r = unsafe { GetTimeZoneInformation(&mut tz) };
        let bias = tz.Bias + if r == 2 { tz.DaylightBias } else { tz.StandardBias };
        (-bias).clamp(-840, 840)
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = secs;
        0
    }
}

/// A random UUID v4 (RFC 9562) from the OS generator.
pub fn uuid_v4() -> Result<String, String> {
    let mut b = [0u8; 16];
    getrandom::fill(&mut b).map_err(|e| format!("no random numbers: {e}"))?;
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
    Ok(format!("{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32]))
}

// ------------------------------------------------------------------- store

pub fn dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_local_data_dir().ok().map(|d| d.join("feedback"))
}

/// `<YYYYMMDDTHHMMSSZ>_<id8>`.
pub fn is_report_folder(name: &str) -> bool {
    let b = name.as_bytes();
    b.len() == 25
        && b.iter().enumerate().all(|(i, &c)| match i {
            8 => c == b'T',
            15 => c == b'Z',
            16 => c == b'_',
            0..=14 => c.is_ascii_digit(),
            _ => c.is_ascii_digit() || (b'a'..=b'f').contains(&c),
        })
}

fn is_real_dir(p: &Path) -> bool {
    std::fs::symlink_metadata(p).is_ok_and(|m| m.file_type().is_dir())
}

fn is_real_file(p: &Path) -> bool {
    std::fs::symlink_metadata(p).is_ok_and(|m| m.file_type().is_file())
}

/// Read a report.json that is a real file (no symlink).
fn read_report(folder: &Path) -> Result<Report, String> {
    let p = folder.join(REPORT_FILE);
    if !is_real_file(&p) {
        return Err(format!("{} is missing", p.display()));
    }
    let text = std::fs::read_to_string(&p).map_err(|e| format!("{}: {e}", p.display()))?;
    let v: Value = serde_json::from_str(&text).map_err(|e| format!("{}: {e}", p.display()))?;
    Report::from_json(v)
}

/// The folder of report @p id, only inside @p dir.
pub fn resolve(dir: &Path, id: &str) -> Result<PathBuf, String> {
    if !is_uuid_v4(id) {
        return Err("not a feedback report id".into());
    }
    let suffix = format!("_{}", &id[..8]);
    let entries = std::fs::read_dir(dir).map_err(|_| "no feedback reports".to_string())?;
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if !is_report_folder(&name) || !name.ends_with(&suffix) {
            continue;
        }
        let p = e.path();
        if is_real_dir(&p) && read_report(&p).is_ok_and(|r| r.id == id) {
            return Ok(p);
        }
    }
    Err(format!("no feedback report {id}"))
}

fn dir_size(p: &Path) -> u64 {
    let Ok(rd) = std::fs::read_dir(p) else { return 0 };
    rd.flatten()
        .map(|e| match e.metadata() {
            Ok(m) if m.is_dir() => dir_size(&e.path()),
            Ok(m) => m.len(),
            Err(_) => 0,
        })
        .sum()
}

/// Write @p bytes to @p p through a temporary file in the same folder.
fn write_atomic(p: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = p.with_extension("part");
    {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    std::fs::rename(&tmp, p)
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Saved {
    pub id: String,
    pub folder: String,
    pub created_utc: String,
    pub status: String,
}

/// Save @p draft (and the flattened screenshot @p png) as a new report in
/// @p dir at Unix time @p now: validated, given an id, written to a
/// temporary folder and renamed into place; an existing report is never
/// overwritten.
pub fn save(dir: &Path, draft: Draft, png: Option<&[u8]>, now: u64) -> Result<Saved, String> {
    validate_draft(&draft)?;
    let png = match png {
        Some(b) => {
            let clean = png_clean(b)?;
            let (w, h) = png_size(&clean).ok_or("the screenshot is not a PNG")?;
            check_caps(w, h)?;
            if !matches!(draft.capture.status.as_str(), "ok" | "degraded") {
                return Err(format!("a screenshot was sent with capture status {}", draft.capture.status));
            }
            if (w, h) != (draft.capture.width, draft.capture.height) {
                return Err(format!(
                    "the screenshot is {w}×{h} px, the report says {}×{}",
                    draft.capture.width, draft.capture.height
                ));
            }
            Some(clean)
        }
        None => {
            if matches!(draft.capture.status.as_str(), "ok" | "degraded") {
                return Err("capture status says ok but no screenshot was sent".into());
            }
            None
        }
    };
    let id = uuid_v4()?;
    let report = Report {
        created_utc: iso_utc(now),
        tz_offset_min: tz_offset_min(now),
        status: "saved".into(),
        issue_url: None,
        draft,
        id,
    };
    report.validate()?;
    let json = serde_json::to_vec_pretty(&report.to_json()).map_err(|e| e.to_string())?;

    let _g = lock();
    std::fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    let incoming = json.len() as u64 + png.as_ref().map_or(0, |p| p.len() as u64);
    let used = dir_size(dir);
    if used + incoming > STORE_CAP {
        return Err(format!(
            "the feedback store is full ({} MB of {} MB); delete older reports first",
            used / (1024 * 1024),
            STORE_CAP / (1024 * 1024)
        ));
    }
    let name = format!("{}_{}", folder_stamp(now), &report.id[..8]);
    let dest = dir.join(&name);
    if std::fs::symlink_metadata(&dest).is_ok() {
        return Err(format!("{} exists already", dest.display()));
    }
    let tmp = dir.join(format!(".tmp-{}", report.id));
    let write = || -> std::io::Result<()> {
        std::fs::create_dir(&tmp)?;
        write_atomic(&tmp.join(REPORT_FILE), &json)?;
        if let Some(p) = &png {
            write_atomic(&tmp.join(SCREENSHOT_FILE), p)?;
        }
        std::fs::rename(&tmp, &dest)
    };
    if let Err(e) = write() {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(format!("cannot save the report: {e}"));
    }
    Ok(Saved { id: report.id, folder: dest.display().to_string(), created_utc: report.created_utc, status: report.status })
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Summary {
    pub id: String,
    pub folder: String,
    pub created_utc: String,
    pub kind: String,
    pub title: String,
    pub status: String,
    pub issue_url: Option<String>,
    pub screenshot: bool,
    pub zip: Option<String>,
    pub bytes: u64,
}

fn zip_name(id: &str) -> String {
    format!("{id}.feedback.zip")
}

/// The reports in @p dir, newest first, without their images. Reports
/// older than RETENTION_DAYS (by folder name) and temporary folders of an
/// interrupted save older than an hour are removed first.
pub fn list(dir: &Path, now: u64) -> Vec<Summary> {
    let _g = lock();
    let Ok(rd) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut out = Vec::new();
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let p = e.path();
        if name.starts_with(".tmp-") && is_real_dir(&p) {
            let old = e.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|a| a.as_secs() > 3600);
            if old {
                let _ = std::fs::remove_dir_all(&p);
            }
            continue;
        }
        if !is_report_folder(&name) || !is_real_dir(&p) {
            continue;
        }
        let Ok(r) = read_report(&p) else { continue };
        if !p.file_name().is_some_and(|n| n.to_string_lossy().ends_with(&r.id[..8])) {
            continue;
        }
        if stamp_secs(&name).is_some_and(|t| now.saturating_sub(t) > RETENTION_DAYS * 86_400) {
            let _ = std::fs::remove_dir_all(&p);
            continue;
        }
        let zip = p.join(zip_name(&r.id));
        out.push(Summary {
            folder: p.display().to_string(),
            created_utc: r.created_utc.clone(),
            kind: r.draft.kind.clone(),
            title: r.draft.title.clone(),
            status: r.status.clone(),
            issue_url: r.issue_url.clone(),
            screenshot: is_real_file(&p.join(SCREENSHOT_FILE)),
            zip: is_real_file(&zip).then(|| zip.display().to_string()),
            bytes: dir_size(&p),
            id: r.id,
        });
    }
    out.sort_by(|a, b| b.created_utc.cmp(&a.created_utc).then(b.id.cmp(&a.id)));
    out
}

/// Unix time of a folder stamp `YYYYMMDDTHHMMSSZ_...`.
fn stamp_secs(name: &str) -> Option<u64> {
    let n = |r: std::ops::Range<usize>| name.get(r)?.parse::<i64>().ok();
    let (y, m, d) = (n(0..4)?, n(4..6)?, n(6..8)?);
    let (h, mi, s) = (n(9..11)?, n(11..13)?, n(13..15)?);
    // days_from_civil.
    let y2 = if m <= 2 { y - 1 } else { y };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    u64::try_from(days * 86_400 + h * 3600 + mi * 60 + s).ok()
}

pub fn delete(dir: &Path, id: &str) -> Result<(), String> {
    let _g = lock();
    let p = resolve(dir, id)?;
    std::fs::remove_dir_all(&p).map_err(|e| format!("cannot delete {}: {e}", p.display()))
}

/// Delete every report in @p dir (only folders of the report pattern).
pub fn delete_all(dir: &Path) -> Result<usize, String> {
    let _g = lock();
    let Ok(rd) = std::fs::read_dir(dir) else { return Ok(0) };
    let mut n = 0;
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let p = e.path();
        if (is_report_folder(&name) || name.starts_with(".tmp-")) && is_real_dir(&p) {
            std::fs::remove_dir_all(&p).map_err(|e| format!("cannot delete {}: {e}", p.display()))?;
            n += usize::from(is_report_folder(&name));
        }
    }
    Ok(n)
}

/// saved → handoff_opened → submitted (never back); submitted needs the
/// issue URL the user pasted.
pub fn set_status(dir: &Path, id: &str, status: &str, issue_url: Option<String>) -> Result<(), String> {
    let _g = lock();
    let p = resolve(dir, id)?;
    let mut r = read_report(&p)?;
    let rank = |s: &str| ["saved", "handoff_opened", "submitted"].iter().position(|x| *x == s);
    let (Some(from), Some(to)) = (rank(&r.status), rank(status)) else {
        return Err(format!("unknown status {status}"));
    };
    if to < from {
        return Err(format!("a report that is {} cannot go back to {status}", r.status));
    }
    if status == "submitted" {
        let u = issue_url.as_deref().map(str::trim).filter(|u| is_issue_url(u)).ok_or(format!(
            "paste the issue's address ({ISSUE_PREFIX}<number>)"
        ))?;
        r.issue_url = Some(u.to_string());
    }
    r.status = status.to_string();
    r.validate()?;
    let json = serde_json::to_vec_pretty(&r.to_json()).map_err(|e| e.to_string())?;
    write_atomic(&p.join(REPORT_FILE), &json).map_err(|e| format!("cannot update the report: {e}"))
}

// ----------------------------------------------------------------- export

/// A string kept only when every character is one of @p ok (and it fits).
fn keep_if(s: &str, max: usize, ok: impl Fn(char) -> bool) -> Option<String> {
    (!s.is_empty() && s.chars().count() <= max && s.chars().all(ok)).then(|| s.to_string())
}

fn semver(s: &str) -> bool {
    let (core, _) = s.split_once(['-', '+']).unwrap_or((s, ""));
    let parts: Vec<&str> = core.split('.').collect();
    s.len() <= 64
        && parts.len() == 3
        && parts.iter().all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
        && s.bytes().all(|b| b.is_ascii_alphanumeric() || b"._+-".contains(&b))
}

/// A run phase as a machine id ("Tagging spectra" -> "tagging_spectra").
fn phase_id(s: &str) -> Option<String> {
    let id: String = s
        .trim()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || "_.:-".contains(c) { c.to_ascii_lowercase() } else { '_' })
        .take(64)
        .collect();
    let id = id.trim_matches('_').to_string();
    is_ident(&id).then_some(id)
}

fn locale_ok(s: &str) -> bool {
    let mut parts = s.split(['-', '_']);
    let first = parts.next().unwrap_or("");
    s.len() <= 35
        && (2..=8).contains(&first.len())
        && first.bytes().all(|b| b.is_ascii_alphabetic())
        && parts.all(|p| (1..=8).contains(&p.len()) && p.bytes().all(|b| b.is_ascii_alphanumeric()))
}

fn version_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || " ._()+-".contains(c)
}

/// What a public export includes.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct Include {
    pub screenshot: bool,
    pub diagnostics: bool,
    pub log: bool,
}

/// The public export (`fastag-feedback-public/1`) of @p r: built fresh from
/// typed fields, each value kept only when it has the public schema's form
/// (a dropped one names its top-level field in `truncated`).
/// @p screenshot: the report has a screenshot.png.
pub fn public_export(r: &Report, inc: Include, screenshot: bool) -> Value {
    let d = &r.draft;
    let mut m = Map::new();
    let mut truncated: Vec<&str> = Vec::new();
    m.insert("schema".into(), json!(PUBLIC_SCHEMA));
    m.insert("id".into(), json!(r.id));
    m.insert("created_utc".into(), json!(r.created_utc));
    m.insert("kind".into(), json!(d.kind));
    m.insert("title".into(), json!(d.title.chars().take(120).collect::<String>()));
    if inc.diagnostics {
        let mut app = Map::new();
        match semver(&d.app.version) {
            true => _ = app.insert("version".into(), json!(d.app.version)),
            false => truncated.push("app"),
        }
        if d.app.commit != "unknown" {
            app.insert("commit".into(), json!(d.app.commit));
        }
        if let Some(x) = d.app.dirty {
            app.insert("dirty".into(), json!(x));
        }
        if let Some(b) = d.app.build_date.as_deref().filter(|b| is_utc_stamp(b) || (b.len() == 10 && is_utc_stamp(&format!("{b}T00:00:00Z")))) {
            app.insert("build_date".into(), json!(b));
        }
        app.insert("channel".into(), json!(d.app.channel));
        m.insert("app".into(), Value::Object(app));

        let mut eng = Map::new();
        if let Some(v) = &d.engine.version {
            eng.insert("version".into(), json!(v.chars().take(200).collect::<String>()));
        }
        match d.engine.source.as_str() {
            "bundled" => _ = eng.insert("source".into(), json!("bundled")),
            "env" | "path" => _ = eng.insert("source".into(), json!("override")),
            _ => {}
        }
        m.insert("engine".into(), Value::Object(eng));

        let p = &d.platform;
        let mut plat = Map::new();
        let mut dropped = false;
        if p.os != "other" {
            plat.insert("os".into(), json!(p.os));
        }
        match keep_if(&p.os_version, 64, version_char) {
            Some(v) => _ = plat.insert("os_version".into(), json!(v)),
            None => dropped |= !p.os_version.is_empty(),
        }
        if ["aarch64", "x86_64", "arm", "x86"].contains(&p.arch.as_str()) {
            plat.insert("arch".into(), json!(p.arch));
        } else {
            dropped = true;
        }
        plat.insert("webview".into(), json!(p.webview));
        match keep_if(&p.webview_version, 64, version_char) {
            Some(v) => _ = plat.insert("webview_version".into(), json!(v)),
            None => dropped |= !p.webview_version.is_empty(),
        }
        if locale_ok(&p.locale) {
            plat.insert("locale".into(), json!(p.locale));
        } else {
            dropped |= !p.locale.is_empty();
        }
        if dropped {
            truncated.push("platform");
        }
        m.insert("platform".into(), Value::Object(plat));

        let w = &d.window;
        m.insert("window".into(), json!({ "width": w.width, "height": w.height, "dpr": w.dpr, "theme": w.theme }));

        let mut view = Map::new();
        view.insert("view".into(), json!(d.view.view));
        for (k, v) in [("workflow", &d.view.workflow), ("tab", &d.view.tab), ("dialog", &d.view.dialog)] {
            if let Some(v) = v {
                view.insert(k.into(), json!(v));
            }
        }
        m.insert("view".into(), Value::Object(view));

        let params: Map<String, Value> =
            d.params.iter().filter(|(k, v)| is_param_name(k) && valid_param(v)).map(|(k, v)| (k.clone(), v.clone())).collect();
        m.insert("params".into(), Value::Object(params));

        if let Some(run) = &d.run {
            let mut rm = Map::new();
            rm.insert("status".into(), json!(run.status));
            rm.insert("exit_code".into(), json!(run.exit_code));
            if let Some(ph) = run.phase.as_deref().and_then(phase_id) {
                rm.insert("phase".into(), json!(ph));
            }
            if let Some(msg) = &run.message {
                rm.insert("message".into(), json!(msg.chars().take(2000).collect::<String>()));
            }
            if let Some(ms) = run.duration_ms {
                rm.insert("duration_s".into(), json!(ms as f64 / 1000.0));
            }
            rm.insert("argv".into(), json!(run.argv.iter().take(200).collect::<Vec<_>>()));
            m.insert("run".into(), Value::Object(rm));
        }
    }
    if inc.log {
        let log: Vec<&str> = d.log.iter().rev().take(50).rev().map(|l| l.text.as_str()).collect();
        m.insert("log".into(), json!(log));
    }
    if inc.screenshot && screenshot {
        let c = &d.capture;
        m.insert("capture".into(), json!({ "status": c.status, "method": c.method, "width": c.width, "height": c.height }));
        m.insert("annotations".into(), json!(d.annotations.len()));
    }
    if !truncated.is_empty() {
        m.insert("truncated".into(), json!(truncated));
    }
    Value::Object(m)
}

/// A zip of @p files, stored (no compression), with their CRC-32: what
/// the issue form's upload field takes. Times are @p secs (UTC, DOS form).
pub fn zip_stored(files: &[(&str, &[u8])], secs: u64) -> Vec<u8> {
    let (y, mo, d, h, mi, s) = utc_parts(secs);
    let dos_time = ((h << 11) | (mi << 5) | (s / 2)) as u16;
    let dos_date = ((((y - 1980).clamp(0, 127) as u32) << 9) | (mo << 5) | d) as u16;
    let mut out = Vec::new();
    let mut central = Vec::new();
    for (name, data) in files {
        let crc = crc32(data);
        let offset = out.len() as u32;
        let n = name.as_bytes();
        let size = data.len() as u32;
        let header = |sig: u32, central: bool| {
            let mut v = Vec::new();
            v.extend_from_slice(&sig.to_le_bytes());
            if central {
                v.extend_from_slice(&20u16.to_le_bytes()); // made by
            }
            v.extend_from_slice(&20u16.to_le_bytes()); // needed: 2.0
            v.extend_from_slice(&0x0800u16.to_le_bytes()); // UTF-8 names
            v.extend_from_slice(&0u16.to_le_bytes()); // stored
            v.extend_from_slice(&dos_time.to_le_bytes());
            v.extend_from_slice(&dos_date.to_le_bytes());
            v.extend_from_slice(&crc.to_le_bytes());
            v.extend_from_slice(&size.to_le_bytes());
            v.extend_from_slice(&size.to_le_bytes());
            v.extend_from_slice(&(n.len() as u16).to_le_bytes());
            v.extend_from_slice(&0u16.to_le_bytes()); // extra
            if central {
                v.extend_from_slice(&0u16.to_le_bytes()); // comment
                v.extend_from_slice(&0u16.to_le_bytes()); // disk
                v.extend_from_slice(&0u16.to_le_bytes()); // internal attrs
                v.extend_from_slice(&0u32.to_le_bytes()); // external attrs
                v.extend_from_slice(&offset.to_le_bytes());
            }
            v.extend_from_slice(n);
            v
        };
        out.extend(header(0x0403_4b50, false));
        out.extend_from_slice(data);
        central.extend(header(0x0201_4b50, true));
    }
    let cd_offset = out.len() as u32;
    let cd_size = central.len() as u32;
    out.extend(central);
    out.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&(files.len() as u16).to_le_bytes());
    out.extend_from_slice(&(files.len() as u16).to_le_bytes());
    out.extend_from_slice(&cd_size.to_le_bytes());
    out.extend_from_slice(&cd_offset.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ImageInfo {
    pub bytes: u64,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Exported {
    /// The zip, absolute.
    pub zip: String,
    /// export.json exactly as it is in the zip (the preview and Copy
    /// diagnostics show and copy this text).
    pub json: String,
    /// The PNG in the zip, if any.
    pub image: Option<ImageInfo>,
    /// The request number this zip was built for (export_ordered): the zip
    /// feedback_reveal shows for it is exactly this one.
    pub seq: u64,
}

/// Write `<id>.feedback.zip` (export.json and, if included, the PNG) into
/// the report's folder. An earlier export of it is removed first, so a
/// failed export leaves no zip of other choices behind (one with a
/// screenshot since left out): feedback_reveal then shows report.json.
#[cfg(test)]
pub fn export(dir: &Path, id: &str, inc: Include, now: u64) -> Result<Exported, String> {
    export_ordered(dir, id, inc, now, None)
}

/// export() in request order: @p seq numbers the request (the renderer's,
/// increasing; None: newer than every request so far). Under the store's
/// lock, a request older than the one whose export the zip holds is refused
/// (STALE_EXPORT) and writes nothing, whatever order the requests reach the
/// lock in: the zip is always that of the newest request that ran.
pub fn export_ordered(dir: &Path, id: &str, inc: Include, now: u64, seq: Option<u64>) -> Result<Exported, String> {
    let _g = lock();
    let p = resolve(dir, id)?;
    let seq = {
        let mut m = EXPORT_SEQ.lock().unwrap_or_else(|e| e.into_inner());
        let last = m.get(id).copied().unwrap_or(0);
        let seq = seq.unwrap_or(last + 1);
        if seq < last {
            return Err(STALE_EXPORT.to_string());
        }
        // Claimed before the old zip goes: a failed build leaves none, and
        // an older request coming later is still refused.
        m.insert(id.to_string(), seq);
        seq
    };
    let old = p.join(zip_name(id));
    match std::fs::remove_file(&old) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("cannot remove the earlier export {}: {e}", old.display())),
    }
    let r = read_report(&p)?;
    let shot = p.join(SCREENSHOT_FILE);
    let png = if is_real_file(&shot) { Some(std::fs::read(&shot).map_err(|e| e.to_string())?) } else { None };
    let value = public_export(&r, inc, png.is_some());
    let json = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    let mut files: Vec<(&str, &[u8])> = vec![(EXPORT_FILE, json.as_bytes())];
    let image = match (&png, inc.screenshot) {
        (Some(b), true) => {
            files.push((SCREENSHOT_FILE, b));
            let (width, height) = png_size(b).unwrap_or((0, 0));
            Some(ImageInfo { bytes: b.len() as u64, width, height })
        }
        _ => None,
    };
    let zip = p.join(zip_name(&r.id));
    write_atomic(&zip, &zip_stored(&files, now)).map_err(|e| format!("cannot write {}: {e}", zip.display()))?;
    Ok(Exported { zip: zip.display().to_string(), json, image, seq })
}

/// What feedback_reveal shows for report @p id: with @p seq (the request
/// the renderer accepted), its zip, and only while the zip is still that
/// request's (no other export ran since); without, the zip if there is one,
/// else report.json (the reports list).
pub fn reveal_target(dir: &Path, id: &str, seq: Option<u64>) -> Result<PathBuf, String> {
    let _g = lock();
    let p = resolve(dir, id)?;
    let zip = p.join(zip_name(id));
    match seq {
        Some(s) => {
            let held = EXPORT_SEQ.lock().unwrap_or_else(|e| e.into_inner()).get(id).copied();
            if held != Some(s) || !is_real_file(&zip) {
                return Err("the export shown is no longer the zip in the report's folder; change a choice to build it again".into());
            }
            Ok(zip)
        }
        None => Ok(if is_real_file(&zip) { zip } else { p.join(REPORT_FILE) }),
    }
}

// ------------------------------------------------------------- IPC frames

/// A binary frame both ways: [u32 LE length of the JSON][JSON][PNG bytes].
/// The PNG goes as raw bytes (an ArrayBuffer on the JS side), not as a JSON
/// number array (~4× the size) or base64 (+33% and a decode on each side).
pub fn frame(json: &Value, png: Option<&[u8]>) -> Vec<u8> {
    let j = serde_json::to_vec(json).unwrap_or_default();
    let mut out = Vec::with_capacity(4 + j.len() + png.map_or(0, <[u8]>::len));
    out.extend_from_slice(&(j.len() as u32).to_le_bytes());
    out.extend_from_slice(&j);
    if let Some(p) = png {
        out.extend_from_slice(p);
    }
    out
}

pub fn unframe(bytes: &[u8]) -> Result<(Value, Option<&[u8]>), String> {
    if bytes.len() < 4 {
        return Err("empty request".into());
    }
    let n = u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize;
    let j = bytes.get(4..4 + n).ok_or("truncated request")?;
    let v: Value = serde_json::from_slice(j).map_err(|e| format!("bad request: {e}"))?;
    let rest = &bytes[4 + n..];
    Ok((v, (!rest.is_empty()).then_some(rest)))
}

// --------------------------------------------------------------- commands

fn need_dir(app: &AppHandle) -> Result<PathBuf, String> {
    dir(app).ok_or_else(|| "no app data folder".to_string())
}

/// The draft and the PNG come as one raw frame (see frame()).
#[tauri::command]
pub async fn feedback_save(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<Saved, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("feedback_save takes a binary frame".into());
    };
    let bytes = bytes.clone();
    let d = need_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let (v, png) = unframe(&bytes)?;
        let draft: Draft = serde_json::from_value(v).map_err(|e| format!("the report is not valid: {e}"))?;
        save(&d, draft, png, now_secs())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn feedback_list(app: AppHandle) -> Result<Vec<Summary>, String> {
    let d = need_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || list(&d, now_secs())).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn feedback_delete(app: AppHandle, id: String) -> Result<(), String> {
    delete(&need_dir(&app)?, &id)
}

#[tauri::command]
pub fn feedback_delete_all(app: AppHandle) -> Result<usize, String> {
    delete_all(&need_dir(&app)?)
}

/// Reveal the report's zip (if exported) or its report.json; with @p seq,
/// the zip of that very export request (reveal_target).
#[tauri::command]
pub fn feedback_reveal(app: AppHandle, id: String, seq: Option<u64>) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let target = reveal_target(&need_dir(&app)?, &id, seq)?;
    app.opener().reveal_item_in_dir(&target).map_err(|e| e.to_string())
}

/// Build the report's zip for @p include, as request @p seq (export_ordered).
#[tauri::command]
pub async fn feedback_export(app: AppHandle, id: String, include: Include, seq: Option<u64>) -> Result<Exported, String> {
    let d = need_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || export_ordered(&d, &id, include, now_secs(), seq)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn feedback_set_status(app: AppHandle, id: String, status: String, issue_url: Option<String>) -> Result<(), String> {
    set_status(&need_dir(&app)?, &id, &status, issue_url)
}

// ------------------------------------------------------------------ tests

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("fastag-feedback-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    /// The golden draft (gui/src/feedback/fixtures/draft.json), shared with
    /// the vitest side.
    pub(crate) const DRAFT: &str = include_str!("../../src/feedback/fixtures/draft.json");
    const GOLDEN_EXPORT: &str = include_str!("../../src/feedback/fixtures/export.golden.json");
    const LOCAL_SCHEMA: &str = include_str!("../../src/feedback/schema/report.schema.json");

    pub(crate) fn draft() -> Draft {
        serde_json::from_str(DRAFT).expect("draft.json")
    }

    /// A tiny valid PNG of @p w × @p h (one IDAT of zlib stored blocks),
    /// with a tEXt chunk the store must drop.
    pub(crate) fn png(w: u32, h: u32) -> Vec<u8> {
        fn chunk(out: &mut Vec<u8>, ty: &[u8], data: &[u8]) {
            out.extend_from_slice(&(data.len() as u32).to_be_bytes());
            let mut c = ty.to_vec();
            c.extend_from_slice(data);
            out.extend_from_slice(&c);
            out.extend_from_slice(&crc32(&c).to_be_bytes());
        }
        let mut raw = Vec::new();
        for _ in 0..h {
            raw.push(0u8);
            raw.extend(std::iter::repeat_n(0x7fu8, (w * 3) as usize));
        }
        // zlib: header, stored blocks, adler32.
        let mut z = vec![0x78, 0x01];
        let blocks: Vec<&[u8]> = raw.chunks(65_535).collect();
        for (i, b) in blocks.iter().enumerate() {
            z.push(u8::from(i + 1 == blocks.len()));
            z.extend_from_slice(&(b.len() as u16).to_le_bytes());
            z.extend_from_slice(&(!(b.len() as u16)).to_le_bytes());
            z.extend_from_slice(b);
        }
        let (mut a, mut bsum) = (1u32, 0u32);
        for &x in &raw {
            a = (a + x as u32) % 65_521;
            bsum = (bsum + a) % 65_521;
        }
        z.extend_from_slice(&((bsum << 16) | a).to_be_bytes());
        let mut out = PNG_SIG.to_vec();
        let mut ihdr = Vec::new();
        ihdr.extend_from_slice(&w.to_be_bytes());
        ihdr.extend_from_slice(&h.to_be_bytes());
        ihdr.extend_from_slice(&[8, 2, 0, 0, 0]);
        chunk(&mut out, b"IHDR", &ihdr);
        chunk(&mut out, b"tEXt", b"Author\0someone@example.org");
        chunk(&mut out, b"IDAT", &z);
        chunk(&mut out, b"IEND", &[]);
        out
    }

    const NOW: u64 = 1_795_000_000; // 2026-11-18T11:06:40Z

    #[test]
    fn utc_and_folder_stamps() {
        assert_eq!(iso_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso_utc(951_782_400), "2000-02-29T00:00:00Z");
        assert_eq!(iso_utc(1_795_000_000), "2026-11-18T11:06:40Z");
        assert_eq!(folder_stamp(1_795_000_000), "20261118T110640Z");
        assert!(!folder_stamp(NOW).contains(':'));
        for t in [0u64, 951_782_400, NOW, 4_102_444_800] {
            assert_eq!(stamp_secs(&format!("{}_00000000", folder_stamp(t))), Some(t));
        }
        assert!((-840..=840).contains(&tz_offset_min(NOW)));
    }

    #[test]
    fn ids_are_uuid_v4_and_validated() {
        for _ in 0..100 {
            assert!(is_uuid_v4(&uuid_v4().unwrap()));
        }
        assert!(!is_uuid_v4("../../etc/passwd"));
        assert!(!is_uuid_v4("01234567-89ab-1def-8123-456789abcdef")); // v1
        assert!(!is_uuid_v4("01234567-89AB-4DEF-8123-456789ABCDEF")); // upper case
        assert!(is_report_folder("20261118T094640Z_0123abcd"));
        assert!(!is_report_folder("20261118T09:46:40Z_0123abcd"));
        assert!(!is_report_folder("20261118T094640Z_0123abcd/.."));
    }

    #[test]
    fn save_list_delete() {
        let d = tmp("save");
        let s = save(&d, draft(), Some(&png(40, 20)), NOW).unwrap();
        assert!(is_uuid_v4(&s.id));
        assert_eq!(s.status, "saved");
        let folder = PathBuf::from(&s.folder);
        let name = folder.file_name().unwrap().to_string_lossy().to_string();
        assert_eq!(name, format!("20261118T110640Z_{}", &s.id[..8]));
        assert!(!name.contains(':'));
        // The screenshot without its tEXt chunk.
        let shot = std::fs::read(folder.join(SCREENSHOT_FILE)).unwrap();
        assert!(!shot.windows(4).any(|w| w == b"tEXt"));
        assert_eq!(png_size(&shot), Some((40, 20)));
        // report.json: the backend's fields set, never the input's.
        let r = read_report(&folder).unwrap();
        assert_eq!(r.id, s.id);
        assert_eq!(r.created_utc, "2026-11-18T11:06:40Z");
        assert_eq!(r.draft, draft());
        // No temporary folder is left.
        assert!(std::fs::read_dir(&d).unwrap().flatten().all(|e| !e.file_name().to_string_lossy().starts_with(".tmp")));

        let s2 = save(&d, draft(), None, NOW + 5).err();
        assert!(s2.unwrap().contains("no screenshot"), "status ok without a PNG is refused");
        let mut no_shot = draft();
        no_shot.capture.status = "removed".into();
        let s2 = save(&d, no_shot, None, NOW + 5).unwrap();
        let l = list(&d, NOW + 10);
        assert_eq!(l.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), [s2.id.as_str(), s.id.as_str()]);
        assert!(l[1].screenshot && !l[0].screenshot);

        delete(&d, &s.id).unwrap();
        assert!(!folder.exists());
        assert!(delete(&d, &s.id).is_err());
        assert_eq!(delete_all(&d).unwrap(), 1);
        assert!(list(&d, NOW).is_empty());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn the_backend_owns_id_and_time() {
        let mut v: Value = serde_json::from_str(DRAFT).unwrap();
        v["id"] = json!("01234567-89ab-4def-8123-456789abcdef");
        assert!(serde_json::from_value::<Draft>(v).is_err(), "an id in the draft is an unknown field");
        let mut v: Value = serde_json::from_str(DRAFT).unwrap();
        v["capture"]["extra"] = json!(1);
        assert!(serde_json::from_value::<Draft>(v).is_err());
    }

    #[test]
    fn caps_and_text_lengths() {
        let d = tmp("caps");
        let mut long = draft();
        long.title = "x".repeat(121);
        assert!(save(&d, long, None, NOW).unwrap_err().contains("title"));
        let mut long = draft();
        long.description = "y".repeat(4001);
        assert!(save(&d, long, None, NOW).unwrap_err().contains("description"));
        let mut empty = draft();
        empty.title = "  ".into();
        assert!(save(&d, empty, None, NOW).is_err());
        assert!(check_caps(2560, 1600).is_ok());
        assert!(check_caps(2561, 10).is_err());
        assert!(check_caps(2560, 2560).is_ok() == (2560u64 * 2560 <= MAX_PIXELS));
        assert!(check_caps(2560, 3200).is_err());
        assert!(check_caps(0, 10).is_err());
        // A PNG above the hard cap is refused with a reason.
        let mut big = draft();
        big.capture.width = 2600;
        big.capture.height = 10;
        assert!(save(&d, big, Some(&png(2600, 10)), NOW).is_err());
        // A PNG whose size disagrees with the report.
        assert!(save(&d, draft(), Some(&png(41, 20)), NOW).unwrap_err().contains("says"));
        // Not a PNG, a damaged one.
        assert!(save(&d, draft(), Some(b"GIF89a....."), NOW).is_err());
        let mut bad = png(40, 20);
        let n = bad.len();
        bad[n - 20] ^= 0xff;
        assert!(save(&d, draft(), Some(&bad), NOW).is_err());
        // Free text in a parameter of the allow-list.
        let mut p = draft();
        p.params.insert("in".into(), json!(["/Users/x/a.mzML"]));
        assert!(save(&d, p, None, NOW).is_err());
        let mut p = draft();
        p.params.insert("../evil".into(), json!(1));
        assert!(save(&d, p, None, NOW).is_err());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn retention_and_store_cap() {
        let d = tmp("retention");
        let s = save(&d, draft(), Some(&png(40, 20)), NOW).unwrap();
        assert_eq!(list(&d, NOW + 179 * 86_400).len(), 1);
        assert!(list(&d, NOW + 181 * 86_400).is_empty());
        assert!(resolve(&d, &s.id).is_err());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[cfg(unix)]
    #[test]
    fn ids_resolve_only_inside_the_store_without_symlinks() {
        let d = tmp("symlink");
        let other = tmp("symlink-other");
        let s = save(&other, draft(), Some(&png(40, 20)), NOW).unwrap();
        std::fs::create_dir_all(&d).unwrap();
        let name = PathBuf::from(&s.folder).file_name().unwrap().to_owned();
        std::os::unix::fs::symlink(&s.folder, d.join(&name)).unwrap();
        assert!(resolve(&d, &s.id).is_err(), "a symlinked report folder is not followed");
        assert!(list(&d, NOW).is_empty());
        assert!(delete(&d, &s.id).is_err());
        assert_eq!(delete_all(&d).unwrap(), 0);
        assert!(PathBuf::from(&s.folder).join(REPORT_FILE).exists(), "the target stays");
        // A report.json that is a symlink is not read either.
        let real = d.join("20261118T094640Z_deadbeef");
        std::fs::create_dir_all(&real).unwrap();
        std::os::unix::fs::symlink(PathBuf::from(&s.folder).join(REPORT_FILE), real.join(REPORT_FILE)).unwrap();
        assert!(list(&d, NOW).is_empty());
        let _ = std::fs::remove_dir_all(&d);
        let _ = std::fs::remove_dir_all(&other);
    }

    #[test]
    fn status_moves_forward_with_the_issue_url() {
        let d = tmp("status");
        let s = save(&d, draft(), Some(&png(40, 20)), NOW).unwrap();
        set_status(&d, &s.id, "handoff_opened", None).unwrap();
        assert!(set_status(&d, &s.id, "saved", None).is_err());
        assert!(set_status(&d, &s.id, "submitted", Some("https://evil.example/issues/1".into())).is_err());
        assert!(set_status(&d, &s.id, "submitted", Some(format!("{ISSUE_PREFIX}12/../x"))).is_err());
        set_status(&d, &s.id, "submitted", Some(format!("{ISSUE_PREFIX}123"))).unwrap();
        let l = list(&d, NOW);
        assert_eq!(l[0].status, "submitted");
        assert_eq!(l[0].issue_url.as_deref(), Some("https://github.com/okohlbacher/FASTag/issues/123"));
        let _ = std::fs::remove_dir_all(&d);
    }

    /// Read a stored zip back: (name, data) per local header, CRCs checked.
    fn unzip(z: &[u8]) -> Vec<(String, Vec<u8>)> {
        let u16_at = |i: usize| u16::from_le_bytes([z[i], z[i + 1]]) as usize;
        let u32_at = |i: usize| u32::from_le_bytes(z[i..i + 4].try_into().unwrap());
        let eocd = z.len() - 22;
        assert_eq!(u32_at(eocd), 0x0605_4b50);
        let count = u16_at(eocd + 10);
        let mut cd = u32_at(eocd + 16) as usize;
        let mut out = Vec::new();
        for _ in 0..count {
            assert_eq!(u32_at(cd), 0x0201_4b50);
            let crc = u32_at(cd + 16);
            let size = u32_at(cd + 24) as usize;
            let nlen = u16_at(cd + 28);
            let off = u32_at(cd + 42) as usize;
            let name = String::from_utf8(z[cd + 46..cd + 46 + nlen].to_vec()).unwrap();
            assert_eq!(u32_at(off), 0x0403_4b50);
            let lnlen = u16_at(off + 26);
            let data = z[off + 30 + lnlen..off + 30 + lnlen + size].to_vec();
            assert_eq!(crc32(&data), crc, "{name}");
            out.push((name, data));
            cd += 46 + nlen;
        }
        out
    }

    #[test]
    fn crc32_and_zip() {
        assert_eq!(crc32(b"123456789"), 0xcbf4_3926);
        assert_eq!(crc32(b""), 0);
        let z = zip_stored(&[("a.txt", b"hello"), ("b.bin", &[0u8, 1, 2, 255])], NOW);
        let files = unzip(&z);
        assert_eq!(files, vec![("a.txt".to_string(), b"hello".to_vec()), ("b.bin".to_string(), vec![0, 1, 2, 255])]);
        // Where the system has unzip, it agrees.
        let d = tmp("zip");
        std::fs::create_dir_all(&d).unwrap();
        let p = d.join("t.zip");
        std::fs::write(&p, &z).unwrap();
        if let Ok(o) = std::process::Command::new("unzip").arg("-t").arg(&p).output() {
            assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stdout));
        }
        let _ = std::fs::remove_dir_all(&d);
    }

    #[cfg(unix)]
    #[test]
    fn a_failed_export_leaves_no_earlier_zip_behind() {
        let d = tmp("export-stale");
        let s = save(&d, draft(), Some(&png(40, 20)), NOW).unwrap();
        let all = Include { screenshot: true, diagnostics: true, log: false };
        let e = export(&d, &s.id, all, NOW).unwrap();
        assert!(unzip(&std::fs::read(&e.zip).unwrap()).iter().any(|f| f.0 == SCREENSHOT_FILE));
        // The screenshot unticked, and that export fails (the screenshot
        // cannot be read).
        use std::os::unix::fs::PermissionsExt;
        let folder = resolve(&d, &s.id).unwrap();
        let shot = folder.join(SCREENSHOT_FILE);
        std::fs::set_permissions(&shot, std::fs::Permissions::from_mode(0o000)).unwrap();
        let none = Include { screenshot: false, diagnostics: true, log: false };
        let failed = export(&d, &s.id, none, NOW);
        std::fs::set_permissions(&shot, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert!(failed.is_err(), "{failed:?}");
        // No zip with the screenshot is left for feedback_reveal to show.
        assert!(!folder.join(zip_name(&s.id)).exists());
        let _ = std::fs::remove_dir_all(&d);
    }

    // Codex New 6: two exports of one report raced for the lock; the older
    // request (screenshot ticked) ran after the newer one (unticked) and
    // overwrote the zip the share step had just shown. In request order the
    // older one is refused, and the zip revealed for the accepted request
    // is the bytes of that request: no screenshot.
    #[test]
    fn an_older_export_request_never_overwrites_the_zip_revealed() {
        let d = tmp("export-order");
        let s = save(&d, draft(), Some(&png(40, 20)), NOW).unwrap();
        let shot = Include { screenshot: true, diagnostics: true, log: false };
        let none = Include { screenshot: false, diagnostics: true, log: false };
        // Request 10 (screenshot) and 11 (none) were sent in that order; 11
        // reaches the lock first.
        let newer = export_ordered(&d, &s.id, none, NOW, Some(11)).unwrap();
        assert_eq!(newer.seq, 11);
        let older = export_ordered(&d, &s.id, shot, NOW, Some(10));
        assert_eq!(older.err().as_deref(), Some(STALE_EXPORT));
        // What feedback_reveal shows for the accepted request: its zip, and
        // the bytes in it are the newer choices.
        let target = reveal_target(&d, &s.id, Some(newer.seq)).unwrap();
        assert_eq!(target.display().to_string(), newer.zip);
        let bytes = std::fs::read(&target).unwrap();
        let files = unzip(&bytes);
        assert_eq!(files.iter().map(|f| f.0.as_str()).collect::<Vec<_>>(), vec![EXPORT_FILE]);
        assert_eq!(String::from_utf8(files[0].1.clone()).unwrap(), newer.json);
        // Nor does the stale request's answer reveal anything.
        assert!(reveal_target(&d, &s.id, Some(10)).is_err());
        // A later request (the screenshot ticked again) is built, and the
        // earlier accepted one no longer reveals the zip it does not hold.
        let again = export_ordered(&d, &s.id, shot, NOW, Some(12)).unwrap();
        assert!(unzip(&std::fs::read(&again.zip).unwrap()).iter().any(|f| f.0 == SCREENSHOT_FILE));
        assert!(reveal_target(&d, &s.id, Some(11)).is_err());
        assert_eq!(reveal_target(&d, &s.id, Some(12)).unwrap().display().to_string(), again.zip);
        // Without a request number (the reports list): the zip as it is.
        assert_eq!(reveal_target(&d, &s.id, None).unwrap().display().to_string(), again.zip);
        // Real concurrency: many requests in flight, any order; the zip is
        // that of the newest one that ran, and every older one is refused.
        let ids: Vec<u64> = (20..40).collect();
        let res: Vec<(u64, Result<Exported, String>)> = std::thread::scope(|sc| {
            let hs: Vec<_> = ids
                .iter()
                .rev()
                .map(|&n| {
                    let (d, id) = (&d, &s.id);
                    sc.spawn(move || (n, export_ordered(d, id, if n % 2 == 0 { shot } else { none }, NOW, Some(n))))
                })
                .collect();
            hs.into_iter().map(|h| h.join().unwrap()).collect()
        });
        let best = res.iter().filter(|(_, r)| r.is_ok()).map(|(n, _)| *n).max().unwrap();
        assert_eq!(best, 39);
        let z = unzip(&std::fs::read(reveal_target(&d, &s.id, Some(39)).unwrap()).unwrap());
        assert!(!z.iter().any(|f| f.0 == SCREENSHOT_FILE), "39 unticked the screenshot");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn export_zip_and_golden_json() {
        let d = tmp("export");
        let s = save(&d, draft(), Some(&png(40, 20)), NOW).unwrap();
        let all = Include { screenshot: true, diagnostics: true, log: true };
        let e = export(&d, &s.id, all, NOW).unwrap();
        assert!(e.zip.ends_with(&format!("{}.feedback.zip", s.id)));
        let files = unzip(&std::fs::read(&e.zip).unwrap());
        assert_eq!(files[0].0, EXPORT_FILE);
        assert_eq!(String::from_utf8(files[0].1.clone()).unwrap(), e.json, "the preview is the attachment");
        assert_eq!(files[1].0, SCREENSHOT_FILE);
        assert_eq!(e.image.as_ref().unwrap().width, 40);
        // Without the screenshot and the log.
        let def = Include { screenshot: false, diagnostics: true, log: false };
        let e = export(&d, &s.id, def, NOW).unwrap();
        let files = unzip(&std::fs::read(&e.zip).unwrap());
        assert_eq!(files.len(), 1);
        assert!(e.image.is_none());
        let v: Value = serde_json::from_str(&e.json).unwrap();
        assert!(v.get("log").is_none() && v.get("capture").is_none());
        assert!(list(&d, NOW)[0].zip.is_some());

        // The golden export of the golden draft (vitest validates the same
        // file against feedback-public.schema.json and compares the e2e
        // mock's export with it): a fixed id and time.
        let r = Report {
            id: "0f8e2a4c-1b3d-4e5f-9a7b-6c5d4e3f2a1b".into(),
            created_utc: "2026-11-18T09:46:40Z".into(),
            tz_offset_min: 60,
            status: "saved".into(),
            issue_url: None,
            draft: draft(),
        };
        if std::env::var_os("FASTAG_WRITE_GOLDEN").is_some() {
            let text = serde_json::to_string_pretty(&public_export(&r, all, true)).unwrap() + "\n";
            std::fs::write(concat!(env!("CARGO_MANIFEST_DIR"), "/../src/feedback/fixtures/export.golden.json"), text).unwrap();
            return;
        }
        let golden: Value = serde_json::from_str(GOLDEN_EXPORT).unwrap();
        assert_eq!(public_export(&r, all, true), golden, "export.golden.json");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn the_export_carries_no_paths_or_free_text() {
        let r = Report {
            id: "0f8e2a4c-1b3d-4e5f-9a7b-6c5d4e3f2a1b".into(),
            created_utc: "2026-11-18T09:46:40Z".into(),
            tz_offset_min: 0,
            status: "saved".into(),
            issue_url: None,
            draft: draft(),
        };
        let all = Include { screenshot: true, diagnostics: true, log: false };
        let text = public_export(&r, all, true).to_string();
        for bad in ["/Users/", "description", "steps", "expected", "actual", "C:\\\\"] {
            assert!(!text.contains(bad), "{bad} in {text}");
        }
        let none = public_export(&r, Include { screenshot: false, diagnostics: false, log: false }, true);
        let keys: Vec<&String> = none.as_object().unwrap().keys().collect();
        assert_eq!(keys, ["created_utc", "id", "kind", "schema", "title"]);
    }

    /// The local schema names exactly the fields report.json has.
    #[test]
    fn the_local_schema_matches_the_serde_types() {
        let schema: Value = serde_json::from_str(LOCAL_SCHEMA).unwrap();
        let r = Report {
            id: uuid_v4().unwrap(),
            created_utc: iso_utc(NOW),
            tz_offset_min: 0,
            status: "saved".into(),
            issue_url: None,
            draft: draft(),
        };
        fn check(schema: &Value, root: &Value, v: &Value, at: &str) {
            let schema = match schema.get("$ref").and_then(Value::as_str) {
                Some(r) => &root["$defs"][r.trim_start_matches("#/$defs/")],
                None => schema,
            };
            if let (Some(props), Some(obj)) = (schema.get("properties").and_then(Value::as_object), v.as_object()) {
                let mut a: Vec<&String> = props.keys().collect();
                let mut b: Vec<&String> = obj.keys().collect();
                a.sort();
                b.sort();
                assert_eq!(a, b, "{at}");
                let req: Vec<&str> = schema["required"].as_array().map(|r| r.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
                if schema.get("additionalProperties") == Some(&Value::Bool(false)) && at != "/" {
                    assert_eq!(req.len(), a.len(), "{at}: every field required");
                }
                for (k, s) in props {
                    check(s, root, &obj[k], &format!("{at}{k}/"));
                }
            }
            if let (Some(any), false) = (schema.get("anyOf").and_then(Value::as_array), v.is_null()) {
                for s in any {
                    if s.get("type") == Some(&json!("object")) || s.get("$ref").is_some() {
                        check(s, root, v, at);
                    }
                }
            }
            if let (Some(items), Some(arr)) = (schema.get("items"), v.as_array()) {
                for x in arr {
                    check(items, root, x, at);
                }
            }
        }
        check(&schema, &schema, &r.to_json(), "/");
    }

    #[test]
    fn frames_round_trip() {
        let v = json!({"a": 1});
        let f = frame(&v, Some(&[1, 2, 3]));
        let (v2, p) = unframe(&f).unwrap();
        assert_eq!((v2, p), (v.clone(), Some(&[1u8, 2, 3][..])));
        let f = frame(&v, None);
        let (_, p) = unframe(&f).unwrap();
        assert!(p.is_none());
        assert!(unframe(&[9, 0, 0, 0, b'{']).is_err());
    }
}
