// Bounded TSV preview for the results pane. A full run is 100k-1M+ rows; this
// streams the header plus the first N data rows and stops early, so a huge file
// never loads into memory. Ported from gui/src/main/preview.ts.

use serde::Serialize;
use std::io::{BufRead, BufReader};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    header: Vec<String>,
    rows: Vec<Vec<String>>,
    truncated: bool,
    shown: usize,
}

#[tauri::command]
pub fn preview(path: String, max_rows: Option<usize>) -> Preview {
    let max = max_rows.unwrap_or(200);
    let mut header: Vec<String> = Vec::new();
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut truncated = false;

    // Byte-cap the whole read: .lines() would otherwise buffer a single
    // newline-free multi-GB "line" in RAM, defeating the row bound.
    const MAX_PREVIEW_BYTES: u64 = 16 * 1024 * 1024;
    if let Ok(file) = std::fs::File::open(&path) {
        use std::io::Read;
        let mut reader = BufReader::new(file.take(MAX_PREVIEW_BYTES));
        let mut line = String::new();
        let mut first = true;
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            let l = line.trim_end_matches(['\n', '\r']);
            if first {
                header = l.split('\t').map(|s| s.to_string()).collect();
                first = false;
                continue;
            }
            if rows.len() < max {
                rows.push(l.split('\t').map(|s| s.to_string()).collect());
            } else {
                truncated = true;
                break;
            }
        }
        if reader.get_ref().limit() == 0 {
            truncated = true; // hit the byte cap mid-file
        }
    }

    let shown = rows.len();
    Preview { header, rows, truncated, shown }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_caps_rows_and_flags_truncation() {
        let mut p = std::env::temp_dir();
        p.push(format!("fastag-test-{}-prev.tsv", std::process::id()));
        let mut body = String::from("a\tb\n");
        for i in 0..300 {
            body.push_str(&format!("{i}\tx\n"));
        }
        std::fs::write(&p, body).unwrap();
        let r = preview(p.to_string_lossy().into_owned(), Some(200));
        assert_eq!(r.header, vec!["a", "b"]);
        assert_eq!(r.shown, 200);
        assert!(r.truncated);
        let r2 = preview(p.to_string_lossy().into_owned(), Some(1000));
        assert_eq!(r2.shown, 300);
        assert!(!r2.truncated);
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn missing_file_yields_empty_preview() {
        let r = preview("/definitely/not/a/file.tsv".into(), None);
        assert!(r.header.is_empty());
        assert_eq!(r.shown, 0);
        assert!(!r.truncated);
    }
}
