// Export INI (GUI-DESIGN 3 S1, 6.7): the session's parameters as a TOPP INI
// that the CLI reads back with -ini.
//
// TOPPBase's -write_ini stores the default parameters, updated only from
// -ini (TOPPBase.cpp:252-287; FASTag.cpp keeps that precedence), so a
// `FASTag <argv> -write_ini out` would drop every command-line value. The
// GUI therefore writes the run's argv as a temporary INI and lets the CLI
// merge it: `FASTag -ini <tmp> -write_ini <out>`. The items come from the
// very argv a run of the same request is given (fastag.rs build_args), so
// the INI cannot say anything the run would not do. The temporary file is
// removed again and never appears in an argv, History or Copy command.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use tauri::AppHandle;

use crate::fastag::{self, RunParams};
use crate::lifetime;

/// A parameter's value as an INI holds it.
#[derive(Clone, Debug, PartialEq)]
pub enum IniValue {
    Scalar(String),
    List(Vec<String>),
}

/// One ITEM or ITEMLIST of the exported INI.
#[derive(Clone, Debug, PartialEq)]
pub struct IniItem {
    pub name: String,
    /// The INI type: int, double, string, input-file, output-file (a bool
    /// is a string with the value true, as TOPPBase writes it).
    pub ty: &'static str,
    pub value: IniValue,
}

/// Parameters the app manages and an exported INI leaves to the CLI's own
/// default: -progress is added to every GUI run for the progress bar, and a
/// CLI user running the INI wants the plain log.
const APP_MANAGED: [&str; 1] = ["progress"];

fn ini_type(t: &str) -> &'static str {
    match t {
        "int" => "int",
        "double" => "double",
        "input-file" => "input-file",
        "output-file" => "output-file",
        _ => "string",
    }
}

/// The INI items of @p argv, an argv build_args produced (no binary): each
/// `-name value`, each switch `-name` (true), each list `-name a b ...`
/// (empty for a list cleared with `-name ''`). Tokens that are no option of
/// the tool are skipped; build_args never emits one.
pub fn items_from_argv(argv: &[String]) -> Vec<IniItem> {
    let types = &*fastag::PARAM_TYPES;
    let is_option = |tok: &str| tok.strip_prefix('-').is_some_and(|n| types.contains_key(n));
    let mut items = Vec::new();
    let mut i = 0;
    while i < argv.len() {
        let tok = &argv[i];
        i += 1;
        let Some(name) = tok.strip_prefix('-') else { continue };
        let Some(fastag::ParamType { ty: t, item_type: item, .. }) = types.get(name) else { continue };
        if APP_MANAGED.contains(&name) {
            continue;
        }
        match t.as_str() {
            "bool" => items.push(IniItem { name: name.into(), ty: "string", value: IniValue::Scalar("true".into()) }),
            "string-list" => {
                let mut vals = Vec::new();
                while i < argv.len() && !is_option(&argv[i]) {
                    if !argv[i].is_empty() {
                        vals.push(argv[i].clone());
                    }
                    i += 1;
                }
                let ty = if item.as_deref() == Some("int") { "int" } else if item.as_deref() == Some("double") { "double" } else { "string" };
                items.push(IniItem { name: name.into(), ty, value: IniValue::List(vals) });
            }
            other => {
                let Some(v) = argv.get(i) else { break };
                i += 1;
                if v.is_empty() {
                    continue; // -in "" before a file is chosen: nothing to store
                }
                items.push(IniItem { name: name.into(), ty: ini_type(other), value: IniValue::Scalar(v.clone()) });
            }
        }
    }
    items
}

fn esc(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => o.push_str("&amp;"),
            '<' => o.push_str("&lt;"),
            '>' => o.push_str("&gt;"),
            '"' => o.push_str("&quot;"),
            '\'' => o.push_str("&apos;"),
            '\n' => o.push_str("&#10;"),
            '\r' => o.push_str("&#13;"),
            '\t' => o.push_str("&#9;"),
            c => o.push(c),
        }
    }
    o
}

/// @p items as a TOPP INI (Param_1_8_0) for the tool FASTag, instance 1.
pub fn ini_xml(items: &[IniItem]) -> String {
    let mut x = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<PARAMETERS version=\"1.8.0\">\n  <NODE name=\"FASTag\">\n    <NODE name=\"1\">\n",
    );
    for it in items {
        match &it.value {
            IniValue::Scalar(v) => {
                x.push_str(&format!("      <ITEM name=\"{}\" value=\"{}\" type=\"{}\" />\n", esc(&it.name), esc(v), it.ty))
            }
            IniValue::List(vs) => {
                x.push_str(&format!("      <ITEMLIST name=\"{}\" type=\"{}\">\n", esc(&it.name), it.ty));
                for v in vs {
                    x.push_str(&format!("        <LISTITEM value=\"{}\"/>\n", esc(v)));
                }
                x.push_str("      </ITEMLIST>\n");
            }
        }
    }
    x.push_str("    </NODE>\n  </NODE>\n</PARAMETERS>\n");
    x
}

/// The CLI writes its INI as UTF-8 but declares ISO-8859-1, so reading it
/// back with -ini turns a non-ASCII path ("Café") into mojibake ("CafÃ©").
/// A file with non-ASCII text is given the declaration of what it is; an
/// ASCII-only file is left byte for byte as the CLI wrote it.
pub fn fix_declaration(bytes: &[u8]) -> Option<Vec<u8>> {
    if bytes.is_ascii() || std::str::from_utf8(bytes).is_err() {
        return None;
    }
    let text = std::str::from_utf8(bytes).ok()?;
    let end = text.find("?>")?;
    let decl = &text[..end];
    if !decl.starts_with("<?xml") {
        return None;
    }
    let fixed = decl.replace("encoding=\"ISO-8859-1\"", "encoding=\"UTF-8\"");
    (fixed != decl).then(|| format!("{fixed}{}", &text[end..]).into_bytes())
}

/// A temporary file name no other export uses.
fn temp_ini(dir: &Path) -> PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    dir.join(format!("fastag-export-{}-{t}-{n}.ini", std::process::id()))
}

/// What Export INI wrote.
#[derive(serde::Serialize, Debug)]
pub struct IniExport {
    /// The INI the CLI wrote.
    pub dest: String,
    /// The parameters it was given beyond its defaults.
    pub items: usize,
}

/// Export @p params to @p dest through the CLI @p cmd (the binary, or the
/// stub in the tests), with the temporary INI in @p tmp_dir.
pub fn export_with(mut cmd: Command, params: &RunParams, dest: &Path, tmp_dir: &Path) -> Result<IniExport, String> {
    if !dest.is_absolute() {
        return Err(format!("{} is not an absolute path", dest.display()));
    }
    let items = items_from_argv(&fastag::build_args(params));
    let tmp = temp_ini(tmp_dir);
    std::fs::write(&tmp, ini_xml(&items)).map_err(|e| format!("cannot write the temporary INI {}: {e}", tmp.display()))?;
    cmd.arg("-ini")
        .arg(&tmp)
        .arg("-write_ini")
        .arg(dest)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Started by the spawner thread like every CLI child (lifetime.rs); on
    // Windows in a job of its own, which is closed once it has ended.
    let out = lifetime::spawn_cli(cmd).and_then(|(c, _job)| c.wait_with_output());
    let _ = std::fs::remove_file(&tmp);
    let out = out.map_err(|e| format!("cannot start FASTag: {e}"))?;
    if !out.status.success() {
        let text = format!("{}\n{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
        let why = text.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("no message").trim().to_string();
        return Err(format!("FASTag could not write the INI ({why})"));
    }
    let bytes = std::fs::read(dest).map_err(|e| format!("FASTag wrote no INI at {}: {e}", dest.display()))?;
    if let Some(fixed) = fix_declaration(&bytes) {
        std::fs::write(dest, fixed).map_err(|e| format!("cannot write {}: {e}", dest.display()))?;
    }
    Ok(IniExport { dest: dest.display().to_string(), items: items.len() })
}

/// Export INI: the request a run would be given, written to @p dest as an
/// INI the CLI runs with `FASTag -ini <dest>`.
#[tauri::command]
pub async fn export_ini(app: AppHandle, params: RunParams, dest: String) -> Result<IniExport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let r = fastag::resolve_binary(&app);
        if r.source == "missing" {
            return Err("the FASTag command-line tool is not in this app".to_string());
        }
        // Started like the probe: a short child that ends on its own.
        let mut cmd = Command::new(&r.bin);
        fastag::no_console_window(&mut cmd);
        if let Some(d) = &r.data {
            cmd.env("OPENMS_DATA_PATH", d);
        }
        fastag::quiet_blas(&mut cmd);
        lifetime::die_with_parent(&mut cmd);
        export_with(cmd, &params, Path::new(&dest), &std::env::temp_dir())
    })
    .await
    .unwrap_or_else(|e| Err(format!("export failed: {e}")))
}

/// The items of a TOPP INI by name, for the round-trip tests: every ITEM's
/// value and every ITEMLIST's items, entities decoded.
#[cfg(test)]
pub fn parse_ini(xml: &str) -> std::collections::HashMap<String, IniValue> {
    fn attr(line: &str, key: &str) -> Option<String> {
        let pat = format!(" {key}=\"");
        let s = line.find(&pat)? + pat.len();
        let e = line[s..].find('"')? + s;
        Some(unesc(&line[s..e]))
    }
    fn unesc(s: &str) -> String {
        s.replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&apos;", "'")
            .replace("&#10;", "\n")
            .replace("&#13;", "\r")
            .replace("&#9;", "\t")
            .replace("&amp;", "&")
    }
    let mut out = std::collections::HashMap::new();
    let mut list: Option<(String, Vec<String>)> = None;
    for line in xml.lines() {
        let l = line.trim_start();
        if l.starts_with("<ITEMLIST ") {
            list = attr(l, "name").map(|n| (n, Vec::new()));
        } else if l.starts_with("<LISTITEM ") {
            if let (Some((_, vs)), Some(v)) = (list.as_mut(), attr(l, "value")) {
                vs.push(v);
            }
        } else if l.starts_with("</ITEMLIST>") {
            if let Some((n, vs)) = list.take() {
                out.insert(n, IniValue::List(vs));
            }
        } else if l.starts_with("<ITEM ") {
            if let (Some(n), Some(v)) = (attr(l, "name"), attr(l, "value")) {
                out.insert(n, IniValue::Scalar(v));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn rp(json: &str) -> RunParams {
        serde_json::from_str(json).unwrap()
    }
    fn argv(json: &str) -> Vec<String> {
        fastag::build_args(&rp(json))
    }
    fn scalar(s: &str) -> IniValue {
        IniValue::Scalar(s.into())
    }
    fn by_name(items: &[IniItem]) -> HashMap<String, IniValue> {
        items.iter().map(|i| (i.name.clone(), i.value.clone())).collect()
    }

    #[test]
    fn items_are_the_argv_of_the_same_request() {
        let a = argv(
            r#"{"in":"/d/a.mzML","out":"/d/a.tags.tsv","params":{"tag_length":"5","species":true,"glyco":false,
               "fragment_tolerance":"0.3","fragment_tolerance_unit":"Da","tag_lengths":["5","6"],
               "fixed_modifications":[],"digest_out":"a.digest.tsv","threads":"0"}}"#,
        );
        let items = items_from_argv(&a);
        let m = by_name(&items);
        assert_eq!(m.get("in"), Some(&scalar("/d/a.mzML")));
        assert_eq!(m.get("out"), Some(&scalar("/d/a.tags.tsv")));
        assert_eq!(m.get("tag_length"), Some(&scalar("5")));
        assert_eq!(m.get("species"), Some(&scalar("true")));
        // A switch that is off is not in the argv, so the CLI default (off) stays.
        assert!(!m.contains_key("glyco"));
        assert_eq!(m.get("tag_lengths"), Some(&IniValue::List(vec!["5".into(), "6".into()])));
        // Cleared on purpose: an empty list, not the Carbamidomethyl default.
        assert_eq!(m.get("fixed_modifications"), Some(&IniValue::List(vec![])));
        // A relative report path is the absolute one the run is given.
        assert_eq!(m.get("digest_out"), Some(&scalar("/d/a.digest.tsv")));
        assert_eq!(m.get("threads"), Some(&scalar("0")));
        // -progress is the GUI's own; an exported INI leaves it to the CLI.
        assert!(!m.contains_key("progress"));
        let ty = |n: &str| items.iter().find(|i| i.name == n).unwrap().ty;
        assert_eq!((ty("tag_length"), ty("fragment_tolerance"), ty("in"), ty("digest_out")), ("int", "double", "input-file", "output-file"));
        assert_eq!((ty("tag_lengths"), ty("fixed_modifications"), ty("species")), ("int", "string", "string"));
    }

    #[test]
    fn negative_numbers_and_dash_file_names_stay_values() {
        let a = argv(r#"{"in":"/d/a.mzML","out":"/d/o.tsv","params":{"subsample_seed":"-1","fasta":"-db.fasta"}}"#);
        let m = by_name(&items_from_argv(&a));
        assert_eq!(m.get("subsample_seed"), Some(&scalar("-1")));
        assert_eq!(m.get("fasta"), Some(&scalar("/d/-db.fasta")));
    }

    #[test]
    fn the_xml_escapes_every_value_and_parses_back() {
        let items = items_from_argv(&argv(
            r#"{"in":"/d/Café & <x> \"q\" 'a'/a.mzML","out":"/d/o.tsv","params":{"variable_modifications":["Phospho (S)","Oxidation (M)"]}}"#,
        ));
        let xml = ini_xml(&items);
        assert!(xml.starts_with("<?xml version=\"1.0\" encoding=\"UTF-8\"?>"));
        assert!(xml.contains("&amp; &lt;x&gt; &quot;q&quot; &apos;a&apos;"));
        assert_eq!(parse_ini(&xml), by_name(&items));
    }

    #[test]
    fn the_declaration_is_fixed_only_for_non_ascii_text() {
        let ascii = b"<?xml version=\"1.0\" encoding=\"ISO-8859-1\"?>\n<PARAMETERS/>\n";
        assert_eq!(fix_declaration(ascii), None);
        let utf8 = "<?xml version=\"1.0\" encoding=\"ISO-8859-1\"?>\n<ITEM value=\"Café\"/>\n";
        assert_eq!(
            String::from_utf8(fix_declaration(utf8.as_bytes()).unwrap()).unwrap(),
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<ITEM value=\"Café\"/>\n"
        );
        // Real Latin-1 bytes are what they say they are.
        assert_eq!(fix_declaration(b"<?xml version=\"1.0\" encoding=\"ISO-8859-1\"?><x v=\"Caf\xE9\"/>"), None);
    }

    #[test]
    fn a_relative_destination_is_refused() {
        let e = export_with(Command::new("true"), &rp(r#"{"in":"","out":""}"#), Path::new("x.ini"), &std::env::temp_dir());
        assert!(e.unwrap_err().contains("not an absolute path"));
    }

    // The round trip of the acceptance test (GUI-DESIGN 10 P2a): export,
    // then the CLI's effective parameters under `-ini <export>` equal the
    // GUI run's argv over the CLI's defaults.
    #[cfg(unix)]
    mod round_trip {
        use super::*;

        const STUB: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../testing/stub-fastag/FASTag");

        fn dir(name: &str) -> PathBuf {
            let d = std::env::temp_dir().join(format!("fastag-ini-{}-{name}", std::process::id()));
            let _ = std::fs::remove_dir_all(&d);
            std::fs::create_dir_all(&d).unwrap();
            d
        }

        /// The installed FASTag CLI: FASTAG_REAL_CLI, else FASTag on PATH.
        /// None when there is none (the GUI CI job has only the stub).
        fn real_cli() -> Option<PathBuf> {
            if let Ok(p) = std::env::var("FASTAG_REAL_CLI") {
                return Some(PathBuf::from(p)).filter(|p| p.exists());
            }
            let out = Command::new("sh").arg("-c").arg("command -v FASTag").output().ok()?;
            let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
            (!p.is_empty() && out.status.success()).then(|| PathBuf::from(p))
        }

        fn stub() -> Command {
            let mut c = Command::new("sh");
            c.arg(STUB);
            c
        }

        fn run_ok(mut cmd: Command) -> std::process::Output {
            let out = cmd.stdin(Stdio::null()).output().expect("start the CLI");
            assert!(out.status.success(), "CLI failed: {}", String::from_utf8_lossy(&out.stderr));
            out
        }

        // A request with every kind of value: numbers (one negative-free
        // double the CLI writes as 0.3), a unit, a switch, two lists (one
        // cleared against a non-empty default), a report path relative to
        // the input folder, and a folder with non-ASCII and XML characters.
        fn request(d: &Path, stem: &str) -> String {
            let input = d.join("Ecoli_MS2_small.mzML");
            serde_json::json!({
                "in": input.display().to_string(),
                "out": format!("{stem}.tags.tsv"),
                "params": {
                    "tag_length": "4", "extension": "2", "max_tags": "20",
                    "fragment_tolerance": "0.3", "fragment_tolerance_unit": "Da",
                    "proforma": true, "diversity": false,
                    "fixed_modifications": [], "variable_modifications": ["Oxidation (M)"],
                    "digest_out": format!("{stem}.digest.tsv"), "threads": "1", "max_evalue": ""
                }
            })
            .to_string()
        }

        /// The effective parameters of @p argv over @p defaults: what the
        /// CLI runs with when given that argv.
        fn effective(defaults: &HashMap<String, IniValue>, argv: &[String]) -> HashMap<String, IniValue> {
            let mut m = defaults.clone();
            for it in items_from_argv(argv) {
                m.insert(it.name, it.value);
            }
            m
        }

        /// Numbers compare as numbers: the CLI writes 20 as 20.0.
        fn same(a: &HashMap<String, IniValue>, b: &HashMap<String, IniValue>) -> Vec<String> {
            let num = |v: &IniValue| match v {
                IniValue::Scalar(s) => s.parse::<f64>().ok(),
                _ => None,
            };
            let mut keys: Vec<&String> = a.keys().chain(b.keys()).collect();
            keys.sort();
            keys.dedup();
            keys.into_iter()
                .filter(|k| *k != "version")
                .filter(|k| {
                    let (x, y) = (a.get(*k), b.get(*k));
                    match (x.and_then(num), y.and_then(num)) {
                        (Some(p), Some(q)) => p != q,
                        _ => x != y,
                    }
                })
                .map(|k| format!("{k}: {:?} vs {:?}", a.get(k), b.get(k)))
                .collect()
        }

        fn fixture(d: &Path) {
            let src = concat!(env!("CARGO_MANIFEST_DIR"), "/../../test/fixtures/Ecoli_MS2_small.mzML");
            std::fs::copy(src, d.join("Ecoli_MS2_small.mzML")).unwrap();
        }

        #[test]
        fn export_ini_round_trip_with_the_stub_cli() {
            eprintln!("Export INI round trip: stub CLI ({STUB})");
            let d = dir("stub Café &");
            fixture(&d);
            let p = rp(&request(&d, "a"));
            let dest = d.join("exported.ini");
            let r = export_with(stub(), &p, &dest, &d).expect("export");
            // The temporary INI is gone again.
            let left: Vec<_> = std::fs::read_dir(&d)
                .unwrap()
                .filter_map(|e| e.ok())
                .filter(|e| e.file_name().to_string_lossy().starts_with("fastag-export-"))
                .collect();
            assert!(left.is_empty(), "temporary INI left behind");
            let exported = parse_ini(&std::fs::read_to_string(&dest).unwrap());
            // The stub has no defaults of its own: its INI is the given items,
            // which are the run's argv.
            let want = effective(&HashMap::new(), &fastag::build_args(&p));
            assert_eq!(same(&exported, &want), Vec::<String>::new());
            assert_eq!(r.items, want.len());
            // A run with -ini reads its input and output from the INI.
            let mut run = stub();
            run.arg("-ini").arg(&dest);
            run_ok(run);
            assert!(d.join("a.tags.tsv").exists(), "the -ini run wrote no -out");
        }

        #[test]
        fn a_failing_cli_reports_why_and_leaves_no_temporary_file() {
            let d = dir("fail");
            let p = rp(r#"{"in":"/nowhere/a.mzML","out":"/nowhere/a.tags.tsv"}"#);
            let mut c = stub();
            c.env("STUB_INI_FAIL", "1");
            let e = export_with(c, &p, &d.join("x.ini"), &d).unwrap_err();
            assert!(e.contains("stub told to fail"), "{e}");
            assert_eq!(std::fs::read_dir(&d).unwrap().count(), 0);
        }

        #[test]
        fn export_ini_round_trip_with_the_real_cli() {
            let Some(cli) = real_cli() else {
                eprintln!("Export INI round trip: no real FASTag CLI (FASTAG_REAL_CLI or PATH); covered by the stub test only");
                return;
            };
            eprintln!("Export INI round trip: real CLI {}", cli.display());
            let d = dir("real Café & <x>");
            fixture(&d);
            // The CLI's own defaults.
            let defaults_ini = d.join("defaults.ini");
            let mut c = Command::new(&cli);
            c.arg("-write_ini").arg(&defaults_ini);
            run_ok(c);
            let defaults = parse_ini(&std::fs::read_to_string(&defaults_ini).unwrap());

            // 1. The effective parameters of `-ini <export>` are the run's.
            let p = rp(&request(&d, "ini"));
            let dest = d.join("exported.ini");
            export_with(Command::new(&cli), &p, &dest, &d).expect("export");
            let reread = d.join("reread.ini");
            let mut c = Command::new(&cli);
            c.arg("-ini").arg(&dest).arg("-write_ini").arg(&reread);
            run_ok(c);
            let eff = parse_ini(&std::fs::read_to_string(&reread).unwrap());
            let want = effective(&defaults, &fastag::build_args(&p));
            assert_eq!(same(&eff, &want), Vec::<String>::new(), "effective parameters differ");

            // 2. And the runs agree: the GUI's argv and `-ini <export>` write
            // the same tags and the same digest report.
            let gui = rp(&request(&d, "gui"));
            let mut c = Command::new(&cli);
            c.args(fastag::build_args(&gui)).current_dir(&d);
            run_ok(c);
            let mut c = Command::new(&cli);
            c.arg("-ini").arg(&dest).current_dir(&d);
            run_ok(c);
            let read = |n: &str| std::fs::read(d.join(n)).unwrap_or_else(|e| panic!("{n}: {e}"));
            assert!(!read("gui.tags.tsv").is_empty());
            assert_eq!(read("gui.tags.tsv"), read("ini.tags.tsv"), "tags differ");
            assert!(!read("gui.digest.tsv").is_empty());
            assert_eq!(read("gui.digest.tsv"), read("ini.digest.tsv"), "digest reports differ");
        }
    }
}
