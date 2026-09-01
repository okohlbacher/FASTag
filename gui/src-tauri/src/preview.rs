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
    // newline-free multi-GB "line" in RAM, defeating the row bound. Capped at
    // MAX+1 so limit()==0 means the file genuinely EXCEEDS the cap -- a file
    // of exactly MAX bytes drains to limit()==1 and is complete.
    const MAX_PREVIEW_BYTES: u64 = 16 * 1024 * 1024;
    if let Ok(file) = std::fs::File::open(&path) {
        use std::io::Read;
        let mut reader = BufReader::new(file.take(MAX_PREVIEW_BYTES + 1));
        let mut line = String::new();
        let mut first = true;
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            // A read that hit the cap mid-line is a partial record: mark and
            // drop it rather than surfacing a silently-cut row.
            if !line.ends_with('\n') && reader.get_ref().limit() == 0 {
                truncated = true;
                break;
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
            truncated = true; // more file exists beyond the cap
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
    fn byte_cap_edges() {
        const MB16: usize = 16 * 1024 * 1024;
        // A newline-free giant "line" must not be surfaced as a row, and must
        // mark truncation.
        let p1 = std::env::temp_dir().join("fastag_prev_giant.tsv");
        std::fs::write(&p1, vec![b'x'; MB16 + 100]).unwrap();
        let r = preview(p1.to_string_lossy().into_owned(), Some(10));
        assert!(r.header.is_empty(), "partial cap-hit line must be dropped");
        assert!(r.truncated);
        std::fs::remove_file(&p1).ok();

        // A complete file of exactly the cap size is NOT truncated.
        let p2 = std::env::temp_dir().join("fastag_prev_exact.tsv");
        let mut body = vec![b'a'; MB16 - 1];
        body.push(b'\n');
        std::fs::write(&p2, body).unwrap();
        let r2 = preview(p2.to_string_lossy().into_owned(), Some(10));
        assert!(!r2.truncated, "exact-cap complete file is not truncated");
        std::fs::remove_file(&p2).ok();
    }

    #[test]
    fn missing_file_yields_empty_preview() {
        let r = preview("/definitely/not/a/file.tsv".into(), None);
        assert!(r.header.is_empty());
        assert_eq!(r.shown, 0);
        assert!(!r.truncated);
    }
}
