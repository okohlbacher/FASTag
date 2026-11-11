# Changelog

## Unreleased (after 1.13.1)

- **`-search_engine msfragger`: three more export values follow MSFragger's
  own closed-search defaults.** 2 missed cleavages (new
  `-search_missed_cleavages`, default -1 = by engine; with
  `-shortlist_protease` other than trypsin the value stays
  `-recon_missed_cleavages`), a 20 ppm precursor window
  (`-search_precursor_tolerance` defaults to -1 = by engine) and variable
  protein N-terminal acetylation (new `-search_nterm_acetyl`, default
  `engine`). The Sage and Comet exports are byte-identical to 1.13.1. On
  nine development runs (two development runs and the seven runs of the
  spent held-out set of 1.13) the share of the full search's identified
  spectra that the shortlist search keeps rose from 0.723 to 0.831 on
  average (lowest run 0.563 to 0.678), largest per-run entrapment FDP 2.39%
  to 1.63%. With the shortlist widened by the existing options
  `-shortlist_gapped -recon_min_length 6 -shortlist_max_evalue 10
  -recon_missed_cleavages 2` it is 0.935 on average, 0.888 in the lowest
  run, entrapment FDP at most 1.43% per run. **Second held-out
  test, PASS** (10 runs from 10 new PRIDE projects, PREREG-msfragger2.md on
  `post1131/msfragger-heldout2`, scored once on 2026-11-11, criteria of the
  first test; export defaults with this recipe, used unedited): MSFragger
  ran in 10 of 10 runs; in the 9 evaluable runs the kept share is 0.833 to
  0.976 (median 0.934; criterion at least 0.80 in every run), the search
  1.64 to 4.72 times as fast (median 2.05), entrapment FDP 1.07% pooled
  (limit 1.5%) and at most 1.88% per run (limit 2.0%; one more entrapment
  hit in that run would exceed it). One run had too few identifications to
  evaluate (10 in the full search). The test covers recipe and export
  defaults together. With the default shortlist (informational) the kept
  share is 0.526 to 0.946, below 0.80 in 5 of 9 runs. The shortlist options
  are not defaults; the first held-out FAIL (1.13 export, default
  shortlist) stands.
- `-shortlist_protease` other than trypsin: the shortlist's protease check
  calls Asp-N from 21 % D at the N-terminal tag ends (was 50 %; tag ends of
  Asp-N digests show 33-78 % D, other digests at most 10 %). On the 176
  development runs with a known protease, three Asp-N runs change from
  `unspecific` to Asp-N and no other call changes. No held-out test: the
  held-out result of `auto` (1.13.1) describes the old rule. On the three
  runs the exported Sage search is about twice as fast as the full search
  (the unspecific export was 1.2 to 7 times slower), and the shortlist keeps
  fewer of the full search's proteins (0.18, 0.19, 0.57 against 0.25, 0.34,
  0.66); `-shortlist_specificity semi` keeps 0.25, 0.29, 0.64 at about the
  time of the full search. `-digest_out` and the default trypsin check are
  unchanged.
- `-shortlist_protease auto`: an Asp-N call is placed and exported
  semi-specific (Sage `semi_enzymatic`, Comet and MSFragger
  `num_enzyme_termini = 1`) unless `-shortlist_specificity` is given on the
  command line (or is `semi` or `none` in an INI); the placement line of the
  log and of the shortlist header says so. `-shortlist_protease asp-n` and
  every other call of `auto` keep `full`. Development runs only, no held-out
  test. On the three development runs now called Asp-N (PXD064794,
  PXD068586, PXD051338; Sage 0.14.7, 8 threads), share of the full search's
  proteins kept / Sage wall time / peak RSS: unspecific export (1.13.1)
  0.25, 0.34, 0.66 / 162, 181, 7 s / 17.9, 20.8, 0.8 GB; Asp-N full 0.18,
  0.19, 0.57 / 13, 12, 6 s / 0.3, 0.3, 0.1 GB; Asp-N semi (now the export)
  0.25, 0.29, 0.64 / 27, 26, 5 s / 1.7, 1.7, 0.2 GB; the full search with
  Asp-N takes 25, 25, 6 s and 2.0, 1.8, 0.4 GB.
- `-shortlist_protease auto`: a WARN states when the tag ends call
  `unspecific` that the exported search is unspecific and can take longer
  than a full search. No run-time guard: no peptide-length cap made the
  unspecific export as fast as the full search without losing identifications.
- **`-search_shifts`: gain against an isotope-matched base, entrapment FDP
  over 10 databases.** Development runs only (the spent held-out runs and two
  earlier development runs); the two held-out FAIL results stand and no new
  held-out test was run. Against a base search with the same isotope error
  setting the option gives +0.2 to +80.3 % PSMs with Comet and 0.0 to
  +64.7 % with Sage at 1 % FDR (means over 3 to 10 entrapment databases,
  1 for PXD014764) (ten runs: PXD003531, PXD049248, PXD063151,
  PXD014764, PXD065251, PXD004541 fr02 and fr09, PXD037999, PXD000001,
  PXD073763; at least +2 % on eight of ten with each engine). The isotope
  error setting alone gives +1.3 to +54 % (Comet). Entrapment FDP at 1 % FDR,
  mean of 10 entrapment databases: PXD037999 Comet 1.09 % (base) and 1.21 %
  (option), Sage 1.21 and 1.05 %; PXD003531 Comet 0.93 % (base), 1.21 %
  (base with isotope errors 0..2), 1.19 % (option), Sage 0.95, 1.11, 1.04 %.
  The 0.88 -> 1.28 % of the second held-out test was a single entrapment
  database; the standard deviation between databases is 0.1 to 0.3 points.
  The Comet export stays as it is. README and the option help say so.

## 1.13.1 (2026-11-10)

No change to the program. Five test scripts compare and pass the Windows
form of the temporary directory under MSYS; they failed on Windows in
1.13.0, so that release has no Windows packages. Two statements in README
and CHANGELOG are corrected: the label-discovery rules of report formats 2
to 4 have a held-out test (FAIL, 3 of 9 criteria), and for organisms
outside the index `-species_call explain` calls the closest indexed genus
in 6 of 13 runs, not "the nearest indexed relative in 10 of 13".

## 1.13.0 (2026-11-10)

Experimental options from the 1.13 backlog, each with its held-out result
stated; all are off by default. Two defaults change: the raw-DIA check
refuses two more window schemes (revised rule, held-out test passed), and
`-search_isotope_errors` defaults to -1 (by engine), which changes only the
MSFragger export. Passed their held-out tests: `-ion_series_hybrid both`,
`-shortlist_protease auto`, the revised `-check_header_charge` rule, the
census triage evaluation and `-alkylation_tags_out`. Failed or inconclusive,
kept as experimental with the result documented: `-label_discovery_out`,
`-label_call_min_tags 0`, a/x ion series, `-search_engine msfragger`,
`-search_shifts`, `-species_call explain`, `-complement_tolerance_unit auto`.

- **`-label_discovery_out`, report formats 2 to 4: third held-out test, FAIL.**
  No code change. On 163 runs from 163 new PRIDE projects
  (`acc113r/labeldisc3`, PREREG-labeldisc3.md, scored once) three of nine
  criteria fail: weighted accuracy 0.572 (criterion above 0.80), 119 runs
  right by label family against 149 for Param-Medic, TMTpro recall 11/18.
  No label-free run got a label call (0 of 64); TMT, iTRAQ, SILAC and
  dimethyl recall pass. Both causes are ion-trap MS2: no call is made there,
  and TMTpro runs acquired as SPS-MS3 are called TMT. With Orbitrap MS2,
  95 of 96 runs are right. The option stays experimental.
- **`-complement_tolerance_unit auto` (backlog #15): second held-out
  result, INCONCLUSIVE, no criterion failed.** No code change besides the
  help text. With the revised estimator on 8 new runs (`acc113r/compltol`,
  PREREG-compltol-heldout2.md, freeze cb84295, results 56f604d):
  non-inferiority passes in 44 of 54 cells, fails in none and is
  uninformative in 10 (all ion trap); the ion-trap gain is +1.07 points
  (95% interval 0.87-1.27, PASS); timsTOF was not tested; the run time
  ratio is 1.010 (PASS). On all five high-resolution files `auto` equals
  the default. The option stays experimental and the default stays `Da`
  (doc/COMPLEMENT-TOLERANCE.md).
- **`-shortlist_protease auto` (backlog #20): held-out result, PASS.** No
  code change besides the help text. On 9 runs from 6 PRIDE projects with 5
  proteases (`acc113r/nontryptic`, PREREG-nontryptic.md, freeze 07bd705,
  results 5dd9d9c, scored once) the shortlist keeps a median of 0.25 of the
  proteins the full-proteome search with the true protease identifies
  (criterion 0.20), 0.116 more than the trypsin shortlist (95% CI +0.035
  to +0.190); the protease is called right in 7 of 9 runs; no run aborts.
  The gain comes from Asp-N, Glu-C and chymotrypsin; Arg-C and Lys-C are
  about equal; recall is 0.06-0.10 on three runs; on the one run called
  `unspecific` the export makes Sage slower than the full search. A named
  rule, `unspecific` and `-shortlist_specificity semi`/`none` have no
  held-out test. The option stays experimental (doc/SHORTLIST.md).
- **Raw-DIA check (#7): two more window schemes are refused.** (1) Tiling
  isolation windows the run keeps returning to without one cycle (at least
  10 visits per window, at least 99% of the second half of the probed MS2 on
  an m/z of the first half), as a method that repeats blocks of windows
  writes them; the 1.12 rule needed one cycle through all windows. (2) A
  periodic or returning tiling scheme whose MS2 all carry the same charge
  (at least 99%), a method default; 1.12 tagged these with a "DIA-like"
  warning, which now remains for tiling schemes with mixed charges only.
  Exit code 11, the `FASTAG_REFUSED` line and the calls for DDA, PRM,
  pseudo-DDA and uncharged periodic DIA are unchanged. On the spent E7-03
  sample (now a development set) 4 of 249 calls change: 3 missed Orbitrap
  DIA files are refused, and so is one file drawn as Tribrid DDA that is a
  150 x 4 Th scheme with charge 2+ on every MS2. On the 224 E7-02
  development files 3 known default-charge DIA runs go from warned to
  refused; nothing else changes.
  Held-out test (preregistered, `acc113r/acqcheck`, 98 fresh public Thermo
  files, truth from scan filters and isolation windows): **PASS**, 0 of 58
  non-DIA files refused, 35 of 37 DIA files refused (1.12 rule: 19 of 37).
  No Astral, timsTOF or SCIEX file in that sample.
- **`-ion_series_hybrid both` (backlog #10): held-out result, PASS.** No
  code change besides the help text. On 9 EThcD/ETciD runs from 5 PRIDE
  projects (`acc113r/hybrid`, PREREG-hybrid.md, scored once) the truth
  spectra with at least one correct tag rise by 43.2 points over
  `-ion_series auto` alone (95% interval 41.3-45.1; worst project +28.2),
  the precision of the reported tags by 14.3 points, at 1.60 times the CPU
  time. Three of the five projects are ADP-ribosylation samples from one
  laboratory. The option stays experimental and the default stays `by`
  (doc/HYBRID-IONS.md).
- **Label call minimum (backlog #8): `-label_call_min_tags`, experimental,
  default 175 (the 1.12 rule; no output change at the default).** At 0
  `label_call` makes no `no_call few_tags` below 175 C-terminal tag ends:
  every ppm run is called with the same isobaric and SILAC rules,
  label-free when none fires (the harness's prose-auto 0.1.3 rule), and a
  call from fewer than 175 ends says that label-free then means only that
  no label rule fired. On the 193 development runs (in-sample) 0 gave
  178/193 against 150/193 for the 1.12 rule and 159/193 for "always
  label-free". Its preregistered held-out test (acceptance/1.13
  PREREG-item08.md, 172 public runs) FAILED: 149/172 = 0.866 against the
  threshold 0.922 ("always label-free" + 0.05; always label-free is 0.872);
  the 1.12 rule gave 83/172. Per the preregistered decision rule the default
  stays 175 and 0 stays experimental. With zero tag ends the SILAC test is
  now skipped (no undefined heavy share); this is reachable only at a
  minimum of 0.
- **Explain-away species call: `-species_call explain`, experimental,
  opt-in.** Calls the taxa one at a time on their distinct tags in spectra
  that no taxon called before explains; the report has the columns of the
  `decoy` call plus `tags` and `unexplained_tags`. The default (`none`) and
  the `decoy` call are unchanged. Its preregistered held-out test
  (`acc113r/species`, PREREG-species-explain.md, 62 public runs) FAILED: the
  primary endpoint passes (0.50 false genus calls per run against 5.98 for
  the decoy call), the guard fails (recovery 38/105 against 77/105; Sus or
  Bos 3/68 against 41/68). Scope: selection of the sample organism among
  the 50 indexed genera (42 of 49 runs); a second organism or contaminant
  is not reported; for organisms outside the index the closest indexed
  genus is called in 6 of 13 runs (assigned post hoc, not a test result).
- **`-search_shifts` (backlog #17): isotope rule in the frame of a fixed
  terminal label, and the held-out result.** A mass-gap peak at a fixed
  terminal label (TMT) plus n x 1.00335 is now `skipped_isotope` and raises
  the engine's isotope errors; before, it became a Comet offset near
  n x 1.0034 and Sage did not search it. Output changes only under
  `-search_shifts` on runs with a fixed terminal label. Both preregistered
  held-out tests FAILED (acceptance/1.13 RESULT-item17.md; second test on
  four new runs, `acc113r/shifts` RESULT-item17r.md: Comet P2 and P4, Sage
  P4). In the second test PSMs at 1 % FDR rose on all four runs (Comet +7.7
  to +36.8 %, Sage +6.5 to +25.2 %), but Comet's entrapment FDP rose from
  0.88 to 1.28 % on the TMT run PXD037999, and 5 of 32 (Comet) and 3 of 11
  (Sage) admissible open-search peaks were recovered. Part of the gain is
  the isotope error setting (0..1 against 0 in the base search). The test
  did not measure the fix. The option stays experimental and does not
  replace an open search.
- **`-search_engine msfragger` (backlog #18): held-out result, FAIL; the
  exported `isotope_error` changes.** On 7 runs from 7 PRIDE projects
  (`acc113r/msfragger`, PREREG-msfragger.md, scored once; FASTag 1.12.2 at
  9365ff1, MSFragger 4.4.1) MSFragger ran on the unedited export in 7 of 7
  runs (C1 PASS) and was 2.03 to 3.91 times as fast as on the full human
  proteome (median 3.38, G1 PASS), but kept only 48.6 to 73.2% of the spectra
  the full search with MSFragger's defaults identified (median 61.3%;
  criterion 80% in every run, C2 FAIL), and the entrapment FDP was 1.27%
  pooled but 2.09% in one run (limit 2.0%, G2 FAIL). On two development runs
  the largest single cause was the exported `isotope_error 0`: with
  MSFragger's own `0/1/2/3` the kept share rose from 47.5 to 72.2%
  (PXD003531) and from 47.3 to 56.3% (PXD014764) at unchanged speed,
  entrapment FDP under 1%. `-search_isotope_errors` therefore has the new
  default -1 = by engine: `0/1/2/3` for MSFragger, none for Sage and Comet as
  before (their configurations are unchanged; an explicit 0 is kept). This
  default is set on development runs only and has no held-out test. The
  option stays experimental (doc/SHORTLIST.md, "MSFragger configuration").
- **MSFragger configuration (backlog #18): `-search_engine msfragger`,
  experimental; held-out test FAILED (entry above).** `-search_config_out` writes a complete
  `fragger.params` for MSFragger 4.4.1. MSFragger needs decoys in the
  database: with `-fasta_out` FASTag appends reversed `rev_` decoys, without
  it the input database must be a target-decoy database. `num_threads` is
  `-threads`. `-search_shifts offsets` exports mass offsets (negative ones
  included) on a ppm precursor window and is refused on a Da window, where
  MSFragger 4.4.1 exits 1 on them. Sage and Comet configurations are
  unchanged (doc/SHORTLIST.md, "MSFragger configuration").
- **`-alkylation_tags_out`: held-out test PASS at the margin.** On 57 runs
  from 57 PRIDE projects it called 40, 37 of them right (0.925, Wilson 95%
  interval 0.801-0.974). It abstains on samples that are not alkylated; the
  help text and the report's `alkt_run status` row now state the result.
- **Census triage evaluation: held-out test PASS (second test).**
  `tools/census_triage_eval.py` and doc/CENSUS-TRIAGE-EVAL.md; FASTag's
  output is unchanged. On 8 runs from 8 PRIDE projects (7 evaluable) a
  semi-enzymatic Sage search identified 10.9 % of the `-census_ids` triage
  candidates against 2.0 % of the other unidentified spectra (rate ratio
  5.32, 95 % CI 2.59-8.25; gain over the peak-count baseline +0.023).
  Against an open search the candidates are not better than the peak-count
  baseline. The first test FAILED and stays on record in the doc.
- **c/z• preprocessing: charge-reduced peaks re-filtered against the
  precursor cut (issue T25).** Peaks were cut at the precursor (neutral mass
  + proton + 1.5 Da) before deisotoping only, so a peak the deisotoper moved
  to the 1+ scale could land above the cut and be tagged. Under
  `-ion_series cz` (and `auto` on electron-activated spectra) such peaks are
  now dropped after deisotoping. c/z• output can change; b/y output
  (the default) is byte-identical to 1.12.
- **Shipped proteomes (backlog item 24).** The bundles (CMake install, the
  Linux, macOS and Windows release bundles and the Homebrew casks, which
  install the macOS image) carry the reviewed entries of the UniProt 2026_04
  reference proteomes of human, mouse, yeast and E. coli
  (`share/FASTag/alkylation`, about 17 MB, CC BY 4.0). `-alkylation_proteome
  auto|human|mouse|yeast|ecoli` now uses them instead of stopping with exit
  code 6. The alkylation report gains a `database_release` row for a shipped
  proteome; FASTag refuses a shipped file whose FASTA sha256 or entry count
  differs from its manifest (exit 3). The shipped proteomes need
  `-tag_length 8` (human, mouse) or 7 (yeast, E. coli): at the default no tag
  places, the log warns, and the report gives the reason `tags_too_short` and
  an `alk_run min_tag_length` row. Reports on `-recon_fasta`, `-fasta` or a
  FASTA path are unchanged. `tools/fetch_proteomes.sh` regenerates the files.
- **`-label_discovery_out` (experimental, opt-in; held-out test FAILED):**
  database-free label discovery. Reports every N-terminal, K, R or
  C-terminal mass offset the tag flanks carry, known or not, explained by
  residues, the known labels (TMT, TMTpro, iTRAQ4/8, dimethyl, SILAC Lys4/6/8
  and Arg6/10) or Unimod, with a label call (format 3,
  doc/LABEL-DISCOVERY-REPORT.md; design doc/DESIGN-label-discovery.md).
  Advanced options `-label_discovery_max_flank` (at most 1500 Da), `_depth`,
  `_min_spectra`, `_min_share`, `_window_n`, `_window_c` (at most 0.05 Da)
  and `_unimod_top`. Every other output is byte-identical with the option
  off or on (the `-out_spectra` provenance leaves the options out).
  Held-out, 190 public runs, scored once on 2026-11-10 (acceptance/1.13
  PREREG-labeldisc.md): P1 FAIL, 6 of 150 label-free runs got a label call
  (4.0 %; the criterion was 0); P2 FAIL, 96/190 runs right against 150/190
  for "always label-free"; P3 PASS, 96 against 91 for `-label_out`'s
  `label_call` (sign test p = 0.33). Do not rely on the call as free of
  false label calls.
  Added after that test, and not covered by it: the `ld_reporter` section
  counts TMT and iTRAQ reporter ions in the high-resolution MS2/MS3 scans.
  A clear reporter signal sets the label family, missing reporters remove
  an isobaric label call (`no_reporter_ions`), and a no call on a run with
  ion-trap MS2 scans is reported as `low_resolution_ms2`. Thresholds were
  set on the 99 development runs (86 right instead of 85).
  Format 3 adds the `ld_pair` section: precursor pairs at the Lys8 and
  Arg10 spacings call SILAC (`basis` `precursor_pairs`), also on runs with
  ion-trap MS2, and a run with few tags, no reporter ions and no pair
  signal is called label-free (`basis` `absence`). On the development runs
  93 right instead of 86. A sample labelled in one
  channel only is read as label-free by the absence rule.
  Format 4 changes one rule of `ld_pair` (no new row, column or
  threshold). A call of SILAC labels only gains `K:Lys8` and `R:Arg10`
  when the pairs show both and the call lacks them (`basis` with the suffix
  `+precursor_pairs`); a call with any other label is not changed. It was
  set on the development runs: six SILAC calls change
  (three to the labels their submitters state, e.g. PXD066890 `K:Lys8` to
  `K:Lys8+R:Arg10`; three triple SILAC runs gain the missing heavy labels);
  the class of no run changes (96 of 96 audited runs right). Under the
  reporter gate `unclear` no absence call is made.
  Formats 2 to 4 FAILED their held-out test (`acc113r/labeldisc3`, 163
  runs, 3 of 9 criteria; see README, Validation).

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
- **#7 raw-DIA check, release test E7-03: FAIL** (scored once on a fresh PRIDE
  sample; the default stays `-acquisition_check refuse`). diaPASEF and Astral DIA
  were refused 12/12 each, Orbitrap DIA 7/12 and SWATH 10/12 (< 90%); 8 of 202
  must-pass files were refused (upper 95% bound 7.0%), all from Astral projects
  labelled DDA; pseudo-DDA passed 37/37. A post-hoc reading that some of these are
  label errors is a hypothesis, not a re-score (doc/ACQUISITION-RELEASE-TEST.md).
  Override a wrong refusal with `-acquisition_check warn` or `off`.

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
