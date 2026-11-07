// Settings (GUI-DESIGN 5): named presets and the last-used offer, kept in a
// tauri-plugin-store file, settings.json in the app config dir (P2a; before
// that a JSON file of settings.rs's own, fastag-settings.json, schema 1).
//
// Schema 2: {schemaVersion: 2, lastUsed, presets: {name: {v: 2, base, diff}}}.
// A preset is a diff over its base (FASTag's defaults or a built-in task,
// setup/presetDiff.ts); a v1 preset, a full record of the form's values,
// becomes the diff of that record over the defaults, every key kept, which
// applies to the same values.
//
// The plugin ignores a file it cannot parse and then writes over it, and it
// writes in place, and it saves every store it holds when the app exits. So
// before the store opens, prepare() checks the file: an unreadable one is
// never written (that session keeps its settings in memory and never opens
// a plugin store at the path); a corrupt one is restored from the copy
// taken before the last save (settings.json.bak) or moved aside. The v1 file
// is migrated once and kept as settings.v1.json.bak.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_store::{Store, StoreBuilder};

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

/// Read a v1 settings file (the migration's source). A corrupt file is moved
/// aside and read as empty; an unreadable one is None: never written over.
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

/// The v1 file (settings.rs before P2a), the store and the copies.
pub const V1_FILE: &str = "fastag-settings.json";
pub const STORE_FILE: &str = "settings.json";
pub const V1_BACKUP: &str = "settings.v1.json.bak";
const STORE_BACKUP: &str = "settings.json.bak";
pub const SCHEMA: u64 = 2;

/// The first free name of @p name, @p name.1, ... in @p dir: a backup or a
/// file set aside never replaces an earlier one.
fn free_name(dir: &Path, name: &str) -> Option<PathBuf> {
    (0..100)
        .map(|i| if i == 0 { dir.join(name) } else { dir.join(format!("{name}.{i}")) })
        .find(|p| !p.exists())
}

/// A v1 preset (a full record of the form's values) as a v2 one: the diff
/// over FASTag's defaults, every key kept, so applying it gives the record.
fn preset_v2(v1: &Value) -> Value {
    serde_json::json!({ "v": 2, "base": "defaults", "diff": v1 })
}

/// The v2 document of the v1 settings @p s.
pub fn migrate_doc(s: &Settings) -> Map<String, Value> {
    let mut doc = Map::new();
    doc.insert("schemaVersion".into(), SCHEMA.into());
    doc.insert("lastUsed".into(), s.last_used.clone().unwrap_or(Value::Null));
    let presets: Map<String, Value> = s.presets.iter().map(|(k, v)| (k.clone(), preset_v2(v))).collect();
    doc.insert("presets".into(), Value::Object(presets));
    doc
}

/// A preset as the renderer stored it: a v2 {v, base, diff} with its diff
/// sanitized, or (from an older renderer) a flat record, kept as it is.
fn sanitize_preset(v: Value) -> Option<Value> {
    let Value::Object(m) = v else { return None };
    let m = sanitize_map(&m);
    if m.get("v").and_then(|x| x.as_u64()) == Some(2) {
        let base = m.get("base").and_then(|b| b.as_str()).unwrap_or("defaults").to_string();
        let diff = m.get("diff").and_then(|d| d.as_object()).map(sanitize_map).unwrap_or_default();
        return Some(serde_json::json!({ "v": 2, "base": base, "diff": diff }));
    }
    Some(Value::Object(m))
}

/// What prepare() found.
#[derive(Debug, PartialEq)]
pub struct Prepared {
    /// Saving is safe: false when the store (or the v1 file to migrate)
    /// exists but cannot be read, or cannot be set aside.
    pub writable: bool,
    /// Settings to put in the store this session without saving them: the
    /// migrated v1 settings when the store could not be written.
    pub seed: Option<Map<String, Value>>,
    /// The v1 file was migrated and kept under this name.
    pub migrated: Option<PathBuf>,
}

/// The JSON object in @p path, or None (missing, unreadable, not an object).
fn read_object(path: &Path) -> Option<Map<String, Value>> {
    match serde_json::from_slice::<Value>(&std::fs::read(path).ok()?).ok()? {
        Value::Object(m) => Some(m),
        _ => None,
    }
}

fn write_atomic(path: &Path, doc: &Map<String, Value>) -> bool {
    let Ok(json) = serde_json::to_vec_pretty(doc) else { return false };
    let mut tmp = path.to_path_buf();
    tmp.set_extension("json.tmp");
    if std::fs::write(&tmp, json).is_err() {
        let _ = std::fs::remove_file(&tmp);
        return false;
    }
    std::fs::rename(&tmp, path).is_ok()
}

/// Ready the settings in @p dir for the store, before it opens.
pub fn prepare(dir: &Path) -> Prepared {
    let store = dir.join(STORE_FILE);
    let ok = Prepared { writable: true, seed: None, migrated: None };
    let refuse = Prepared { writable: false, seed: None, migrated: None };
    match std::fs::read(&store) {
        Ok(bytes) => {
            if matches!(serde_json::from_slice::<Value>(&bytes), Ok(Value::Object(_))) {
                return ok;
            }
            // Corrupt: set it aside, then restore the copy of the last save.
            let Some(aside) = free_name(dir, &format!("{STORE_FILE}.corrupt")) else { return refuse };
            if std::fs::rename(&store, &aside).is_err() {
                return refuse;
            }
            let backup = dir.join(STORE_BACKUP);
            if let Some(m) = read_object(&backup) {
                return if write_atomic(&store, &m) { ok } else { Prepared { writable: false, seed: Some(m), migrated: None } };
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        // Unreadable (permissions, I/O): never write over it.
        Err(_) => return refuse,
    }
    // No store yet: migrate the v1 file once.
    let v1 = dir.join(V1_FILE);
    if !v1.exists() {
        return ok;
    }
    // load_path sets a corrupt v1 file aside itself and refuses an
    // unreadable one.
    let Some(s) = load_path(&v1) else { return refuse };
    let doc = migrate_doc(&s);
    let _ = std::fs::create_dir_all(dir);
    if !write_atomic(&store, &doc) {
        return Prepared { writable: false, seed: Some(doc), migrated: None };
    }
    if !v1.exists() {
        // It was corrupt and is set aside already.
        return ok;
    }
    match free_name(dir, V1_BACKUP) {
        Some(bak) if std::fs::rename(&v1, &bak).is_ok() => Prepared { writable: true, seed: None, migrated: Some(bak) },
        // The store holds the migrated settings; the v1 file stays where it
        // was and is not read again (the store exists now).
        _ => ok,
    }
}

/// The settings as load_settings returns them, from the entries of a store
/// (or of the in-memory map of a session that cannot write the file).
fn read_doc(get: impl Fn(&str) -> Option<Value>) -> Value {
    let last_used = get("lastUsed").and_then(|v| v.as_object().map(|m| Value::Object(sanitize_map(m)))).unwrap_or(Value::Null);
    let presets: Map<String, Value> = get("presets")
        .and_then(|v| v.as_object().cloned())
        .map(|m| sanitize_map(&m).into_iter().filter_map(|(k, v)| sanitize_preset(v).map(|p| (k, p))).collect())
        .unwrap_or_default();
    serde_json::json!({ "schemaVersion": SCHEMA, "lastUsed": last_used, "presets": presets })
}

/// The settings as load_settings returns them, from the store.
pub fn read_store<R: Runtime>(store: &Store<R>) -> Value {
    read_doc(|k| store.get(k))
}

/// Save @p store to @p path, keeping a copy of the file it replaces: the
/// plugin writes in place, so a save cut short leaves the copy to restore.
pub fn persist<R: Runtime>(store: &Store<R>, path: &Path, writable: bool) -> bool {
    if !writable {
        return false;
    }
    store.set("schemaVersion", SCHEMA);
    if path.exists() && std::fs::copy(path, path.with_file_name(STORE_BACKUP)).is_err() {
        return false;
    }
    store.save().is_ok()
}

pub fn put_last<R: Runtime>(store: &Store<R>, values: Value) {
    store.set("lastUsed", sanitize_value(values));
}

pub fn put_preset<R: Runtime>(store: &Store<R>, name: &str, value: Value) -> bool {
    let clean = name.trim();
    if clean.is_empty() || is_reserved(clean) {
        return false;
    }
    let Some(p) = sanitize_preset(value) else { return false };
    let mut presets = store.get("presets").and_then(|v| v.as_object().cloned()).unwrap_or_default();
    presets.insert(clean.to_string(), p);
    store.set("presets", Value::Object(presets));
    true
}

pub fn remove_preset<R: Runtime>(store: &Store<R>, name: &str) -> bool {
    let mut presets = store.get("presets").and_then(|v| v.as_object().cloned()).unwrap_or_default();
    if presets.remove(name).is_none() {
        return false;
    }
    store.set("presets", Value::Object(presets));
    true
}

/// The settings store of the app, managed state.
pub struct SettingsState {
    path: Option<PathBuf>,
    writable: bool,
    /// A session that cannot write the file keeps its settings here (the
    /// seed from prepare(), or nothing) and never opens a plugin store: the
    /// plugin saves every store it holds when the app exits, unasked, and
    /// would write over the very file prepare() refused to touch.
    memory: std::sync::Mutex<Map<String, Value>>,
}

/// Open the store (lib.rs setup): migrate, check, then load.
pub fn init<R: Runtime>(app: &AppHandle<R>) {
    init_in(app, app.path().app_config_dir().ok());
}

/// init() over the config dir @p dir (a scratch dir in the tests).
pub fn init_in<R: Runtime>(app: &AppHandle<R>, dir: Option<PathBuf>) {
    let (path, writable, memory) = match &dir {
        Some(d) => {
            let p = prepare(d);
            let path = d.join(STORE_FILE);
            if p.writable {
                let _ = StoreBuilder::new(app, &path).disable_auto_save().build();
            }
            (Some(path), p.writable, p.seed.unwrap_or_default())
        }
        None => (None, false, Map::new()),
    };
    app.manage(SettingsState { path, writable, memory: std::sync::Mutex::new(memory) });
}

/// The store of a session that can write it; None otherwise (never opened).
fn with_store<R: Runtime, T>(app: &AppHandle<R>, f: impl FnOnce(&Store<R>, &Path) -> T) -> Option<T> {
    let st = app.try_state::<SettingsState>()?;
    if !st.writable {
        return None;
    }
    let path = st.path.clone()?;
    let store = StoreBuilder::new(app, &path).disable_auto_save().build().ok()?;
    Some(f(&store, &path))
}

fn load_in<R: Runtime>(app: &AppHandle<R>) -> Value {
    if let Some(v) = with_store(app, |s, _| read_store(s)) {
        return v;
    }
    match app.try_state::<SettingsState>() {
        Some(st) => {
            let m = st.memory.lock().map(|m| m.clone()).unwrap_or_default();
            read_doc(|k| m.get(k).cloned())
        }
        None => read_doc(|_| None),
    }
}

fn save_last_in<R: Runtime>(app: &AppHandle<R>, values: Value) -> bool {
    with_store(app, |s, p| {
        put_last(s, values);
        persist(s, p, true)
    })
    .unwrap_or(false)
}

fn save_preset_in<R: Runtime>(app: &AppHandle<R>, name: &str, values: Value) -> bool {
    with_store(app, |s, p| put_preset(s, name, values) && persist(s, p, true)).unwrap_or(false)
}

fn delete_preset_in<R: Runtime>(app: &AppHandle<R>, name: &str) -> bool {
    with_store(app, |s, p| remove_preset(s, name) && persist(s, p, true)).unwrap_or(false)
}

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Value {
    load_in(&app)
}

#[tauri::command]
pub fn save_last(app: AppHandle, values: Value) -> bool {
    save_last_in(&app, values)
}

#[tauri::command]
pub fn save_preset(app: AppHandle, name: String, values: Value) -> bool {
    save_preset_in(&app, &name, values)
}

#[tauri::command]
pub fn delete_preset(app: AppHandle, name: String) -> bool {
    delete_preset_in(&app, &name)
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

    // ---- P2a: the store and the v1 migration -------------------------------

    const V1_FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/settings-v1.json");

    fn store_doc(d: &Path) -> Map<String, Value> {
        read_object(&d.join(STORE_FILE)).expect("a store file")
    }

    /// The store of a mock app over @p path, as the app opens it.
    fn mock_store(path: &Path) -> (tauri::App<tauri::test::MockRuntime>, std::sync::Arc<Store<tauri::test::MockRuntime>>) {
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_store::Builder::new().build())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let store = StoreBuilder::new(app.handle(), path).disable_auto_save().build().unwrap();
        (app, store)
    }

    #[test]
    fn a_real_v1_file_migrates_without_losing_a_preset() {
        let d = scratch("migrate");
        let v1 = std::fs::read(V1_FIXTURE).unwrap();
        std::fs::write(d.join(V1_FILE), &v1).unwrap();
        let p = prepare(&d);
        assert!(p.writable);
        assert_eq!(p.migrated.as_deref(), Some(d.join(V1_BACKUP).as_path()));
        // The v1 file is kept, byte for byte, as settings.v1.json.bak.
        assert!(!d.join(V1_FILE).exists());
        assert_eq!(std::fs::read(d.join(V1_BACKUP)).unwrap(), v1);
        // Every preset is there, as the diff of its full v1 record over the
        // defaults: every key kept, so it applies to the same values.
        let old: Value = serde_json::from_slice(&v1).unwrap();
        let doc = store_doc(&d);
        assert_eq!(doc["schemaVersion"], 2);
        assert_eq!(doc["lastUsed"], old["lastUsed"]);
        let names: Vec<&String> = old["presets"].as_object().unwrap().keys().collect();
        assert_eq!(names.len(), 2);
        for n in names {
            let p = &doc["presets"][n];
            assert_eq!(p["v"], 2, "{n}");
            assert_eq!(p["base"], "defaults", "{n}");
            assert_eq!(p["diff"], old["presets"][n], "{n}");
        }
        // The store plugin reads the migrated file, and load_settings
        // returns every preset.
        let (_app, store) = mock_store(&d.join(STORE_FILE));
        let loaded = read_store(&store);
        assert_eq!(loaded["presets"].as_object().unwrap().len(), 2);
        assert_eq!(loaded["presets"]["Ion trap Café"]["diff"]["fasta"], "/data/db/Café.fasta");
        assert_eq!(loaded["lastUsed"]["tag_length"], "7");
        // A second start migrates nothing again.
        assert_eq!(prepare(&d), Prepared { writable: true, seed: None, migrated: None });
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn migration_never_replaces_an_earlier_backup() {
        let d = scratch("migrate-bak");
        std::fs::write(d.join(V1_FILE), std::fs::read(V1_FIXTURE).unwrap()).unwrap();
        std::fs::write(d.join(V1_BACKUP), b"older").unwrap();
        let p = prepare(&d);
        assert_eq!(p.migrated.as_deref(), Some(d.join(format!("{V1_BACKUP}.1")).as_path()));
        assert_eq!(std::fs::read(d.join(V1_BACKUP)).unwrap(), b"older");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_corrupt_v1_file_is_set_aside_and_the_store_starts_empty() {
        let d = scratch("migrate-corrupt");
        std::fs::write(d.join(V1_FILE), b"{\"presets\": {").unwrap();
        let p = prepare(&d);
        assert!(p.writable);
        assert_eq!(std::fs::read(d.join(format!("{V1_FILE}.corrupt"))).unwrap(), b"{\"presets\": {");
        assert_eq!(store_doc(&d)["presets"], serde_json::json!({}));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[cfg(unix)]
    #[test]
    fn a_v1_file_the_store_cannot_be_written_beside_is_kept_and_seeds_the_session() {
        use std::os::unix::fs::PermissionsExt;
        let d = scratch("migrate-ro");
        std::fs::write(d.join(V1_FILE), std::fs::read(V1_FIXTURE).unwrap()).unwrap();
        std::fs::set_permissions(&d, std::fs::Permissions::from_mode(0o500)).unwrap();
        // root writes anyway; the refusal is only observable when it cannot
        if std::fs::write(d.join("probe"), b"").is_err() {
            let p = prepare(&d);
            assert!(!p.writable);
            assert!(d.join(V1_FILE).exists(), "the v1 file must stay");
            assert_eq!(p.seed.as_ref().unwrap()["presets"].as_object().unwrap().len(), 2);
        }
        std::fs::set_permissions(&d, std::fs::Permissions::from_mode(0o700)).unwrap();
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn saves_go_through_the_store_and_keep_a_copy_of_the_last_file() {
        let d = scratch("store");
        let path = d.join(STORE_FILE);
        let (_app, store) = mock_store(&path);
        assert!(put_preset(&store, " hcd ", serde_json::json!({"v": 2, "base": "builtin:characterize", "diff": {"tag_length": "4", "__proto__": 1}})));
        assert!(!put_preset(&store, "__proto__", serde_json::json!({})));
        assert!(persist(&store, &path, true));
        put_last(&store, serde_json::json!({"tag_length": "5", "constructor": 1}));
        assert!(persist(&store, &path, true));
        // The copy is the file before the last save.
        let bak = read_object(&d.join(STORE_BACKUP)).unwrap();
        assert!(bak.get("lastUsed").is_none());
        let doc = store_doc(&d);
        assert_eq!(doc["schemaVersion"], 2);
        assert_eq!(doc["presets"]["hcd"], serde_json::json!({"v": 2, "base": "builtin:characterize", "diff": {"tag_length": "4"}}));
        assert_eq!(doc["lastUsed"], serde_json::json!({"tag_length": "5"}));
        assert!(remove_preset(&store, "hcd"));
        assert!(!remove_preset(&store, "hcd"));
        // Refused while the file is not safe to write.
        assert!(!persist(&store, &path, false));
        assert!(store_doc(&d)["presets"].get("hcd").is_some());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_corrupt_store_is_restored_from_the_copy_of_its_last_save() {
        let d = scratch("store-corrupt");
        std::fs::write(d.join(STORE_FILE), b"{\"presets\": {\"a\"").unwrap();
        std::fs::write(d.join(STORE_BACKUP), br#"{"schemaVersion":2,"presets":{"a":{"v":2,"base":"defaults","diff":{}}}}"#).unwrap();
        // A v1 file beside it is not migrated over the restored store.
        std::fs::write(d.join(V1_FILE), b"{\"presets\":{}}").unwrap();
        assert!(prepare(&d).writable);
        assert!(store_doc(&d)["presets"].get("a").is_some());
        assert_eq!(std::fs::read(d.join(format!("{STORE_FILE}.corrupt"))).unwrap(), b"{\"presets\": {\"a\"");
        assert!(d.join(V1_FILE).exists());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[cfg(unix)]
    #[test]
    fn an_unreadable_store_is_never_written() {
        use std::os::unix::fs::PermissionsExt;
        let d = scratch("store-unreadable");
        let f = d.join(STORE_FILE);
        std::fs::write(&f, b"{\"presets\":{\"keep\":{}}}").unwrap();
        std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o000)).unwrap();
        if std::fs::read(&f).is_err() {
            assert!(!prepare(&d).writable);
        }
        std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o600)).unwrap();
        let _ = std::fs::remove_dir_all(&d);
    }

    /// A mock app with the store plugin, its settings opened by init() over
    /// @p d as the app opens them.
    fn mock_init(d: &Path) -> tauri::App<tauri::test::MockRuntime> {
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_store::Builder::new().build())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        init_in(app.handle(), Some(d.to_path_buf()));
        app
    }

    /// What the store plugin does on RunEvent::Exit for the settings file:
    /// save the store it holds at that path, if it holds one.
    fn exit_save(app: &tauri::App<tauri::test::MockRuntime>, d: &Path) -> bool {
        use tauri_plugin_store::StoreExt;
        match app.get_store(d.join(STORE_FILE)) {
            Some(st) => {
                let _ = st.save();
                true
            }
            None => false,
        }
    }

    /// The bytes of every file in @p d (None for a file that cannot be read).
    fn snapshot(d: &Path) -> Vec<(String, Option<Vec<u8>>)> {
        let mut v: Vec<_> = std::fs::read_dir(d)
            .unwrap()
            .map(|e| {
                let e = e.unwrap();
                (e.file_name().to_string_lossy().to_string(), std::fs::read(e.path()).ok())
            })
            .collect();
        v.sort();
        v
    }

    /// The refusal of prepare() holds through the whole session and the
    /// exit: nothing in @p d changes, no plugin store is opened, the session
    /// saves nothing and still reads @p presets presets.
    fn refused_session_writes_nothing(d: &Path, presets: usize) {
        let before = snapshot(d);
        let app = mock_init(d);
        assert_eq!(load_in(app.handle())["presets"].as_object().unwrap().len(), presets);
        assert!(!save_last_in(app.handle(), serde_json::json!({"tag_length": "9"})));
        assert!(!save_preset_in(app.handle(), "x", serde_json::json!({"v": 2, "base": "defaults", "diff": {}})));
        assert!(!delete_preset_in(app.handle(), "x"));
        assert!(!exit_save(&app, d), "no plugin store at settings.json");
        assert_eq!(snapshot(d), before);
    }

    #[cfg(unix)]
    fn chmod(p: &Path, mode: u32) {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(p, std::fs::Permissions::from_mode(mode)).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn an_unreadable_v1_file_survives_the_session_and_migrates_later() {
        let d = scratch("exit-v1-unreadable");
        let v1 = d.join(V1_FILE);
        std::fs::write(&v1, std::fs::read(V1_FIXTURE).unwrap()).unwrap();
        chmod(&v1, 0o000);
        if std::fs::read(&v1).is_err() {
            refused_session_writes_nothing(&d, 0);
            assert!(!d.join(STORE_FILE).exists());
        }
        chmod(&v1, 0o600);
        // The next start migrates it.
        assert!(prepare(&d).migrated.is_some());
        assert_eq!(store_doc(&d)["presets"].as_object().unwrap().len(), 2);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[cfg(unix)]
    #[test]
    fn a_v1_file_that_cannot_be_migrated_survives_the_session_and_migrates_later() {
        // A valid v1 file in a read-only dir (seeds the session) and a
        // corrupt one that cannot be set aside (refused outright).
        for (tag, body, presets) in [("ro", std::fs::read(V1_FIXTURE).unwrap(), 2), ("corrupt", b"{\"presets\": {".to_vec(), 0)] {
            let d = scratch(&format!("exit-v1-{tag}"));
            std::fs::write(d.join(V1_FILE), &body).unwrap();
            chmod(&d, 0o500);
            if std::fs::write(d.join("probe"), b"").is_err() {
                refused_session_writes_nothing(&d, presets);
                assert!(!d.join(STORE_FILE).exists());
            }
            chmod(&d, 0o700);
            let p = prepare(&d);
            assert!(p.writable, "{tag}");
            if presets > 0 {
                assert!(p.migrated.is_some());
                assert_eq!(store_doc(&d)["presets"].as_object().unwrap().len(), presets);
            } else {
                assert!(d.join(format!("{V1_FILE}.corrupt")).exists());
            }
            let _ = std::fs::remove_dir_all(&d);
        }
    }

    #[cfg(unix)]
    #[test]
    fn an_unreadable_store_survives_the_session_and_the_exit() {
        let d = scratch("exit-store-unreadable");
        let f = d.join(STORE_FILE);
        std::fs::write(&f, br#"{"schemaVersion":2,"presets":{"keep":{"v":2,"base":"defaults","diff":{}}}}"#).unwrap();
        chmod(&f, 0o000);
        if std::fs::read(&f).is_err() {
            refused_session_writes_nothing(&d, 0);
        }
        chmod(&f, 0o600);
        assert!(prepare(&d).writable);
        assert!(store_doc(&d)["presets"].get("keep").is_some());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[cfg(unix)]
    #[test]
    fn a_corrupt_store_that_cannot_be_set_aside_survives_the_session_and_the_exit() {
        let d = scratch("exit-store-corrupt");
        let f = d.join(STORE_FILE);
        std::fs::write(&f, b"{\"presets\": {\"a\"").unwrap();
        chmod(&d, 0o500);
        if std::fs::write(d.join("probe"), b"").is_err() {
            refused_session_writes_nothing(&d, 0);
            assert_eq!(std::fs::read(&f).unwrap(), b"{\"presets\": {\"a\"");
        }
        chmod(&d, 0o700);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_writable_session_opens_the_store_and_saves_through_it() {
        let d = scratch("exit-writable");
        std::fs::write(d.join(V1_FILE), std::fs::read(V1_FIXTURE).unwrap()).unwrap();
        let app = mock_init(&d);
        assert_eq!(load_in(app.handle())["presets"].as_object().unwrap().len(), 2);
        assert!(save_preset_in(app.handle(), "new", serde_json::json!({"v": 2, "base": "defaults", "diff": {"tag_length": "4"}})));
        assert!(delete_preset_in(app.handle(), "new"));
        assert!(!delete_preset_in(app.handle(), "new"));
        assert!(exit_save(&app, &d));
        assert_eq!(store_doc(&d)["presets"].as_object().unwrap().len(), 2);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_flat_preset_from_an_older_renderer_is_kept_as_it_is() {
        assert_eq!(sanitize_preset(serde_json::json!({"tag_length": "4", "prototype": 1})), Some(serde_json::json!({"tag_length": "4"})));
        assert_eq!(sanitize_preset(serde_json::json!("x")), None);
    }
}
