# Changelog

## 1.12.2 (2026-11-10)

Faster mzML reading and acquisition check; no output changes. Defaults,
options and the frozen acquisition-check thresholds are unchanged.

- **Faster mzML reading.** 1.12.0 parsed every 1.12 metadata field of
  every spectrum (type, filter string, activation, possible charges, the
  isolation-target meta value), 4-6 µs per spectrum (+12% read time)
  where the tagging loop needs only some of them. A read now fills only the
  fields its caller uses, and the searches inside a spectrum stop at the
  end of the element they look in. Read time is back to 1.11.0's
  (single core: 44.9 µs per spectrum against 46.0-46.8 for 1.11.0 and 52.0
  for 1.12.0 on PXD003531; 39.9 against 39.6-40.2 and 43.9 on PXD047793).
- **Faster acquisition check.** On mzML the probe reads its spectra in
  parallel over `-threads`, one reader per thread, and parses only the
  fields the check uses. It reads the same spectra in the same order and
  stops at the same one, so the call, the `Acquisition check:` line and
  `-probe_input` are unchanged.
- Measured on ibminode05 (AMD EPYC 7763, idle), matched settings, median
  of 5 interleaved runs, wall against 1.11.0: PXD003531 at 1 thread +2.1%
  (1.12.0: +7.8%), at 32 threads +0.0% (1.12.0: +31%), PXD047793 at 32
  threads +1.4% (1.12.0: +4.5%). Tags equal 1.12.0's and 1.11.0's in every
  run.
- **#15 `-ion_series auto`: INCONCLUSIVE.** Scored once on held-out Orbitrap
  ETD runs (PXD024621, PXD009208) against MSFragger 4.4.1 c/z• identifications
  at 1% FDR: on ETD spectra correct rank-1 tags rise from 0.9% under `by` to
  82.2% (+81.4 points, 95% interval 79.5-83.2; 5,313 peptide clusters), and
  collisional spectra are byte-identical. The non-inferiority cells for 3+ and
  4+ collisional spectra are empty (every HCD spectrum of PXD024621 is 2+), so
  the default stays `by`. The README now recommends `auto` or `cz` for ETD/ECD
  data. The ion-trap sets of the first preregistration were replaced by
  Orbitrap sets before any run.

## 1.12.1 (2026-11-08)

Documentation and packaging only: no code, default or output changes. The README now
gives the held-out acceptance results of the 1.12 options (Validation,
"Held-out acceptance of the 1.12 options"). Each item was preregistered
and run on held-out public data; #2, #4 and #9 were scored once. #6 was
scored twice: once on item06-H1-r2 (INCONCLUSIVE, PXD001473 without truth),
then, by a user decision recorded before the run, once more on the unused
high-resolution runs of the reserve sets item06-H2/H2r (PXD020394,
PXD055983) (FAIL). No configuration was
tuned on held-out data.

- **#4 tags on unidentified spectra: PASS.** On 9 ProteomeTools pools the
  rank-1 tag of a spectrum the database search does not identify is correct
  27.0 points above decoy chance (95% CI 23.7-30.7, margin 5). Not shown:
  that the precision on identified spectra transfers to unidentified ones
  (0.28 against 0.55 at E <= 0.01). `-diversity`: no benefit claimed.
- **#9 `-pick_profile auto`: FAIL.** The default stays `legacy`, and `auto`
  is not recommended. Ion trap (PXD009049): two charge-3 cells fail
  non-inferiority, the 4+ cells are underpowered, and `auto` tags fewer
  spectra at tag length 4 and 5. Orbitrap (two runs, PXD016519 Q Exactive
  Plus and PXD018024 Q Exactive HF; no Astral or TOF run was scored): all 9
  cells gain +10.5 to +32.0 points rank-1 correct, but on PXD016519 `auto`
  tags 567 fewer spectra at tag length 3 (15,987 against 16,554).
- **#6 `-unknown_charge infer`: INCONCLUSIVE, then FAIL.** The first
  scoring, on item06-H1-r2, was INCONCLUSIVE because PXD001473 has no truth.
  The second, on the unused high-resolution runs of the reserve sets
  item06-H2/H2r (PXD020394 Q Exactive Plus, PXD055983 Orbitrap Astral), FAILED: charge-call accuracy 0.745
  against 0.90, and non-inferiority fails in 3 of 18 cells, all 2+. Gains on
  3+, losses on 2+. The default stays `assume2`.
- **#2 `-complement_rule both`: INCONCLUSIVE** by rule 5: the truth of one
  Astral run (PXD074582) has 0 PSMs at 1% FDR. On the other runs endpoints
  (i)-(iii) fail descriptively. The default stays `same_charge`.
- **Not validated:** every other 1.12 option (#1/#10, #3, #5, #7 release
  test, #11, #15, #17) stays experimental. Low-resolution (ion-trap) MS2 is
  not validated for any 1.12 option.
- **Release packaging:** 1.12.0 shipped without the macOS downloads
  (notarization could not be validated). 1.12.1 ships them again: the release
  build retries Apple's validation service, and the release check of the
  GUI against the CLI follows the 1.12 GUI.

## 1.12.0

All defaults are those of FASTag 1.11, with one exception (#7 below). At the
defaults every output is the same as FASTag 1.11.0 byte for byte, with one
exception: a `-label_out` report gains five appended `label_call` rows, its
1.11 rows staying a byte prefix (#3a below; approved 2026-11-07). Every new
option is opt-in. No new option is validated on held-out data in 1.12.0:
the held-out acceptance runs of the 1.12 items have not been scored, so every
new option is experimental. The README's command-line reference describes
each option.

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
  windows of a frame in a varying order, is refused too). Its held-out
  release test (a fresh PRIDE sample, registry E7-03) has not been run: the
  SCIEX SWATH files of that sample still need converting on Windows.

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
- **Complement rules (#2, experimental):**
  `-complement_rule same_charge|precursor|both` (default same_charge),
  `-complement_tolerance` (0.02), `-complement_tolerance_unit Da|fragment`
  (Da), `-complement_tol_factor` (0.5), `-complement_midp` (off).
- **Profile centroiding (#9, experimental):** `-pick_profile legacy|auto|off`
  (default legacy: mzPeak only, as 1.11), `-pick_unknown_type` (off).
- **c/z-dot ion series (#15, experimental):** `-ion_series by|cz|auto`
  (default by).
- **Census (#11, experimental):** `-census`, `-census_out`,
  `-census_summary_out`, and the identifications join `-census_ids` (idXML
  or mzid with q-values), `-census_ids_fdr` (0.01), `-census_triage_evalue`
  (0.01).
- **Species call (decoy, #1, experimental):** `-species_call none|decoy`
  (default none), `-species_call_params`, `-species_call_min_units` (200),
  `-species_call_decoys` (5), `-species_pi0` (1). The shipped parameter table
  (`data/taxonomy/species_call.tsv`) is provisional, not fitted, and the
  development check of the decoy null failed on real runs (the decoy
  replicate counts are not Poisson around the modelled rate; KS p 6.7e-41
  over 1760 genus rows of 36 public FTMS runs), so `call`, `decoy_qvalue`
  and `lod` are not calibrated.
- **Species lookup in both orientations (#10, experimental):**
  `-species_orientation forward|both` (default forward). Under `both` the
  analytic `log_pvalue` and `qvalue` columns are NA; only the decoy columns of
  `-species_call decoy` (`decoy_qvalue`, `call`) carry a q-value, and they are
  not calibrated (see #1).
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

### Desktop app

The desktop app in 1.12.0 is the rebuilt GUI (pull requests #16-#31). The
command-line options above other than `-acquisition_check` are not in its
form yet: a GUI run uses their defaults. `-acquisition_check` is in the form
(Raw DIA check, under Spectra), so a raw DIA file can still be tagged from
the app with warn or off.

- **Runs (P1):** one event channel per run with phases and time left; a run
  never outlives the app (watchdog on macOS and Linux, parent-death signal on
  Linux, a kill-on-close job on Windows), and what a killed, cancelled or
  failed run left behind is offered for removal at the next start.
- **Linux desktop app (P1d):** a `.deb`, a tarball and a best-effort
  AppImage for Linux x64 (Ubuntu 22.04 / Debian 12 or newer, WebKitGTK 4.1).
- **New shell (P2):** a top bar with four views (Setup, Results, Batch,
  History) and a Help side panel with search; Setup starts from a task with
  step cards, presets stored as differences and Export INI; History keeps
  every run's exact command line, its settings and a Re-run.
- **Checks before a run (P2b):** the app reads the input's metadata through
  `-probe_input` and checks the settings against it, holds Run while it
  checks, and explains the exit-11 raw-DIA refusal with the DIAspeXtract
  command to copy. The Overview shows the CLI's calls; the Batch view has a
  summary table, majority flags, a summary TSV and folder input.
- **Tags browser (P3):** typed columns, cached orders, filters, an export
  job, Stitch/ALPS export, keyboard navigation, copy row and USI.
- **Viewers (P4):** a Spectrum tab (the tagged peaks through
  `-dump_spectrum`, with the tag's b or y ladder), Mass gaps & recon and Glyco
  tabs, and the SDRF comparison in the Batch view (organism by NCBI taxid,
  corrections TSV). The species report is parsed in the app; a `qvalue` of NA
  (`-species_orientation both`) is shown as uncalibrated, not as q = 1.

## 1.11.1

A desktop-app release: the command-line tool's behaviour and outputs are
those of 1.11.0.

- New logo and app icon (#11).
- GUI safety fixes (#13): at most 200 table rows in the DOM, a close guard
  while a run is busy, per-job batch logs, cleanup of partial outputs on
  cancel, last-used settings offered instead of applied silently.
- Smaller macOS download (#12): the disk image is LZMA-compressed (517 to
  295 MB); built on the macos-15 runner.
- Quick wins (#14): tags files open in file order at once and switch to
  E-value order when ranking finishes; parameter search (Cmd/Ctrl+K or /);
  instrument presets; File, Run and Help menus; Show in Finder for a run's
  outputs.
