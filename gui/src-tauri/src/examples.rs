// File > Open Example Data: the example run shipped in the bundle
// (<resources>/fastag/examples, the repository's examples/), copied to a
// folder the user can write to and opened as the input. A run writes its
// outputs beside its input, and the bundle's own folder is read-only on every
// platform (an .app in /Applications, /usr/lib/FASTag, Program Files), so the
// example is run from the app's local data folder instead.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

/// The example input; the other files of the folder (its FASTA, README) are
/// copied with it.
pub const EXAMPLE_INPUT: &str = "Ecoli_MS2_small.mzML";

/// The shipped examples folder: in the bundle's resources, or in a debug
/// build the repository's examples/ (tauri dev populates no resource dir).
fn shipped(app: &AppHandle) -> Option<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(rd) = app.path().resource_dir() {
        roots.push(dunce::simplified(&rd).join("resources").join("fastag").join("examples"));
    }
    if cfg!(debug_assertions) {
        roots.push(PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../examples")));
    }
    roots.into_iter().find(|r| r.join(EXAMPLE_INPUT).is_file())
}

/// Copy the regular files of @p from into @p to (created if missing) and
/// return the example input there. A file already there with the same size is
/// kept, so outputs of earlier runs beside it survive and a second Open
/// Example costs nothing; a different size (a newer app's example) is
/// replaced.
pub fn stage(from: &Path, to: &Path) -> Result<PathBuf, String> {
    if !from.join(EXAMPLE_INPUT).is_file() {
        return Err(format!("no {EXAMPLE_INPUT} in {}", from.display()));
    }
    std::fs::create_dir_all(to).map_err(|e| format!("cannot create {}: {e}", to.display()))?;
    let entries = std::fs::read_dir(from).map_err(|e| format!("cannot read {}: {e}", from.display()))?;
    for e in entries.flatten() {
        let src = e.path();
        if !src.is_file() {
            continue;
        }
        let dst = to.join(e.file_name());
        let same = match (std::fs::metadata(&src), std::fs::metadata(&dst)) {
            (Ok(a), Ok(b)) => a.len() == b.len(),
            _ => false,
        };
        if !same {
            std::fs::copy(&src, &dst).map_err(|e| format!("cannot copy {} to {}: {e}", src.display(), dst.display()))?;
        }
    }
    Ok(to.join(EXAMPLE_INPUT))
}

/// The example input, staged in <app local data>/examples; an error names
/// what is missing.
#[tauri::command]
pub fn example_input(app: AppHandle) -> Result<String, String> {
    let from = shipped(&app).ok_or("this installation has no example data (resources/fastag/examples)")?;
    let to = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("no local data folder: {e}"))?
        .join("examples");
    stage(&from, &to).map(|p| p.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("fastag-examples-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn stages_the_shipped_examples_and_keeps_outputs() {
        let d = tmp("stage");
        let (from, to) = (d.join("shipped"), d.join("data").join("examples"));
        std::fs::create_dir_all(&from).unwrap();
        std::fs::write(from.join(EXAMPLE_INPUT), "spectra").unwrap();
        std::fs::write(from.join("Ecoli_MS2_small.fasta"), ">p\nPEPTIDE\n").unwrap();
        std::fs::create_dir_all(from.join("sub")).unwrap();

        let input = stage(&from, &to).unwrap();
        assert_eq!(input, to.join(EXAMPLE_INPUT));
        assert_eq!(std::fs::read_to_string(&input).unwrap(), "spectra");
        assert!(to.join("Ecoli_MS2_small.fasta").is_file());
        assert!(!to.join("sub").exists(), "only files are copied");

        // An output of an earlier run survives a second Open Example.
        std::fs::write(to.join("Ecoli_MS2_small.tags.tsv"), "spectrum\ttag\n").unwrap();
        stage(&from, &to).unwrap();
        assert!(to.join("Ecoli_MS2_small.tags.tsv").is_file());

        // A different example (a newer app) replaces the staged copy.
        std::fs::write(from.join(EXAMPLE_INPUT), "newer spectra").unwrap();
        stage(&from, &to).unwrap();
        assert_eq!(std::fs::read_to_string(to.join(EXAMPLE_INPUT)).unwrap(), "newer spectra");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn refuses_a_folder_without_the_example() {
        let d = tmp("missing");
        let err = stage(&d.join("nothing"), &d.join("to")).unwrap_err();
        assert!(err.contains(EXAMPLE_INPUT), "{err}");
        let _ = std::fs::remove_dir_all(&d);
    }

    // The repository's examples/ is what the bundles ship (ci.yml, windows.yml).
    #[test]
    fn the_repository_ships_the_example() {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples");
        assert!(repo.join(EXAMPLE_INPUT).is_file(), "{}", repo.display());
        assert!(repo.join("Ecoli_MS2_small.fasta").is_file());
    }
}
