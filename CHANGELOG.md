# Changelog

## 1.12.0 (release candidate)

All defaults are those of FASTag 1.11, with one exception (#7 below). At the
defaults every output is the same as FASTag 1.11.0 byte for byte; every new
option is opt-in. The options marked experimental are not validated on
held-out data yet. The README's command-line reference describes each option.

### Changed default

- **Raw DIA input is refused (#7).** `-acquisition_check refuse` is the
  default: a raw DIA run (MS2 "precursors" that are isolation windows) ends
  with exit code 11 before any output is opened, with one
  `FASTAG_REFUSED reason=raw_dia ...` line on stderr and the advice to make
  pseudo-DDA spectra first (DIAspeXtract, or diaTracer for Bruker .d). DDA,
  PRM and pseudo-DDA input are tagged as before. `-acquisition_check warn`
  tags raw DIA as 1.11 did, with a warning; `off` skips the check.
  `-acquisition_probe_spectra` (4000) sets how many MS2 the check reads.
  The rule was tuned once on 183 public data sets (one change: the
  periodicity threshold is 0.2, so converted raw diaPASEF, which writes the
  windows of a frame in a varying order, is refused too).

### Changed output when an existing option is given

- **`-label_out` gains a `label_call` section (#3a)**: five rows appended
  after the 1.11 rows, which stay a byte prefix. They give the label call
  prose-auto 0.1.10 makes from the counts (TMT, TMTpro, iTRAQ4, SILAC,
  label-free or no call).

### New opt-in options

- **Precursor charge and isotope hypotheses (#6, experimental):**
  `-unknown_charge assume2|enumerate|infer` (default assume2, as 1.11),
  `-charge_min` (2), `-charge_max` (4), `-charge_infer_margin` (2),
  `-isotope_error` (0). A charge in the file header is never replaced.
- **Complement rules (#2):** `-complement_rule same_charge|precursor|both`
  (default same_charge), `-complement_tolerance` (0.02),
  `-complement_tolerance_unit Da|fragment` (Da), `-complement_tol_factor`
  (0.5), `-complement_midp` (off).
- **Profile centroiding (#9):** `-pick_profile legacy|auto|off` (default
  legacy: mzPeak only, as 1.11), `-pick_unknown_type` (off).
- **c/z-dot ion series (#15, experimental):** `-ion_series by|cz|auto`
  (default by).
- **Census (#11):** `-census`, `-census_out`, `-census_summary_out`, and the
  identifications join `-census_ids` (idXML or mzid with q-values),
  `-census_ids_fdr` (0.01), `-census_triage_evalue` (0.01).
- **Calibrated species call (#1, experimental):** `-species_call none|decoy`
  (default none), `-species_call_params`, `-species_call_min_units` (200),
  `-species_call_decoys` (5), `-species_pi0` (1).
- **Species lookup in both orientations (#10, experimental):**
  `-species_orientation forward|both` (default forward). Under `both` the
  analytic `log_pvalue` and `qvalue` columns are NA; only the decoy columns of
  `-species_call decoy` are calibrated.
- **Chemistry v2 and the alkylation call (#3c-#3g, experimental):**
  `-digest_models_version shipped|v2`, `-digest_detection none|shipped`,
  `-digest_flank2 off|auto`, `-digest_min_confidence` (0, off),
  `-digest_calibration`; `-alkylation_out`, `-alkylation_proteome` (auto),
  `-alkylation_min_spectra` (10), `-alkylation_min_share` (0.6),
  `-alkylation_window` (0). At their defaults `-digest_out` is the 1.11 report.
  In 1.12.0 `-alkylation_out` needs `-recon_fasta` or a FASTA path in
  `-alkylation_proteome`: the shipped proteomes that `auto` (= human),
  `human`, `mouse`, `yeast` and `ecoli` name are not in this release, so the
  default `auto` and the names stop with exit code 6 (illegal parameters).
- **Protein shortlist and search hand-off (#5, experimental):**
  `-shortlist_out`, `-fasta_out`, `-shortlist_background`,
  `-shortlist_min_spectra` (2), `-shortlist_max_evalue` (0.1),
  `-shortlist_top` (0), `-shortlist_parsimony none|subset|greedy`,
  `-shortlist_gapped`, `-shortlist_decoy_affix`, `-shortlist_force`;
  `-search_config_out`, `-search_engine sage|comet`, `-search_config_template`,
  `-search_decoy_prefix`, `-search_precursor_tolerance` (10),
  `-search_precursor_unit` (ppm), `-search_isotope_errors` (0).
  NOT FDR-controlled. **The Sage and Comet configurations are only
  smoke-tested in 1.12.0:** `search_engine_smoke_test` ran Sage 0.14.7 and
  Comet 2026.03.0 on the configuration FASTag writes for the 139-spectrum
  E. coli fixture (both read it and report prsA/metK/rplF peptides), but no
  engine acceptance on real data has been run (registry A5-02), so the Comet
  key layout, the isotope_error mapping and the variable_mod slot format are
  still taken from the OpenMS adapters, not validated against the engines.
- **Mass shifts as search-engine configuration (#17, experimental):**
  `-search_shifts none|variable|offsets|both` (default none),
  `-search_shifts_out`, `-shift_max_variable` (3), `-shift_max_offsets` (10),
  `-shift_expand_sites` (off), `-shift_site_min_share` (0.2),
  `-shift_site_min_count` (10), `-shift_site_min_ions` (2). They add the
  run's mass-gap peaks (the `-massgap_out` peaks) to `-search_config_out` as
  variable modifications or Comet mass offsets; `-delta_out` and
  `-massgap_out` are unchanged with and without them. NOT FDR-controlled:
  candidates for an FDR-controlling engine, not identifications; that they
  improve identifications is not validated, and like the #5 hand-off the
  engine configurations are not validated against the engines on real data.
- **Machine interfaces for the desktop GUI:** `-probe_input <file>` (metadata
  as JSON lines) and `-dump_spectrum <nativeId>` (the peaks FASTag tags in one
  spectrum, as JSON lines). Both write no file and exit.

In the desktop GUI 1.12.0 the new options are not in the form yet; a GUI run
uses their defaults.
