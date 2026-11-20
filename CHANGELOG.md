# Changelog

## 1.15.4 (2026-11-20)

Shortlist runs now use the tested shortlist recipe by default (`-shortlist_defaults plain` restores 1.15.3), and metaproteomes get a held-out-tested recommendation (`-shortlist_max_evalue 100`). Runs without a shortlist output are unchanged.

- **The shortlist recipe is the default of every tryptic shortlist run.**
  With `-shortlist_out`, `-fasta_out` or `-search_config_out` and
  `-shortlist_protease trypsin` (the default), every option the user does not
  give takes the value of doc/SHORTLIST.md's recipe: `-tag_length 4
  -extension 6 -shortlist_gapped -shortlist_max_evalue 10
  -shortlist_min_spectra 1 -recon_min_length 6 -recon_missed_cleavages 2`.
  Before, only `-search_engine msfragger` took four of these. At the tagging
  defaults (`-tag_length 3`, no extension) no tag reaches the reconciliation
  length a real database derives (8 for 94k proteins, 9 for 870k), so
  `-fasta_out` on a metaproteome database came out empty (exit 13). The log
  line `Shortlist recipe defaults (...)` and the shortlist header name the
  values applied; an option given on the command line or in an INI wins.
  `-shortlist_defaults plain` restores the 1.15.3 defaults.
- **Metaproteomes: `-shortlist_max_evalue 100`** with the recipe default. Held-out test on
  PXD045390 (28 runs, three matrices): 96 % of the full-search peptides kept (lower 95 % bound 0.954),
  every spiked organism >= 0.94, with 23 % of an 870k-protein database. The reduced search's FDR is
  optimistic (more entrapment hits); see doc/SHORTLIST.md.
  Runs without a shortlist output are unchanged. The recipe passed the
  second MSFragger held-out test and failed the third, so it is a working
  default, not a validated claim.

## 1.15.3 (2026-11-19)

Reads SCIEX MS Data Converter mzML (before: every spectrum read as MS1), adds instrument model, serial number and start time to the run QC report, and lets `-census_ids` take identification files without q-values (`-census_ids_accept`). Default tag output on files that do not use mzML parameter groups is unchanged from 1.15.2.

- **SCIEX MS Data Converter mzML is read (bug fix).** The mzML reader now
  resolves `referenceableParamGroupRef`s for the MS level, retention time,
  scan windows, ion mobility, isolation window and selected ion (m/z, charge,
  intensity), as OpenMS's `MzMLFile` does; an element's own cvParam still
  wins. SCIEX MS Data Converter keeps the MS level only in such groups, so
  before every spectrum of its mzML read as MS1: 0 MS2, empty outputs, exit
  code 0. Files that state these fields in the elements themselves read as
  before (tags byte-identical on the gate runs). On the 48 PXD079630 runs the
  MS2 count now equals an independent count, and the tags equal those of the
  OpenMS FileConverter rewrite of each run.
- **No silent success without MS2.** A run with spectra of which some are MS2
  or carry a precursor, but none can be tagged, now ends with exit code 13
  (UNEXPECTED_RESULT) and an error after its (empty) outputs are written. An
  MS1-only run (no MS2 level, no precursor) warns and exits with 0.
- **Index offsets in whitespace.** An mzML index whose offsets point into the
  whitespace just before each `<spectrum` by varying amounts (SCIEX MS Data
  Converter: 10 bytes for the first spectrum, 9 for the others, CRLF) is used
  as written instead of being rescanned with the "no index, or one that no
  longer matches" warning. An offset that points past a tag's start is still
  refused.
- **`-census_ids_accept <qvalue|threshold|all>`** (default `qvalue`, output
  unchanged): identification files without q-values can mark spectra
  identified by the file's own threshold (mzid `passThreshold`, read through
  OpenMS as the hit meta value `pass_threshold`) or by any target hit, e.g. a
  Mascot mzid without decoys. No FDR is estimated; the summary row
  `ids_accept` names the rule. Decoys are ignored; `-census_ids_exact` still
  refuses hits without a target/decoy annotation.
- **`-census_ids` references from spectrum titles.** When an identification's
  reference is empty or `index=<n>` (a search on an MGF) and its spectrum
  title holds `NativeID:"<id>"` (msconvert, Mascot), the native id is used;
  counted in the summary row `id_ref_title`. Such files matched no spectrum
  before.
- **Run QC report (`-qc_out`): instrument and acquisition rows.** Three new
  rows after `qc_version`: `instrument_model`, `instrument_serial_number` and
  `start_timestamp`, read from the input's run metadata through OpenMS
  (mzML header, Thermo `.raw`, Bruker `.d`, mzPeak); `n/a` with the reason
  when the input does not state a field (MGF states none). Requested for
  large-scale QC across runs. `qc_version` is now 2. The tag output is
  unchanged.

## 1.15.2 (2026-11-19)

Four experimental, opt-in features: vendor input (Thermo `.raw`, Bruker
timsTOF `.d`), the mass-shift survey's site, name and evidence columns, a run
QC report (`-qc_out`) and a census identifiability score (`-census_score`).
With default options the tag output is unchanged from 1.15.1 (byte-identical
on the E. coli example and on a PXD045734 development run). `-recon_out`'s
`delta_interp` changes (the ppm fix and the substitution tolerance below), and
so do `-delta_out`'s rows (`-delta_group`).

What was and was not validated:

- **Mass-shift survey: the held-out test FAILED.** The preregistered blind
  test on 171 held-out PXD045734 runs (`acceptance/1.16/RESULT-dha.md`,
  shipped with this release) failed criterion G1 (shift precision against an
  MSFragger open search, lower 95 % bound >= 0.80) for two of eight common
  shifts, both cysteine reference-state shifts: Methyl@C -43.006 (0.737,
  LB 0.725) and unalkylated Cys -57.021 (0.763, LB 0.743). The other six
  shifts and G2, G3, G6 and G7 passed; the G4/G5 hand-check is pending and
  cannot change the verdict. The survey's rows are candidates, not
  identifications; read the two Cys shifts with particular caution.
- **Identifiability score: development only.** `-census_score` was fitted
  and assessed on PXD000561 development samples (doc/CENSUS-IDENT.md); its
  held-out test has not been run, and census triage stays the recommended
  list.
- **Vendor input parity.** Thermo `.raw`: on three development runs every
  spectrum and every FASTag output equals the ThermoRawFileParser 2.0
  `-f=2 -x` conversion (tag Jaccard 1.000000); a default TRFP conversion
  keeps reference and exception peaks the OpenMS reader drops (tag Jaccard
  0.86-0.98). Bruker `.d` (PXD040281 SA_02): tags byte-identical to OpenMS
  FileConverter's mzML of the same run; against an independent decoder
  (mzdata) the precursors, m/z, charges and signal agree exactly but the tags
  do not (Jaccard 0.12-0.27), because the two centroid differently.

- **Bruker timsTOF input (`-in run.d`, `-in run.d.zip`):** DDA-PASEF runs are
  read directly through OpenMS's `BrukerTimsFile` (opentims; no Bruker SDK) in
  a build against an OpenMS with `WITH_OPENTIMS=ON` (BUILDING.md); other builds
  refuse `.d` with a message. One centroided MS2 spectrum per precursor, MS1
  frames not decoded; a `.d.zip` is unpacked into `OPENMS_TMPDIR` for the read
  (refused up front when less than 1.5x the archive is free there). Frame and
  precursor counts come from `analysis.tdf` by SQL before anything is decoded,
  and dia-PASEF is refused from them (exit 11, `FASTAG_REFUSED reason=raw_dia`).
  Precursors without a charge keep charge 0 (unknown) and are tagged per
  `-unknown_charge`, with their charge source reported. `-probe_input` and
  `-dump_spectrum` do not read `.d` yet. New ctest `bruker_cli_test` on a
  trimmed PXD040281 run (`test/fixtures/bruker/`). The input-type error now
  reads "is neither .mzML, .mzpeak, .mgf, a Thermo .raw nor a Bruker timsTOF .d
  directory or .d.zip archive". Tag output for mzML, mzPeak and MGF is unchanged.
- **Thermo `.raw` input** in a build against an OpenMS with
  `WITH_THERMO_RAW=ON` (needs a .NET 8 runtime; BUILDING.md): read through
  OpenMS's `OnDiscThermoRawExperiment`, random access with one handle per
  tagging thread, Thermo's vendor centroiding set explicitly (the reader's
  default is profile; `src/ThermoInput.h` keeps a profile path and the
  instrument-stated resolving power for the run QC). Native IDs, USIs and
  `-census_ids` joins match ThermoRawFileParser's mzML. On three development
  runs every spectrum and every output equals the ThermoRawFileParser 2.0
  `-f=2 -x` conversion; a default conversion differs by the reference and
  exception peaks it keeps (tag Jaccard 0.86–0.98). Builds without Thermo
  support refuse `.raw` with a message; `-probe_input`/`-dump_spectrum`
  refuse it for now. RawFileReader's required notice is printed by the new
  `--version` and in `--help`, and added to bundle notices. ctest
  `thermo_cli_test` (data part with `FASTAG_THERMO_RAW`) and `thermo_parity`.
- **Release bundles read `.raw` and `.d`.** OpenMS is built with
  `WITH_OPENTIMS=ON` and `WITH_THERMO_RAW=ON` on every platform. Every bundle
  reads Bruker `.d`; every bundle except the Linux AppImage also carries
  Thermo's RawFileReader and a .NET 8 runtime (8.0.34, MIT, `dotnet/` beside
  the executable, used unless `DOTNET_ROOT` names another), so `.raw` works
  without installing anything. The AppImage ships without RawFileReader
  (licence section 4.3; BOM.md, Vendor readers). RawFileReader is under
  Thermo's own licence, not MIT: every bundle has it in `LICENSES/` and the
  terms in `THIRD-PARTY-NOTICES.txt`; the Windows installer shows a licence
  page and the macOS disk images a licence agreement before they open; the
  desktop app's About shows Thermo's notice. README, Install, states the
  terms (no redistribution of the RawFileReader assemblies).
- **Census identifiability score (`-census_score`, experimental):**
  four census columns taken before any database filter (`pre_best_evalue`,
  `pre_best_len`, `pre_best_mean_conf`, `pre_tag_cover`) and `ident_score`, a
  frozen logistic model on per-run mid-ranks of twelve census features that
  orders every MS2 spectrum (every status) by how likely a standard database
  search identifies it; `-census_sorted_out` writes the census in that order.
  Fitted on PXD000561 development samples only; not validated on held-out
  data (see doc/CENSUS-IDENT.md for the development result and its verdict
  against census triage). Without `-census_score` the census is unchanged.
- **`-census_ids_exact`:** a one-to-one ids join for label joins (exact native
  ids, no scan fallback; refuses foreign references, a spectrum with two
  identifications, hits without target/decoy annotation, and files that name
  no run or another run). The default join is unchanged.
- **Mass-shift survey (`-delta_out`):** five columns appended (six with
  `isotope_error`, below). `localized` and `unlocalized` count the spectra whose gap the
  fragments do or do not place on one site, judged by site-determining
  evidence only (ions that distinguish the chosen site from the others; ties
  and zero evidence are unlocalized); `residues` lists the localized sites,
  with `N-term|X` / `C-term|X` (and `Protein` ...) where b/y ions cannot tell the
  terminal residue from the terminus; `unimod` and `psimod` name the row from
  Unimod (`unimod.xml`, without `custom_mods.xml`'s CUSTOM entries) and
  PSI-MOD (read from `PSI-MOD.obo` with each
  term's own residue and terminus, including terms ModificationsDB keeps only
  as Unimod aliases), site-compatible with the localized sites, terminal
  entries only on terminal sites, fixed modifications accounted for
  (`Cys->Dha@C[-Carbamidomethyl]` at −91.009). New options
  `-delta_name_tolerance` (10) and `-delta_name_tolerance_unit` (ppm of the
  median peptide mass, or Da). The selected placement is localized whether or
  not `-recon_localize` is given. Candidates, not FDR-controlled. The desktop
  app reads the wider table.
- **Mass-shift survey, second pass** (development runs PXD045734 donor 4068):
  - PSI-MOD names ranked like Unimod: by the localized spectra on their sites,
    then by mass error (both columns were mass error first). Generic and
    abstract PSI-MOD terms are left out: children of MOD:00008 "common"
    (MOD:00565 "glycosylated asparagine" named deamidation before MOD:00684
    "deamidated L-asparagine") and origin-X classes other terms are `is_a` of
    (MOD:00400 "deamidated residue").
  - `-recon_sub_tolerance` (5) / `-recon_sub_tolerance_unit` (ppm of the
    gap's flank, or Da): a `sub:X->Y` reading of a gap needs this tolerance,
    never looser than the fragment tolerance; with the ppm fix below most
    unexplained gaps of a 20 ppm run read as some substitution (+2.004 as
    `sub:P->V`, 11.7 mDa off). `0` keeps 1.15's behaviour. Changes
    `delta_interp` and `top_interps`.
  - `-delta_group` (0.004 Da): `-delta_out` rows group the 0.5 mDa bins
    around the most populated ones, without chaining, every sampled spectrum
    in one row (the 1.15 rule could leave bins out); one shift, one row.
    `-delta_group 0` writes the 1.15 rows. Changes the first three columns
    at the default.
  - `isotope_error` column (appended): `13C+1` / `13C+2` for rows at 1 or 2 x
    1.00336 Da that no better residue-specific, non-label Unimod name explains;
    deamidation rows keep their name.
  - `-delta_spectra_out`: each spectrum's sample (native ID, gap, row,
    interpretation, peptide, site), for spectrum-level comparison with a
    search engine.
- **Mass-shift survey, hardening (1.16b)** (development runs PXD045734 donor
  4068 against an MSFragger open search; see the item1-dev HARDENING notes):
  - Changed defaults: `-delta_loc_model strict` (was `count`: a site now scores
    its distinct matched peaks, and H2O/NH3 loss satellites of observed
    unshifted ions are no evidence for a shifted one), `-delta_loc_min_evidence
    2` (was 1), `-delta_isotope_flank precursor` (was any row). `-delta_loc_model
    count -delta_loc_min_evidence 1 -delta_isotope_flank any` reproduces the
    1.16a columns 1-9 of `-delta_out` and 1-10 of `-delta_spectra_out` exactly
    (all six development runs). Changes `localized`, `residues`,
    `unlocalized`, `unimod`, `psimod` and `isotope_error`; never the samples.
  - Evidence classes: fragment-localized, sequence-constrained (a one-residue
    region, no fragment chose it; was counted as localized by fragments),
    ambiguous, unlocalized. Seven `-delta_out` columns appended:
    `fragment_localized`, `sequence_constrained`, `ambiguous`,
    `precursor_flank`, `charge_assumed`, `class` (observation classes, before
    names: extension, truncation, adduct, isotope, loss, fixed-mod loss and
    replacement, terminal, residue, substitution, unknown) and `isobars`
    (exact isobars of the best name: oxidation = A->S = F->Y and the like).
  - `-delta_spectra_out`: 26 provenance columns appended (tag, protein,
    orientation, gap side, precursor- or fragment-derived flank, charge and
    its source, unrounded delta, evidence and observation class, the selected
    tag's competing placements).
  - New: `-delta_counts_out` (reconciliation from MS2 to rows with sum
    checks), `-delta_select` (`min_delta`, the default, or `consensus`; not
    adopted: no measurable gain), `-delta_loc_null` (localization on
    m/z-moved peaks, the false-localization null), `-delta_isobar_tolerance`.
- **Fix: gap interpretation in ppm.** `delta_interp` judged a gap at ppm of
  the gap's own mass (20 ppm of 15.995 Da = 0.3 mDa; gaps under 1 Da at
  200 Da), while the gap's error is that of the flank it is measured on. A
  variable Oxidation (M) gap 2 mDa off was therefore `?` (PXD045734: the
  +15.995 rows of `-delta_out`), while Deamidated (+0.984, judged at 200 Da)
  was named. The gap is now judged in ppm of the mismatched flank's mass
  (200 Da at least). Substitutions were judged the same way, which read many
  gaps as `sub:X->Y`; they now have their own tolerance
  (`-recon_sub_tolerance`, above). Both stay hypotheses.
- **Run QC report (`-qc_out`):** new opt-in key/value report (section `qc`
  after the `run` rows): spectra per MS level and analyser class
  (ITMS/FTMS/TOF, from the filter string or the instrument configuration;
  MS1 counted from metadata), resolution as stated by the file and measured
  as m/z / FWHM on sampled profile spectra by m/z band (`n/a` for centroids),
  the precursor charge histogram, isobaric reporter kits from OpenMS's TMT
  6/10/11/16/18 and iTRAQ 4/8 tables (present, absent or not assessable, with
  the compatible kits), tag yield at E <= 0.01 and the share of redundant MS2
  (complete-linkage clusters by precursor, charge, 60 s, mobility and
  fragment cosine; and by best tag). Thread-independent; other outputs
  unchanged. For Thermo `.raw` input the resolution is measured on the
  sampled scans reread as acquired (profile); Bruker `.d` input is centroided
  only. See README, Run QC report.

## 1.15.1 (2026-11-18)

Documentation, packaging and desktop-app fixes for publication as research
software. Tag output is unchanged.

- **Citation:** `CITATION.cff` and `codemeta.json`; a "How to cite" section in
  the README and on the project page. The repository is archived by Software
  Heritage (SWHID in both files), and each release tag requests a new save
  (non-blocking step of the release-notes job). Tag builds check that both
  files name the tag's version, date and release URLs
  (`tools/check_citation_metadata.py`).
- **Documentation:** `BUILDING.md` (source build, tests, GUI build),
  `doc/TUTORIAL.md` (CLI walkthrough on the shipped example and on PXD000001),
  `doc/MANUAL.md` (the desktop app, with screenshots), the complete
  command-line table (a ctest checks every registered option has a row),
  report schemas for `-recon_out`, `-delta_out`, `-glyco_out` and
  `-check_header_out`, and the `-census_ids` paths of exit code 11.
  `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue and PR
  templates. CMake 3.28 or later (was documented as 3.24).
- **Evidence:** speed against DirecTag and tag accuracy at FASTag's defaults
  and at DirecTag-matched settings (PXD000001, PXD054073, PXD076528) are
  measured with 1.15.0 and committed with scripts and input checksums under
  `bench/results/`; the held-out preregistrations and results are archived in
  `acceptance/archive/`.
- **Example data in every bundle:** `examples/` (139-spectrum *E. coli* run
  and three proteins); the desktop app opens it with File > Open Example Data.
- **Licence notices:** the desktop-app bundles carry
  `GUI-THIRD-PARTY-NOTICES.txt` (Rust crates, npm packages, fonts, and the
  libraries the AppImage bundles, with links to the Ubuntu source packages of
  the (L)GPL ones); the CLI notices
  now include every licence text, and packaging fails when one is missing.
- **Taxonomy provenance:** UniProt (CC BY 4.0) and NCBI Taxonomy attribution;
  the index tarball carries `MANIFEST.json` (sources, checksums, commands).
- **Release notes** come from this file's section for the tag.
- **Desktop app fixes:** the pre-run check no longer recommends a ppm
  tolerance for a hybrid (e.g. LTQ Orbitrap) whose MS2 analyser the file does
  not state, and warns that the MS2 may be ion-trap; the post-run "Re-run with
  0.3 Da" leaves species detection out instead of stopping on its own red
  flag; a tags-only run (no reports) now raises the ion-trap red flag from
  FASTag's log, which it previously dropped; the Spectrum tab's tag table
  shows small E-values as in the Tags table (they were cut off); the Overview prints small q-values in scientific notation; the History
  table keeps long file names on one line; the Mass gaps empty-state button
  shows its full label.

## 1.15.0 (2026-11-16)

Release files carry the version, Intel Macs are built again, and the
Linux desktop app is also built for arm64. Tag output is unchanged.

- **Release files carry the version:** `FASTag-<version>-<variant>.<ext>`,
  e.g. `FASTag-1.15.0-linux-x64.tar.gz`, `FASTag-1.15.0-gui-macos-arm64.dmg`,
  `FASTag-1.15.0-gui-windows-x64-setup.exe`, `FASTag-1.15.0-windows-x64.zip`,
  `FASTag-1.15.0-taxonomy-k7.tar.gz` (+ `.tar.xz`, + `.sha256`). The `.deb`
  keeps Debian's `fastag-gui_<version>_amd64.deb`. CI takes the version from
  the tag (or `CMakeLists.txt` on a dry run) in one job per workflow, and a
  release whose files lack it goes red. `releases/latest/download/<name>`
  links no longer resolve: the README links the latest release page, and the
  project page finds the newest files through the GitHub API. The CLI's and
  the GUI's "taxonomy index missing" messages name the versioned asset.
- **Intel Macs again:** CI builds `macos-x64` natively on GitHub's
  `macos-26-intel` runner, with the same OpenMS, libraries, 13.4 floor, tests
  and signing as Apple silicon. Releases carry
  `FASTag-<version>-macos-x64.dmg` (command line) and
  `FASTag-<version>-gui-macos-x64.dmg` (desktop app); the Homebrew casks pick
  the image for the Mac's architecture. 1.8.0 to 1.14.x were Apple silicon
  only. The Intel leg runs on release tags and manual dispatches (including
  `gui_dry_run`), not on pull requests or pushes. GitHub ends its Intel macOS
  runners in 2027 (August 2027 per actions/runner-images), so the leg is to be
  removed before August 2027, and with it the Intel builds.
- **Linux desktop app for arm64:** `fastag-gui_<version>_arm64.deb`,
  `FASTag-<version>-gui-linux-arm64.tar.gz` and a best-effort
  `FASTag-<version>-gui-linux-arm64.AppImage`, built on ubuntu-22.04-arm
  (same floor as x64: glibc 2.35, WebKitGTK 4.1) and smoke-tested on
  ubuntu-22.04-arm and 24.04-arm. Checked on GNOME desktops (Ubuntu 24.04,
  Debian 12; Wayland and X11) together with the x64 bundles. The arm64 `.deb`
  and tarball are required release files, as the x64 ones are; the AppImage
  is attached only when it launched on both runners.
- **Linux menu category:** the desktop entry now says
  `Categories=Education;` (it was empty, so menus listed FASTag under
  "Other"). The macOS app's `LSApplicationCategoryType` becomes
  `public.app-category.education` from the same setting.
- **Tests:** `msfragger_cli_test` masks the paths it is given before it
  reads the run logs, so a checkout path containing "protease" no longer
  fails it. `ion_series_test` allows the 1-ulp E-value difference on macOS
  x86_64 that MSVC already had.
- **Held-out results:** MSFragger mass calibration (`calibrate_mass 2` in
  the export) **failed** on one criterion (not faster than the full search
  in 2 of 9 runs, lowest speed-up 0.947; kept share higher in 9 of 9, median
  +0.025); the export keeps `calibrate_mass 0`. The raw-DIA check's fourth
  test is **inconclusive** with no criterion failed: 0 of 86 non-DIA, 70 of
  71 DIA and 0 of 12 Astral DDA files refused, but only 1 closed-window DIA
  file (minimum 5). The Asp-N call of `-shortlist_protease auto` has no
  retest (no unused eligible Asp-N project in PRIDE) and stays not
  validated.

## 1.14.0 (2026-11-14)

Options that failed their held-out tests are removed, an empty reduced FASTA
is no longer written, and the held-out results of four 1.13 features are in
the docs. Tag output is unchanged.

- **Empty reduced FASTA: exit code 13.** When the shortlist keeps no protein
  and there is no `-shortlist_background`, `-fasta_out` would hold no
  protein. FASTag now writes neither it nor `-search_config_out`, removes files
  an earlier run left at those paths, writes every other output and exits
  with 13 (`UNEXPECTED_RESULT`) after the ERROR "... the reduced database
  would be empty. Not writing -fasta_out ...". Before, it wrote an empty file
  and exited 0 (seen in the Asp-N held-out test with `-shortlist_force`). The
  GUI shows a help entry for it.
- **`-complement_tolerance_unit auto` is validated:** its third held-out test
  passed (7 new runs; ion trap +3.31 points of correct rank-1 tags, 95%
  interval 2.98 to 3.65; timsTOF 18 of 18 cells not worse; 50 of 54 cells
  pass, 0 fail; run time ratio 1.028). The default stays `Da`.
- **Asp-N call of `-shortlist_protease auto` and its semi-specific export:
  not validated.** The held-out test failed on one criterion only: an empty
  trypsin comparison export (`-shortlist_force`) counted as an abort. Every
  other criterion passed: Asp-N called in 11 of 12 Asp-N runs and 0 of 9
  controls, shortlist recall +0.369 over the trypsin shortlist and +0.047
  over the full-specificity export, median Sage time 0.98 of the full search.
  The behaviour is kept.
- **Raw-DIA check (`-acquisition_check refuse`), third held-out test:
  inconclusive, no criterion failed.** On Astral, Orbitrap, timsTOF and SCIEX
  files it refused 60 of 60 DIA files and 0 of 75 non-DIA files. Inconclusive
  because only 3 Astral DDA files were left (minimum 8) and no closed-window
  DIA file was drawn.
- **mzML reader:** indexes written by ThermoRawFileParser 2.0, whose offsets
  point 3 bytes early, are used instead of rebuilt (the "no index, or one
  that no longer matches" warning is gone for these files; results were
  already the same).
- **Code:** Doxygen for every public class and function, OpenMS naming
  (private methods end in `_`, constants in UPPER_CASE), and `FASTag.cpp`
  split into option, report, mode and species units; no behaviour change.
  The macOS CI no longer fails on the size of the dmg.
- **GUI settings, 1.12.0 to 1.13.2 (fixed in 1.13.3; this note corrects the
  1.13.3 entry, which understated it):** these versions could neither read
  nor save settings: presets from 1.11 did not appear, new presets could not
  be saved ("could not be saved" error) and last-used values were not kept.
  Nothing on disk was changed. From 1.13.3 on, the first start brings back
  every preset and the last-used values from 1.11 (the old file is kept as
  `settings.v1.json.bak`). Presets you tried to save in 1.12.0 to 1.13.2 were
  never stored; save them again. New tests cover the recovery and fail if
  the app ever registers two setup hooks again.

Options and option values that failed their held-out test are removed. Each
removed name stays registered (advanced, not in the GUI) with no effect, so
that saved command lines and INI files of 1.12 and 1.13 keep loading: given
on the command line or with a non-default INI value, it prints one warning
"-<option> was removed in 1.14 (...); it has no effect". A removed value is
accepted with the same warning and the option's default is used. Apart from
the empty reduced FASTA above, every remaining configuration writes the same
output as 1.13.4.

- **Label discovery** (`-label_discovery_out` and its seven knobs
  `-label_discovery_max_flank`, `_depth`, `_min_spectra`, `_min_share`,
  `_window_n`, `_window_c`, `_unimod_top`): failed both held-out tests (6 of
  150 label-free runs got a label call; third test, report formats 2 to 4:
  three of nine criteria failed, weighted accuracy 0.572 against 0.80).
  The report, its code (src/LabelDiscovery.*), tests and design documents
  are removed. `-label_out` is unchanged.
- **`-label_call_min_tags`**: its only alternative to the 1.12 rule, 0, failed
  its held-out test (149/172 runs right, 0.866, against the threshold 0.922).
  The minimum is the constant 175 again; `-label_out` is unchanged.
- **a/x ion series** (`-ion_series ax` and `-ion_series_photo`): failed its
  held-out test (UVPD spectra of PXD018176: rank-1 tags correct for 0.04%
  under `ax` against 30.87% under `by`, -30.83 points, 95% interval -31.63 to
  -30.02; criterion +5). `-ion_series ax` is read as `by`;
  `-ion_series_photo`, whose only other value was `ax`, has no effect. The
  a/x code, tests and doc/AX-IONS.md are removed; `by`, `cz`, `auto` and
  `-ion_series_hybrid` are unchanged.
- **Explain-away species call** (`-species_call explain` and
  `-species_reagents`): failed its held-out test (62 public runs: 0.50 false
  genus calls per run against 5.98 for the decoy call, primary endpoint
  passed; recovery guard failed, truth genera recovered 38/105 against
  77/105). `-species_call explain` is read as `none`; `-species_reagents`,
  read only under `explain`, has no effect and its file is not read. The
  explain and reagent code, their report columns (`tags`, `unexplained_tags`,
  `reagent_tags`, `reagent_expected`), tests and
  `data/taxonomy/species_reagents.fasta` are removed; the `reagent_n_min` key
  of `-species_call_params` files is accepted and ignored. `none` and `decoy`
  are unchanged.
- **Centroiding of profile mzML** (`-pick_profile auto` and
  `-pick_unknown_type`): failed its held-out test (#9, item09-H1). Ion trap
  (PXD009049): two charge-3 cells fail non-inferiority, 4+ underpowered,
  fewer tagged spectra at tag length 4 and 5. Orbitrap (PXD016519,
  PXD018024): all 9 cells +10.5 to +32.0 points, but 567 fewer tagged
  spectra on PXD016519 at tag length 3. Default stays legacy.
  `-pick_profile auto` is read as `legacy`; `-pick_unknown_type`, read only
  under `auto`, has no effect. mzML MS2 is never centroided; the m/z-sorted
  picking, the unknown-type picking and the `profile_mzml` gate case are
  removed. `legacy` (mzPeak picked on read, as 1.11) and `off` are unchanged.
- **Mass shifts as search configuration** (`-search_shifts` and
  `-search_shifts_out`, `-shift_max_variable`, `-shift_max_offsets`,
  `-shift_expand_sites`, `-shift_site_min_share`, `-shift_site_min_count`,
  `-shift_site_min_ions`): failed both held-out tests (#17). Second test
  (item17r, four new runs): more PSMs on 4 of 4 runs (Comet +7.7 to +36.8%,
  Sage +6.5 to +25.2%), but Comet's entrapment FDP rose on PXD037999 (0.88%
  -> 1.28%, limit +0.30 points), and the option recovered only 5 of 32
  (Comet) and 3 of 11 (Sage) admissible peaks of an MSFragger open search.
  All eight have no effect; the shift rules, the `-search_shifts_out` report,
  their tests and the `shifts_insilico.mgf` fixture are removed.
  `-search_config_out`, `-delta_out` and `-massgap_out` are unchanged.
- **`-shortlist_exact_only`** (1.13.3): failed its held-out test (8 new
  runs: kept share of the full MSFragger search 0.503 in PXD003252 and 0.732
  in PXD014823, criterion at least 0.80 in every run). It has no effect;
  under `-search_engine msfragger` gapped placement stays on, also when the
  option is given together with `-shortlist_gapped`, which is no longer
  refused.

The msfragger shortlist defaults (`-shortlist_gapped` on,
`-shortlist_max_evalue 10`, `-recon_min_length 6`,
`-recon_missed_cleavages 2`) were the secondary arm of that test and failed
it too: kept share 0.530 in PXD003252, entrapment FDP 2.12% in PXD045654
(limit 2.0% per run). They passed the second held-out test (9 runs, lowest
kept share 0.833). They stay the default, but the docs no longer call them
validated (doc/SHORTLIST.md, "Third held-out test").

## 1.13.4 (2026-11-13)

Windows installation, GUI fixes and code cleanup; tag output is unchanged.

- **Windows: install for all users or per user.** An administrator is asked
  and gets `C:\Program Files\FASTag` preselected; a standard user installs per
  user without a prompt. Silent switches `/S`, `/S /AllUsers`,
  `/S /CurrentUser`. Changing the scope removes the install in the other scope,
  so an upgrade leaves one copy and one Apps entry.
- **Windows: uninstall retries files still in use** for up to 30 s and only then
  marks them for deletion at the next restart (seen on Windows on ARM64).
- **GUI: run markers, history and the failure log** are kept in local app data
  (`%LOCALAPPDATA%\de.openms.fastag` on Windows, moved once; settings stay
  roaming), and a marker records host and process, so a second PC no longer
  marks another machine's live run as interrupted.
- **GUI: pre-run check for the taxonomy index.** A run with the species report
  is blocked when the index is missing, with the path, how to install it and
  "Run without the species report", instead of failing with exit code 6.
- **GUI: the failure banner quotes FASTag's reason** from stderr; it could show
  an informational stdout line when the two streams arrived out of order.
- **Code:** local string helpers replaced by OpenMS `StringUtils`; exceptions
  contained in the complement probe and before the writer join; `buildtaxdb`
  reports filesystem errors and refuses a malformed `k` (such as "7x", read as
  7 before); OpenMS preambles in every source file.
- **Docs:** where the Windows app, its data and settings go, its size (about
  365 MB, about 1.5 GB with the separate taxonomy index), silent switches,
  WebView2 and what uninstall leaves.

## 1.13.3 (2026-11-12)

Fixes for the Windows desktop app and one new experimental option; tag output
is unchanged unless that option is used.

- **Windows on ARM64: the desktop app works.** The bundled x64 CLI died
  before it started (0xC0000142) on Windows 11 on ARM64, in 1.13.0 to 1.13.2:
  under x64 emulation its `mimalloc-redirect.dll` cannot patch the C runtime
  (microsoft/mimalloc#958). The app and the zip's `FASTag.bat` now set
  `MIMALLOC_DISABLE_REDIRECT=1` on ARM64 hosts; x64 is unchanged. If you
  start `FASTag.exe` directly on ARM64, set it yourself (README).
- **GUI settings migration runs again.** A second start-up hook replaced the
  first, so the migration of version-1 settings had not run since 1.12.0.
- **Characterize on Windows found no taxonomy index** even when it was
  installed (exit 6): the app passed the CLI a `\\?\` path it could not extend.
- **Label discovery help** no longer says report format 5 passed its fourth
  held-out test; format 5 was taken out before 1.13.2.
- **Windows releases are now attached only after tests on x64 and ARM64**:
  silent install, the app's start-up check of its CLI, the zip's
  `FASTag.bat`, and GUI end-to-end runs (export tags, spectrum inspector,
  Characterize) with the real CLI.
- **New `-shortlist_exact_only` (experimental).** Turns off the gapped
  placement that `-search_engine msfragger` switches on by default
  (`-shortlist_gapped` is a flag and cannot be given off); the other three
  msfragger defaults stay. Also settable in an INI; refused together with
  `-shortlist_gapped`. Runs without it are byte-identical to before; with
  Sage or Comet it changes nothing (exact is their default). No held-out test.

## 1.13.2 (2026-11-12)

Every new option is experimental and off by default unless stated. One
default changes: under `-search_engine msfragger` with `-search_config_out`
and the tryptic shortlist, the shortlist uses the configuration that passed
its second held-out test (MSFragger entry below). Tag output is otherwise
unchanged, except for mzML files with a selected-ion m/z of 0 (entry below).

- **Peak memory with many threads on large spectra.** The direct mzML decoder
  handles MS-Numpress and extra float arrays (such as ion mobility) itself, the
  tagger prepares peaks in place, and the indexed reader no longer keeps a
  per-thread copy of each spectrum's text. On PXD028735 (diaPASEF, mzML) peak
  RSS falls from 2,362 to 2,114 MB at 128 threads and from 1,392 to 1,282 MB
  at 64 threads (BinAC2, 3 repetitions), wall time 3-5 % lower; tag output
  byte-identical on five data sets. README states three glibc settings that
  lower it further at some run-time cost.
- **Experimental TMT6/10 artifact filtering** (`-tmt_pseudo_filter
  off|auto|on`, `-tmt_reporter_filter`; off by default): removes tags that
  start or end with a bare G/A pseudo-residue at a TMT flank mass, and
  optionally tags ending on a TMT reporter ion, when TMT labelling is detected
  (`auto`) or asserted (`on`). On two independent TMT projects (10,912
  reference PSMs) rank-1 accuracy rose from 82.20 to 82.72 %, recall@50
  unchanged (`bench/results/tmt-ga-2026-11-11/`). No held-out test.
- **GUI:** Setup starts with Export tags; Help completed (Overview, batch
  comparison, SDRF, History, reconciliation, exports) with contents, links and
  exact CLI-name search; Export INI no longer overwrites run inputs or
  reports; Tags is selected after tag-only runs; the Run shortcut no longer
  starts a hidden setup. No analysis default or report format changes.
- **`-search_engine msfragger`: the held-out-tested shortlist configuration
  is the default.** With `-search_config_out` and `-shortlist_protease
  trypsin` (the default), `-shortlist_gapped` is on, `-shortlist_max_evalue` 10, `-recon_min_length` 6 and
  `-recon_missed_cleavages` 2, each unless given on the command line or in an
  INI (the mechanism of `-shortlist_specificity`). This is the configuration
  of the second held-out test (PASS, entry below); the first held-out test
  (FAIL, 1.13) stands for the 1.13 shortlist. The log and the shortlist
  header name the values applied. On PXD003531 the export without the options
  is byte-identical to the one with them. Sage, Comet, runs without
  `-search_config_out` and other shortlist proteases keep 1.13.1's values.
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
  share is 0.526 to 0.946, below 0.80 in 5 of 9 runs. The first held-out
  FAIL (1.13 export, default shortlist) stands.
- **mzML: a selected ion m/z of 0 is read as missing.** A selected ion m/z
  (`MS:1000744`) of 0, below 0 or not a number now gives the precursor its
  isolation window target m/z, as a missing `MS:1000744` does; before, the
  spectrum yielded no tags. mzpeak-convert 0.18 (`--to mzml` from a Bruker
  `.d`, via mzdata) writes 0 for every precursor Bruker stored without a
  monoisotopic m/z; mzpeak-convert's own mzPeak output stores null there,
  which the mzPeak reader already read as the target. The run summary warns
  with the number of such spectra, how many took the target and that the
  converter wrote m/z 0. This departs from OpenMS `MzMLFile`, which keeps the
  0 (the documented exception to the indexed reader's parity with it). The
  OpenMS-read paths (no usable index, `-out_spectra`, mzPeak with a stored 0)
  do the same, and `-out_spectra` writes the target as the selected ion m/z;
  `tools/mzml_to_mgf.py` writes the target as `PEPMASS`. PXD054073 mzML
  (5,952 such MS2, all given the target): 7,506,097 tags instead of
  7,309,985, byte-identical to the same mzML with those lines blanked out, with
  and without `-out_spectra` (its point mzPeak gives 7,506,102; the rest is
  the float32 isolation target there). PXD003531, PXD047793, PXD076528 and
  PXD028735 (mzML) give byte-identical tags.

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
- `-species_reagents <fasta>` (experimental, off by default, with
  `-species_call explain`): a taxon the explain call does not detect is
  reported `present` with `call_reason` `reagent` when its tags in the listed
  reagent proteins (`data/taxonomy/species_reagents.fasta`: porcine trypsin
  and pepsin, bovine serum, milk and enzyme proteins, 38 entries) exceed the
  same count on the decoy tags; new report columns `reagent_tags`,
  `reagent_expected`; optional key `reagent_n_min` (8) in `species_call.tsv`.
  The calls of the explain rule are unchanged. A reagent call is scored
  neither as a true nor as a false genus call and is counted separately.
  Development data only (62 spent held-out runs): 47 reagent calls in 37
  runs, 40 of them with at least 3 Sage peptides in the listed proteins;
  false genus calls per run 0.50, as for `explain` alone. Not held-out
  tested.

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
