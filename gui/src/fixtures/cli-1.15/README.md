Output of the released FASTag 1.15.0 CLI (Homebrew build, macOS arm64) on
test/fixtures/Ecoli_MS2_small.mzML (LTQ Orbitrap XL, ion-trap CID MS2; the
filter strings read "ITMS", and no two peaks are closer than 0.600 Th), run
from the repository root:

  FASTag -probe_input test/fixtures/Ecoli_MS2_small.mzML > ../probe/ecoli_ms2_small.probe.jsonl
  FASTag -in test/fixtures/Ecoli_MS2_small.mzML -out tags.tsv -digest_out ecoli_ms2_small_20ppm.digest.tsv 2> ecoli_ms2_small_20ppm.stderr

The probe names the MS2 analyser "orbitrap" with ms2_analyzer_from
"run_default": the file has a single instrument configuration (the
converter's) and its spectra reference none, so the analyser is the run's
default, not where the MS2 were read.
