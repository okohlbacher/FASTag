// Read a digest, label or mass-gap report (-digest_out, -label_out,
// -massgap_out). They are small long-form TSVs; the frontend parses them. A
// file the run did not write is not an error. species.rs reads the -species
// TSV through the same reader.

use std::io::ErrorKind;

// The mass-gap histogram is the largest of them, a few thousand rows.
const MAX_BYTES: u64 = 32 << 20;

pub(crate) fn read_report(path: &str) -> Result<Option<String>, String> {
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
    // Lossy: a Windows build writes the input's basename in the ANSI code
    // page, and one non-UTF-8 byte must not hide the whole report.
    std::fs::read(path)
        .map(|b| Some(String::from_utf8_lossy(&b).into_owned()))
        .map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
pub fn report_text(path: String) -> Result<Option<String>, String> {
    read_report(&path)
}

/// Write the batch summary TSV (P2b) to @p dest, a .tsv the user chose:
/// to `<dest>.part` first, renamed over @p dest once complete, so a failed
/// write never leaves a truncated summary under the chosen name.
///
/// @p protect: files the write must never replace (the corrections export
/// passes the loaded SDRF): a @p dest that is one of them, by its path or
/// as the same file on disk (another spelling, case, a link), is refused.
pub(crate) fn write_summary(dest: &str, text: &str, protect: &[String]) -> Result<(), String> {
    if !dest.to_ascii_lowercase().ends_with(".tsv") {
        return Err(format!("the summary is a .tsv file, not {dest:?}"));
    }
    if text.len() as u64 > MAX_BYTES {
        return Err(format!("the summary is {} MB, too large", text.len() >> 20));
    }
    if std::path::Path::new(dest).is_dir() {
        return Err(format!("cannot write {dest}: it is a folder"));
    }
    if let Some(p) = protect.iter().find(|p| same_file(dest, p)) {
        return Err(format!("cannot write {dest}: it is {p}, which is never written (choose another name)"));
    }
    let part = format!("{dest}.part");
    let done = std::fs::write(&part, text).and_then(|_| std::fs::rename(&part, dest));
    done.map_err(|e| {
        std::fs::remove_file(&part).ok();
        format!("cannot write {dest}: {e}")
    })
}

/// Whether @p a and @p b name the same file: the same path, or (both
/// existing) the same file on disk, by device and inode on Unix and by the
/// canonical path elsewhere (which resolves case and links on Windows).
fn same_file(a: &str, b: &str) -> bool {
    if a == b {
        return true;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if let (Ok(x), Ok(y)) = (std::fs::metadata(a), std::fs::metadata(b)) {
            return x.dev() == y.dev() && x.ino() == y.ino();
        }
    }
    #[cfg(not(unix))]
    {
        if let (Ok(x), Ok(y)) = (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
            return x == y;
        }
    }
    false
}

#[tauri::command]
pub fn summary_write(dest: String, text: String, protect: Option<Vec<String>>) -> Result<(), String> {
    write_summary(&dest, &text, protect.as_deref().unwrap_or(&[]))
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

    // The batch summary TSV (P2b): written whole or not at all.
    #[test]
    fn summary_is_written_through_a_part_file() {
        let f = tmp("summary.tsv");
        std::fs::write(&f, "old\n").unwrap();
        write_summary(f.to_str().unwrap(), "file\tstatus\na.mzML\tdone\n", &[]).unwrap();
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "file\tstatus\na.mzML\tdone\n");
        assert!(!std::path::Path::new(&format!("{}.part", f.display())).exists());
        std::fs::remove_file(&f).ok();
    }

    #[test]
    fn summary_needs_a_tsv_name_and_a_writable_folder() {
        let e = write_summary(tmp("summary.txt").to_str().unwrap(), "x\n", &[]).unwrap_err();
        assert!(e.contains(".tsv"), "{e}");
        let e = write_summary("", "x\n", &[]).unwrap_err();
        assert!(e.contains(".tsv"), "{e}");
        let missing = std::env::temp_dir().join("fastag-no-such-dir").join("s.tsv");
        let e = write_summary(missing.to_str().unwrap(), "x\n", &[]).unwrap_err();
        assert!(e.contains("cannot write"), "{e}");
        assert!(!std::path::Path::new(&format!("{}.part", missing.display())).exists());
        // Not over a folder of that name.
        let d = tmp("dir.tsv");
        std::fs::create_dir_all(&d).unwrap();
        assert!(write_summary(d.to_str().unwrap(), "x\n", &[]).is_err());
        assert!(d.is_dir());
        std::fs::remove_dir_all(&d).ok();
        let e = write_summary(tmp("huge.tsv").to_str().unwrap(), &"x".repeat(MAX_BYTES as usize + 1), &[]).unwrap_err();
        assert!(e.contains("too large"), "{e}");
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

    // The corrections export (P4) never replaces the loaded SDRF: not by its
    // path, and not through another spelling of the same file.
    #[test]
    fn summary_never_replaces_a_protected_file() {
        let sdrf = tmp("project.sdrf.tsv");
        std::fs::write(&sdrf, b"\xef\xbb\xbfsource name\r\ns1\r\n").unwrap();
        let before = std::fs::read(&sdrf).unwrap();
        let p = sdrf.to_str().unwrap().to_string();
        let e = write_summary(&p, "data_file\n", std::slice::from_ref(&p)).unwrap_err();
        assert!(e.contains("never written"), "{e}");
        // The same file by another path (a "." segment).
        let dir = sdrf.parent().unwrap();
        let other = format!("{}/./{}", dir.display(), sdrf.file_name().unwrap().to_str().unwrap());
        let e = write_summary(&other, "data_file\n", std::slice::from_ref(&p)).unwrap_err();
        assert!(e.contains("never written"), "{e}");
        #[cfg(unix)]
        {
            let link = tmp("link.sdrf.tsv");
            std::fs::remove_file(&link).ok();
            std::os::unix::fs::symlink(&sdrf, &link).unwrap();
            assert!(write_summary(link.to_str().unwrap(), "data_file\n", std::slice::from_ref(&p)).is_err());
            std::fs::remove_file(&link).ok();
        }
        assert_eq!(std::fs::read(&sdrf).unwrap(), before);
        assert!(!std::path::Path::new(&format!("{p}.part")).exists());
        // Another file in the same folder is written.
        let out = tmp("project.corrections.tsv");
        write_summary(out.to_str().unwrap(), "data_file\n", std::slice::from_ref(&p)).unwrap();
        assert_eq!(std::fs::read_to_string(&out).unwrap(), "data_file\n");
        std::fs::remove_file(&out).ok();
        std::fs::remove_file(&sdrf).ok();
    }
}
