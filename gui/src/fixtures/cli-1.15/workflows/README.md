One real run per Setup workflow, for the `workflows` scenario of the e2e
bridge (testing/e2eBridge.ts) and the review screenshots: the Overview, the
report tabs and the Tags table of each run come from the same run, so their
counts agree.

Output of the Homebrew FASTag 1.15.3 CLI (macOS arm64) on
examples/Ecoli_MS2_small.mzML (copied as run01.mzML) and
examples/Ecoli_MS2_small.fasta, with the Ion trap CID preset of the GUI
(0.3 Da; the MS2 are ion trap CID) and the values each workflow sets
(gui/src/setup/tasks.ts). Each folder holds the files the run wrote, its
stderr (run01.stderr) and stdout (run01.stdout). Common to every run:

  FASTag -in run01.mzML -out run01.tags.tsv -threads 0 \
    -fragment_tolerance 0.3 -fragment_tolerance_unit Da ...

  export-tags   -res_conf
  run-qc        -qc_out run01.qc.tsv
  mass-shift    -recon_fasta ecoli.fasta -recon_out run01.recon.tsv
                -delta_out run01.delta.tsv -delta_spectra_out run01.delta_spectra.tsv
                -delta_counts_out run01.delta_counts.tsv -extension 3
  species       -species -extension 2
  db-reduction  -recon_fasta ecoli.fasta -shortlist_out run01.shortlist.tsv
                -fasta_out run01.reduced.fasta -search_config_out run01.search.json
                -extension 3 -shortlist_gapped -recon_min_length 6
                -shortlist_max_evalue 10 -recon_missed_cleavages 2
  triage        -census -census_score -census_sorted_out run01.census_sorted.tsv
  characterize  -digest_out run01.digest.tsv -label_out run01.label.tsv -glyco
                -species -extension 2 -subsample_fraction 0.1

Two tags tables are shared rather than kept twice: triage wrote the same
run01.tags.tsv as run-qc, db-reduction the same as mass-shift (byte for
byte). The census table run01.tags.census.tsv of triage is left out; the
ranking (census_sorted) holds the same rows.
