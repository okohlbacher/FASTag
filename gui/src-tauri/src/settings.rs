// Named parameter presets + last-used state, persisted as one JSON file in the
// app config dir. Writes are atomic (temp + rename). A corrupt file is moved
// aside rather than silently overwritten, so recoverable presets survive; a
// file that can be neither read nor moved aside is never overwritten.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    schema_version: u32,
    last_used: Option<Value>,
    presets: Map<String, Value>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { schema_version: 1, last_used: None, presets: Map::new() }
    }
}

fn is_reserved(k: &str) -> bool {
    matches!(k, "__proto__" | "constructor" | "prototype")
}

// Drop keys that would poison Object.prototype once merged in the renderer.
fn sanitize_map(m: &Map<String, Value>) -> Map<String, Value> {
    m.iter()
        .filter(|(k, _)| !is_reserved(k))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect()
}

fn sanitize_value(v: Value) -> Value {
    match v {
        Value::Object(m) => Value::Object(sanitize_map(&m)),
        other => other,
    }
}

fn settings_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("fastag-settings.json"))
}

pub fn load(app: &AppHandle) -> Settings {
    load_for_write(app).unwrap_or_default()
}

/// The settings to modify and save back, or None when the file exists but
/// could not be read and could not be set aside: saving then would replace
/// the user's presets with an empty set, so every writer refuses instead.
fn load_for_write(app: &AppHandle) -> Option<Settings> {
    match settings_file(app) {
        Some(path) => load_path(&path),
        None => Some(Settings::default()),
    }
}

fn load_path(path: &Path) -> Option<Settings> {
    let raw = match std::fs::read(path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Some(Settings::default()),
        // Unreadable (permissions, I/O): nothing to back up, never overwrite.
        Err(_) => return None,
    };
    // from_slice also rejects invalid UTF-8 (a Latin-1 byte from a hand edit),
    // which then takes the corrupt path below instead of yielding defaults
    // that the next save would write over the file.
    match serde_json::from_slice::<Value>(&raw) {
        Ok(v) => {
            let last_used = v
                .get("lastUsed")
                .and_then(|x| x.as_object())
                .map(|m| Value::Object(sanitize_map(m)));
            let presets = v
                .get("presets")
                .and_then(|x| x.as_object())
                .map(|m| {
                    sanitize_map(m)
                        .into_iter()
                        .filter_map(|(k, val)| val.as_object().map(|vm| (k, Value::Object(sanitize_map(vm)))))
                        .collect::<Map<String, Value>>()
                })
                .unwrap_or_default();
            Some(Settings { schema_version: 1, last_used, presets })
        }
        Err(_) => {
            // Move the unparseable file aside (never over an earlier backup)
            // so the next save() doesn't destroy recoverable presets; then
            // start from empty. If it cannot be moved, refuse to overwrite it.
            let name = path.file_name()?.to_string_lossy().to_string();
            let backup = (0..100).map(|i| {
                let suffix = if i == 0 { ".corrupt".to_string() } else { format!(".corrupt.{i}") };
                path.with_file_name(format!("{name}{suffix}"))
            });
            for b in backup {
                if !b.exists() {
                    return std::fs::rename(path, &b).ok().map(|_| Settings::default());
                }
            }
            None
        }
    }
}

fn save(app: &AppHandle, s: &Settings) -> bool {
    let Some(path) = settings_file(app) else { return false };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let Ok(json) = serde_json::to_string_pretty(s) else { return false };
    let mut tmp = path.clone();
    tmp.set_extension("json.tmp");
    if std::fs::write(&tmp, json).is_err() {
        return false;
    }
    std::fs::rename(&tmp, &path).is_ok()
}

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Settings {
    load(&app)
}

#[tauri::command]
pub fn save_last(app: AppHandle, values: Value) -> bool {
    let Some(mut s) = load_for_write(&app) else { return false };
    s.last_used = Some(sanitize_value(values));
    save(&app, &s)
}

#[tauri::command]
pub fn save_preset(app: AppHandle, name: String, values: Value) -> bool {
    let clean = name.trim();
    if clean.is_empty() || is_reserved(clean) {
        return false;
    }
    let Some(mut s) = load_for_write(&app) else { return false };
    s.presets.insert(clean.to_string(), sanitize_value(values));
    save(&app, &s)
}

#[tauri::command]
pub fn delete_preset(app: AppHandle, name: String) -> bool {
    let Some(mut s) = load_for_write(&app) else { return false };
    if s.presets.remove(&name).is_none() {
        return false;
    }
    save(&app, &s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reserved_keys_are_stripped() {
        let m: Map<String, Value> = serde_json::from_str(
            r#"{"__proto__":{"x":1},"constructor":2,"prototype":3,"tag_length":"7"}"#,
        )
        .unwrap();
        let s = sanitize_map(&m);
        assert_eq!(s.len(), 1);
        assert!(s.contains_key("tag_length"));
    }

    fn scratch(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("fastag-settings-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn missing_file_gives_writable_defaults() {
        let d = scratch("missing");
        let s = load_path(&d.join("fastag-settings.json")).expect("writable");
        assert!(s.presets.is_empty());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn non_utf8_file_is_backed_up_not_overwritten() {
        // RS-7: a Latin-1 byte made load() return defaults and the next
        // save_last wrote presets:{} over the user's file.
        let d = scratch("latin1");
        let f = d.join("fastag-settings.json");
        let raw: &[u8] = b"{\"schemaVersion\":1,\"presets\":{\"Caf\xE9\":{\"tag_length\":\"4\"}}}";
        std::fs::write(&f, raw).unwrap();
        // An earlier backup must not be clobbered either.
        std::fs::write(d.join("fastag-settings.json.corrupt"), b"older").unwrap();
        let s = load_path(&f).expect("moved aside, so writable");
        assert!(s.presets.is_empty());
        assert!(!f.exists());
        assert_eq!(std::fs::read(d.join("fastag-settings.json.corrupt.1")).unwrap(), raw);
        assert_eq!(std::fs::read(d.join("fastag-settings.json.corrupt")).unwrap(), b"older");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[cfg(unix)]
    #[test]
    fn unreadable_file_refuses_to_save() {
        use std::os::unix::fs::PermissionsExt;
        let d = scratch("unreadable");
        let f = d.join("fastag-settings.json");
        std::fs::write(&f, b"{\"presets\":{\"keep\":{}}}").unwrap();
        std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o000)).unwrap();
        // root reads anything; the refusal is only observable when the read fails
        if std::fs::read(&f).is_err() {
            assert!(load_path(&f).is_none());
        }
        std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o600)).unwrap();
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn valid_file_loads_presets() {
        let d = scratch("valid");
        let f = d.join("fastag-settings.json");
        std::fs::write(&f, r#"{"schemaVersion":1,"presets":{"Café":{"tag_length":"4"}}}"#).unwrap();
        let s = load_path(&f).unwrap();
        assert!(s.presets.contains_key("Café"));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn sanitize_value_recurses_one_level() {
        let v: Value = serde_json::from_str(r#"{"__proto__":1,"ok":true}"#).unwrap();
        let s = sanitize_value(v);
        assert!(s.get("__proto__").is_none());
        assert_eq!(s.get("ok"), Some(&Value::Bool(true)));
    }
}
