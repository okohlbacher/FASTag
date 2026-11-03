// Read a digest, label or mass-gap report (FASTag 1.8.0 -digest_out,
// -label_out, -massgap_out). They are small long-form TSVs; the frontend
// parses them. A file the run did not write is not an error.

use std::io::ErrorKind;

// The mass-gap histogram is the largest of them, a few thousand rows.
const MAX_BYTES: u64 = 32 << 20;

fn read_report(path: &str) -> Result<Option<String>, String> {
    if path.trim().is_empty() {
        return Ok(None);
    }
    let meta = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("{path}: {e}")),
    };
    if !meta.is_file() {
        return Err(format!("{path} is not a file"));
    }
    if meta.len() > MAX_BYTES {
        return Err(format!("{path} is {} MB, too large for a report", meta.len() >> 20));
    }
    std::fs::read_to_string(path).map(Some).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
pub fn report_text(path: String) -> Result<Option<String>, String> {
    read_report(&path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("fastag-report-{}-{}", std::process::id(), name))
    }

    #[test]
    fn missing_or_empty_path_is_none() {
        assert_eq!(read_report("").unwrap(), None);
        assert_eq!(read_report("/nonexistent/fastag/r.tsv").unwrap(), None);
    }

    #[test]
    fn directory_is_an_error() {
        assert!(read_report(std::env::temp_dir().to_str().unwrap()).is_err());
    }

    #[test]
    fn reads_text() {
        let f = tmp("ok.tsv");
        std::fs::write(&f, "section\tkey\tvalue\tn\tdescription\n").unwrap();
        assert_eq!(read_report(f.to_str().unwrap()).unwrap().unwrap(), "section\tkey\tvalue\tn\tdescription\n");
        std::fs::remove_file(&f).ok();
    }

    #[test]
    fn oversized_file_is_an_error() {
        let f = tmp("big.tsv");
        let fh = std::fs::File::create(&f).unwrap();
        fh.set_len(MAX_BYTES + 1).unwrap();
        let e = read_report(f.to_str().unwrap()).unwrap_err();
        assert!(e.contains("too large"), "{e}");
        std::fs::remove_file(&f).ok();
    }
}
