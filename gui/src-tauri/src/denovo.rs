// The file side of the Stitch/ALPS export (GUI-DESIGN 10 P3). The reads are
// made by export/denovo.ts, a byte-exact port of tools/tags_to_denovo.py; the
// backend only hands it the tags file's text and writes the reads it returns.
//
// tags_text: the whole tags file as text, up to MAX_BYTES. The port works on
// the whole file (the best N of each spectrum need every row of it); a file
// above the cap is refused with the script as the way out.
// denovo_write: the reads to a .csv the user chose, through <dest>.part and a
// rename, never over the tags file they came from.

use std::io::ErrorKind;
use std::path::Path;

/// 256 MB: about 1.5 M -res_conf tag rows. The renderer holds the text twice
/// (UTF-16) while it converts, which a WebView can afford at this size.
pub(crate) const MAX_BYTES: u64 = 256 << 20;

pub(crate) fn read_tags_text(path: &str) -> Result<String, String> {
    let meta = std::fs::metadata(path).map_err(|e| match e.kind() {
        ErrorKind::NotFound => format!("{path} does not exist"),
        _ => format!("{path}: {e}"),
    })?;
    if !meta.is_file() {
        return Err(format!("{path} is not a file"));
    }
    if meta.len() > MAX_BYTES {
        return Err(format!(
            "{path} is {} MB, above the {} MB the app exports as reads; run tools/tags_to_denovo.py on it instead",
            meta.len() >> 20,
            MAX_BYTES >> 20
        ));
    }
    // Strict UTF-8, as the script's open() reads it: a byte it cannot decode
    // stops the script, and a lossy read here would write reads it never would.
    let bytes = std::fs::read(path).map_err(|e| format!("{path}: {e}"))?;
    String::from_utf8(bytes).map_err(|e| format!("{path} is not UTF-8 text (byte {})", e.utf8_error().valid_up_to()))
}

fn same_file(a: &str, b: &str) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => a == b,
    }
}

pub(crate) fn write_reads(source: &str, dest: &str, text: &str) -> Result<(), String> {
    if !dest.to_ascii_lowercase().ends_with(".csv") {
        return Err(format!("reads are written to a .csv file, not {dest:?}"));
    }
    if same_file(source, dest) {
        return Err(format!("{dest} is the tags file being exported; choose another name"));
    }
    if Path::new(dest).is_dir() {
        return Err(format!("cannot write {dest}: it is a folder"));
    }
    let part = format!("{dest}.part");
    let done = std::fs::write(&part, text).and_then(|_| std::fs::rename(&part, dest));
    done.map_err(|e| {
        std::fs::remove_file(&part).ok();
        format!("cannot write {dest}: {e}")
    })
}

#[tauri::command]
pub async fn tags_text(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || read_tags_text(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn denovo_write(source: String, dest: String, text: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || write_reads(&source, &dest, &text))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("fastag-denovo-{}-{}", std::process::id(), name))
    }

    #[test]
    fn reads_the_whole_file_byte_for_byte() {
        let f = tmp("t.tags.tsv");
        // CRLF and a lone CR stay: the port splits lines as the script does.
        let text = "spectrum\ttag\r\na\tKK\rb\tLL\n";
        std::fs::write(&f, text).unwrap();
        assert_eq!(read_tags_text(f.to_str().unwrap()).unwrap(), text);
        std::fs::remove_file(&f).ok();
    }

    #[test]
    fn refuses_missing_folder_non_utf8_and_too_large() {
        let e = read_tags_text("/nonexistent/fastag/x.tags.tsv").unwrap_err();
        assert!(e.contains("does not exist"), "{e}");
        assert!(read_tags_text(std::env::temp_dir().to_str().unwrap()).unwrap_err().contains("not a file"));
        let f = tmp("latin1.tsv");
        std::fs::write(&f, b"spectrum\n\xe9\n").unwrap();
        assert!(read_tags_text(f.to_str().unwrap()).unwrap_err().contains("UTF-8"));
        let big = tmp("big.tsv");
        let fh = std::fs::File::create(&big).unwrap();
        fh.set_len(MAX_BYTES + 1).unwrap();
        let e = read_tags_text(big.to_str().unwrap()).unwrap_err();
        assert!(e.contains("tags_to_denovo.py"), "{e}");
        std::fs::remove_file(&f).ok();
        std::fs::remove_file(&big).ok();
    }

    #[test]
    fn writes_through_a_part_file() {
        let src = tmp("w.tags.tsv");
        let dest = tmp("w.stitch.csv");
        std::fs::write(&src, "x\n").unwrap();
        std::fs::write(&dest, "old\n").unwrap();
        write_reads(src.to_str().unwrap(), dest.to_str().unwrap(), "Scan,Peptide\n").unwrap();
        assert_eq!(std::fs::read_to_string(&dest).unwrap(), "Scan,Peptide\n");
        assert!(!Path::new(&format!("{}.part", dest.display())).exists());
        std::fs::remove_file(&src).ok();
        std::fs::remove_file(&dest).ok();
    }

    #[test]
    fn never_over_the_source_and_only_to_a_csv() {
        let src = tmp("s.csv");
        std::fs::write(&src, "spectrum\n").unwrap();
        let s = src.to_str().unwrap();
        let e = write_reads(s, s, "Scan\n").unwrap_err();
        assert!(e.contains("being exported"), "{e}");
        assert_eq!(std::fs::read_to_string(&src).unwrap(), "spectrum\n");
        let e = write_reads(s, tmp("r.tsv").to_str().unwrap(), "Scan\n").unwrap_err();
        assert!(e.contains(".csv"), "{e}");
        let missing = std::env::temp_dir().join("fastag-no-such-dir").join("r.csv");
        let e = write_reads(s, missing.to_str().unwrap(), "Scan\n").unwrap_err();
        assert!(e.contains("cannot write"), "{e}");
        assert!(!Path::new(&format!("{}.part", missing.display())).exists());
        std::fs::remove_file(&src).ok();
    }
}
