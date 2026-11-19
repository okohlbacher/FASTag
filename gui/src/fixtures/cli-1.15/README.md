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

The QC, identifiability and shortlist reports of the workflow screens
(e2e bridge, testing/e2eBridge.ts) are the output of the Homebrew FASTag
1.15.2 CLI on examples/Ecoli_MS2_small.mzML with its FASTA, run from
examples/:

  FASTag -in Ecoli_MS2_small.mzML -out ecoli.tags.tsv -fragment_tolerance 0.3 \
    -fragment_tolerance_unit Da -qc_out ecoli.qc.tsv -census -census_score \
    -census_sorted_out ecoli.census_sorted.tsv -recon_fasta Ecoli_MS2_small.fasta \
    -extension 3 -shortlist_out ecoli.shortlist.tsv -fasta_out ecoli.reduced.fasta \
    -search_config_out ecoli.search.json -recon_out ecoli.recon.tsv

saved as ecoli_ms2_small_0.3da.{qc,census_sorted,shortlist}.tsv.
