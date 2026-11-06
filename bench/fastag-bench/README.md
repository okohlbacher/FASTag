# fastag-bench

Benchmark harness, result tables and figure scripts for the FASTag article (Journal of Proteome
Research, Software Tools and Resources). Version 1.9.0 of the harness accompanies FASTag 1.9.0
(<https://github.com/okohlbacher/FASTag>, tag `v1.9.0`, commit `153bd23fed242e41b48817374372918fcac3f878`)
and is distributed as a Supporting Information zip file of the article. It has no public repository and no
archive DOI of its own; cite the article and `CITATION.cff`.

**Paper release: FASTag 1.9.0.** Every number of the article comes from a `*_v190.tsv` table, including the
thread ladder (Figures 4 and 5, Table S7, `ladder_*_v190.tsv`: FASTag 1.9.0 rows, DirecTag rows reused from the
1.8.0 ladder; see "Thread ladder"). Tables of the 1.8.0 pass end in `_v180`
or carry no suffix (older tables). They stay in place as the **1.8.0 baseline** (see "1.8.0 baseline tables"
below) and are not used in the article. Comparators (Sage, Comet, DirecTag, Casanovo,
InstaNovo, Novor, PepNovo+, Unipept) were run once and reused for 1.9.0. FASTag's matched-settings output is
byte-identical in 1.8.0 and 1.9.0, so the paired statistics use the 1.9.0 run directories.

**Figure defaults.** Every figure script whose tables exist per release reads the `_v190` tables by default
and writes `<figure>_v190.{pdf,png}`; `--suffix v180` or `--suffix ''` renders the 1.8.0 baseline under the
old name. `fastag-bench figures` renders the 1.9.0 default and the baseline variants.

All benchmark data are public ProteomeXchange (PXD) datasets. `datasets.yaml` lists every file of the 14
named datasets with its PRIDE URL, size and checksum, and every derived file (mzML, mzPeak, MGF) with its route
and sha256. The per-run collections (species benchmark: 48 runs, 37 PXDs; digest/label/alkylation validation:
254 runs) are in `config/species_runs.tsv` and `results/sdrf_truth_runs.tsv`; `config/public_runs.tsv`
(`scripts/public_runs_manifest.py`, PRIDE API v3) gives the PRIDE file, URL, size and PRIDE checksum of each of
those 302 runs (PRIDE lists a checksum for 161 of them).

## Contents

| path | what |
|---|---|
| `datasets.yaml` | 14 named benchmark datasets: PXD, exact file names, PRIDE URLs, sha1 (PRIDE, or computed on our copy where PRIDE has none) / sha256 (derived files), species, instrument, enzyme, labels, which experiments use them |
| `config/public_runs.tsv` | PRIDE file, URL, size and checksum of the 302 runs of the species and digest collections (`scripts/public_runs_manifest.py --cache DIR`) |
| `src/fastag_bench/` | the `fastag-bench` package (fetch, convert, run, score, time, figures) |
| `scripts/fig_*.py` | one standalone script per figure; needs only pandas and matplotlib; default tables `_v190` |
| `scripts/si_tables.py` | Supporting Information tables of the article from the result tables: `Table_S2.xlsx` to `Table_S7.xlsx` (S2 parameter sets and command lines, S3 species benchmark, S4 report evaluation, S6 tag accuracy, S7 speed and memory with sampled peaks where re-measured and `ru_maxrss` marked as lower bound) and `FASTag-JPR-SI-figures-tables.{md,pdf}` (Figures S1 to S4 with legends, Table S1 byte-identity gate, Table S5 hardware and load protocols); `python3 scripts/si_tables.py --out DIR` after `fastag-bench figures`; needs the `si` extra (openpyxl) and, for the PDF, pandoc and xelatex; test `tests/test_si_tables.py` |
| `scripts/fig_s{1,2,3}_*.py` | Figures S1 (thread-count independence of the tag table on the ladder), S2 (ranked genus lists per species run, default and deconvolved), S3 (flow of runs in the report evaluation); Figure S4 is `fig_digest_overhead_v190` |
| `results/massgap_absent_v190.tsv` | the 58 runs of the report evaluation without an alkylation report and why: prose-auto 0.1.3 stored no mass-gap test of the run (50) or tested another run of the data set (8); read from prose-auto's run logs on `data` via `fastag-digest-val/runs.json`; Figure S3 and Table S4 (sheet `no_alkylation_report`) |
| `results/gate_refs_v190.tsv`, `results/search_configs.tsv` | Table S1 (cases, inputs with SHA-256, options and reference digests of the byte-identity gate, FASTag 1.9.0 status; the gate script itself is not in this archive) and the Sage, Comet, DirecTag and Unipept configurations of Table S2 |
| `scripts/stats_paired.py` | paired statistics of the article: `export` builds `results/accuracy_pairs_v190.tsv.gz` (per PSM spectrum, FASTag vs DirecTag at matched settings) from the accuracy run directories; `stats` writes `results/stats_accuracy_paired_v190.tsv` (exact McNemar, Holm, peptide-bootstrap CIs) and `results/stats_runlevel_v190.tsv` (majority baselines, balanced accuracy, Wilson intervals for protease, label and alkylation calls); test `tests/test_stats_paired.py` |
| `results/runtime_pxd047793_v190.tsv` | runtime analysis of PXD047793 (FASTag 1.9.0 and 1.8.0, DirecTag 1.4.21142; phases, profiles, RSS, decode floor; ibminode05) |
| `results/xplat_runtime_v190.tsv`, `scripts/xplat_runtime_v190.py`, `results/xplat_v190/`, `results/xplat_phases12_v190.tsv` | Table S8 and Table S9: cross-platform runtime of the FASTag 1.9.0 release binaries on PXD063151 `Proteome_EIF5A.mzML` (Linux AMD EPYC 7763, macOS Apple M3 Ultra, Windows 11 AMD Ryzen 9 7900X; default and matched speed profiles, 1/12/16/64 threads, 3 reps; median and min wall, speed-up, CPU, peak RSS, tag-table sha256 raw and LF-normalised), built from the per-run tables in `results/xplat_v190/runs_*.tsv` (`windows_lf_sha.tsv`: Windows digests after CRLF → LF; `scan1201892_default_{linux,macos}_v190.tsv`: the one spectrum whose default tags differed on macOS 1.9.0); `xplat_phases12_v190.tsv`: phases at 12 threads on Linux and Windows |
| `results/*.tsv` | result tables that already exist; the first `#` lines of each file name the source, FASTag version and conditions; `*_v180.tsv` (or no suffix) = FASTag 1.8.0, `*_v190.tsv` = FASTag 1.9.0 |
| `results/digest_val_layer2.json` | per-run record of the digest/label/mass-gap differential test (FASTag 1.8.0 vs prose-auto 0.1.3) |
| `results/difftest_layer{1,2}_v180_vs_v190.tsv` | differential test against prose-auto 0.1.3 for the FASTag 1.8.0 and 1.9.0 releases (same runs, flags and environment): layer 1 per run and report (values checked, differences), layer 2 per run (native calls vs stored prose-auto calls, correctness against prose-auto's truth labels with prose-auto's model table and with the shipped models, alkylation value); written by `scripts/cluster/difftest_export.py` on the node that holds the work directories |
| `results/sdrf/` | public SDRF files used as digest/label/alkylation truth (community: bigbio/sdrf-annotated-datasets, Apache-2.0; submitter: PRIDE); `sources.tsv` names the URL of each |
| `results/sdrf_truth_runs.tsv`, `table_s3_digest_truth[_v190].tsv`, `fig7_*[_v190].tsv`, `digest_calls_*.tsv` | Table S4 and Figure 7 (file names keep the older `table_s3` prefix): SDRF truth per run, FASTag 1.8.0 and 1.9.0 calls (`digest_calls_v180_vs_v190.tsv` lists the 19 runs that changed; RC 71a68e0 calls for comparison), correctness, summaries |
| `scripts/cluster/` | node-side scripts that produced the Table S4 reports (`rerun180.py`: release re-run of the 244 validation runs; `nt_run.sh` + `nt_runs.tsv`: download, conversion and FASTag runs of the 10 added non-tryptic runs) and the differential-test tables (`difftest_export.py`) |
| `figures/` | rendered figures (PDF and PNG); `*_v190.*` from the 1.9.0 tables (the article's figures), unsuffixed from the 1.8.0 (or older) tables, `fig_{gap_penalty,peak_budget}_v180.*` from the 1.8.0 harness sweeps; `fig4_*_v190`, `fig5_*_v190` from the 1.9.0 ladder, unsuffixed `fig4_*`, `fig5_*` from the 1.8.0 ladder |
| `config/bench.example.yaml` | every configuration key with its default |
| `config/minirun-data.yaml` | the configuration of the end-to-end check on IBMI node `data` |
| `tests/` | pytest unit tests for the scoring rule, the parsers, the configuration, the figure index and the paired statistics |
| `scripts/ladder/`, `results/ladder_*_v190.tsv`, `results/ladder_*_v180.tsv` | load-gated thread ladders of FASTag 1.9.0 and 1.8.0 and DirecTag 1.4.21142 on node kim (Figures 4 and 5): node-side runner, plans, input preparation, result tables |
| `scripts/longtag/`, `results/longtag_v190/` | cause of the tag-length-3 rank-1 deficit against DirecTag on PXD076528 and PXD001819 (Note S5 of the Supporting Information): per-spectrum discordance tables (`disc_*.tsv.gz`, `lt_discordant.py`), reruns of FASTag 1.9.0 and of a diagnostic build of v1.9.0 (two builds from FASTag v1.9.0: `build2` from `fastag-1.9.0-diag.patch`, with environment-variable switches for DirecTag's complement charge rule, complement tolerance and complement score, used for the `b2_base` and all `zc*` runs and for every run on PXD000001 and PXD054073; `build` from `fastag-1.9.0-diag-build1.patch`, the same switches without the charge rule, used for the other runs on PXD076528, PXD001819 and PXD003531; both byte-identical to the release with the switches off, `rerun_digests.tsv`) scored against DirecTag (`reruns_*.tsv`, `lt_score.py`), per-charge strata and complement evidence, and the peak-count check against DirecTag's OriginalPeakCount (`peakcount_PXD*.log`, `lt_peakcount.py`) |
| `scripts/ablation_v190.py`, `config/ablation-data-v190.yaml`, `results/ablation_v190.tsv` | Note S6 of the Supporting Information: one-setting-at-a-time ablation of the FASTag 1.9.0 defaults (gaps, gap penalty, deisotoping, window quota, peak budget, fragment tolerance) on the five tag-accuracy data sets; rank-1 and all-tags precision, recall, CPU time |

## Install

Python 3.11 or newer.

```bash
python3 -m venv .venv
.venv/bin/pip install -e ".[test]"        # add ,mgf for Casanovo subsampling (pyteomics), ,si for scripts/si_tables.py (openpyxl)
.venv/bin/python -m pytest
```

External tools are found on `PATH` or set in the config (`tools:`):

| tool | role | install |
|---|---|---|
| FASTag 1.9.0 | tagger under test | release binaries, <https://github.com/okohlbacher/FASTag/releases/tag/v1.9.0> (the `_v180` tables used 1.8.0, tag `v1.8.0`) |
| Sage 0.14.7 | ground-truth database search | GitHub release binary `sage-v0.14.7-x86_64-unknown-linux-gnu.tar.gz` (sha256 `e3dc6b41015cb167574f6c82525b75e946c094f30bd700271b05c051c30cbe8a`; tag `v0.14.7` = commit `99407db`). It prints `sage 0.14.6`: the v0.14.7 release did not bump `crates/sage-cli/Cargo.toml` (still 0.14.6 at the tag), so the version string cannot tell the two apart; identify the build by the archive checksum. Bioconda `sage-proteomics=0.14.7` is an alternative; a combined env with `comet-ms` resolves to 0.14.6 |
| Comet 2026.03.0 | ground-truth cross-check | GitHub release `comet.linux.exe` v2026.03.0 (sha256 `ad93b4cf60c2ed7afc2f41b8a3a05567c3938d999f17deb7b3676bc1fa91e7ed`, prints `2026.03 rev. 0 (fa08489)`); bioconda lags at 2026.01.1 |
| AlphaTims 1.1.1, OpenMS 3.6.0 | Bruker ddaPASEF `.d` to MGF to mzML (PXD054073) | bioconda `alphatims=1.1.1`, `openms=3.6.0` (FileConverter) |
| ThermoRawFileParser | `.raw` to mzML | bioconda `thermorawfileparser` |
| mzpeak-convert 0.18.0 | mzML to mzPeak (optional) | mzPeak reference converter (version used for the study files) |
| DirecTag 1.4.21142 | tag comparator (optional) | bioconda `bumbershoot`; runs with `LC_ALL=C` (set by the harness) |
| Casanovo 5.2.1 | de novo comparator (optional, GPU advised) | `pip install casanovo "pyarrow<16"` |

A missing optional tool is skipped with a message naming the tool and how to install it.

## Usage

All subcommands take `-c CONFIG`, `-d datasets.yaml` (default `./datasets.yaml`), `--dataset
<id or PXD>` (repeatable) and `--experiment <name>`.

```bash
# 1. download and verify (sha256 if recorded, else PRIDE sha1, else size); files above --max-gb are skipped
fastag-bench fetch -c config/bench.example.yaml --dataset PXD003531 --roles raw,sdrf
#    'mirrors:' in the config links already present copies instead of downloading them

# 2. raw -> mzML with ThermoRawFileParser (-f 2 -L 1-2), mzML -> mzPeak with mzpeak-convert
fastag-bench convert -c config/bench.example.yaml --dataset PXD003531

# 3. FASTag thread ladder over mzML and both mzPeak layouts, then reports, Sage and comparators
fastag-bench run -c config/bench.example.yaml --dataset PXD003531 --tools fastag --formats mzml,mzpeak
fastag-bench run -c config/bench.example.yaml --dataset PXD003531 --tools reports,sage,directag,casanovo --threads 16

# 4. tag precision/recall vs Sage 1% FDR PSMs, species rank, digest/label call vs SDRF
fastag-bench score -c config/bench.example.yaml --dataset PXD003531

# 5. timing summary (min/median wall, CPU, peak RSS per tool, format and thread count)
fastag-bench time -c config/bench.example.yaml --summary
fastag-bench time --tsv my_timing.tsv --label test -- FASTag -in x.mzML -out x.tsv   # time any command

# 6. all figures from the result tables
fastag-bench figures --results results --out figures

# everything in order
fastag-bench all -c config/bench.example.yaml --dataset PXD003531
```

A single figure without installing the package: `python3 scripts/fig_thread_scaling.py --results
results --out figures`. Scripts whose tables exist per release take `--suffix v190` and then write
`<figure>_v190.{pdf,png}`: `fig_tag_accuracy`, `fig_gap_penalty`, `fig_peak_budget`, `fig_directag_accuracy`,
`fig_3_denovo_reference`, `fig6_species` (`fig_6_species.py`), `fig_digest_sdrf`, `fig_digest_overhead`,
`fig_gate_times` (paired medians; `*` marks cases with a different mzML reader path) and `fig_species_gate`.
`fastag-bench figures` renders the default (1.8.0) set and every release variant listed in
`fastag_bench.figures.VARIANTS` (`--default-only` skips the variants); the index at the end of this file lists
which tables each figure reads (traced by `scripts/readme_inventory.py`, which also checks that nothing is missing).

```bash
for f in tag_accuracy gap_penalty peak_budget directag_accuracy 3_denovo_reference 6_species digest_sdrf \
         digest_overhead gate_times species_gate; do python3 scripts/fig_$f.py --suffix v190; done
```

Table S4 / Figure 7 (digest, label, alkylation vs SDRF) from the shipped tables, without network or FASTag:

```bash
python3 scripts/sdrf_truth.py          # results/sdrf/ + run tables -> results/sdrf_truth_runs.tsv
python3 scripts/score_digest_truth.py  # -> table_s3_digest_truth.tsv, fig7_digest_summary.tsv, fig7_confusion.tsv
python3 scripts/fig_digest_sdrf.py     # -> figures/fig_digest_sdrf.{pdf,png}
python3 scripts/score_digest_truth.py --tag v190 && python3 scripts/fig_digest_sdrf.py --suffix v190   # FASTag 1.9.0
# from new FASTag reports: scripts/extract_digest_calls.py --reports DIR --out results/digest_calls_v180.tsv
```

Run outputs go to `work/runs/<dataset>/<tool>/<label>/` (command, log, tool version, outputs); every
timed run is appended to `work/timing.tsv` with wall, user and system time, peak RSS (from
`os.wait4`) and the 1-minute load average before and after. Scored tables go to
`results/benchmark/<dataset>/`.

## Scoring rules

- **Ground truth.** Sage target PSMs at spectrum-level q ≤ 0.01, rank 1. The Sage configuration is
  generated from the dataset's enzyme and modifications (`work/runs/<dataset>/sage/default/sage.json`).
  Spectra are joined by scan number (`scan=<n>` in the native ID).
- **Tag correctness (paper rule, every tool).** A tag is correct when its sequence, or the reversed
  sequence, is a substring of the PSM peptide with I = L, **and** at least one of its two flanking
  masses agrees with the peptide within 0.05 Da at that position (`rule = flank`, `score.tag_correct_flank`).
  The flanks include all modifications of the PSM (Sage writes static and variable ones as mass
  deltas). FASTag and DirecTag 1.4.21142 write the same flank convention (calibrated on PXD003531):
  `nterm_mass + tag + cterm_mass + H2O = precursor`; a tag read off the b series appears reversed
  and its flanks carry one water. The sequence-only rule is kept as `rule = sequence`. A chance
  control scores the same tags against peptides permuted between spectra (`control = shuffled peptides`).
- **Metrics.** Top-1 precision (top tag correct / PSM spectra with a tag), top-1 recall (/ all PSM
  spectra), all-tag precision, the share of tagged PSM spectra with a correct tag within the top k,
  and precision by tag length, E-value bin and gapped flag. Rank is the row order of a spectrum in
  the tool's output (FASTag and DirecTag write best first).
- **Species.** Rank of the expected genus (`expected_genus` in `datasets.yaml`) in the FASTag species
  report, and the ratio of the top two `observed` counts.
- **Digest and label.** The protease class of `-digest_out` is compared with the SDRF cleavage agents
  (Trypsin with Lys-C counts as Trypsin). For labels the harness, not FASTag, applies a rule: the
  isobaric label with the largest tag-end share in `-label_out`, if that share is ≥ 0.01 and above its
  +0.5 Da background, else label-free. SILAC shares are reported but not scored.

## Shipped results

| file | content | FASTag version | source |
|---|---|---|---|
| `regression_pxd003531_v161_vs_v170.tsv` | 85 raw runs: wall, CPU, RSS, load; mzML, point and chunked mzPeak at 1/16/64 threads, `-out_spectra` cases | 1.6.1 vs 1.7.0 (1.7.0 reader = 1.8.0) | `data:/scratch/kohlbach/fastag-omsdev/regress/results.tsv` |
| `decode_threads_v170.tsv` | wall time by MzPeakFile decode threads | 1.7.0 | work/BACKLOG.md |
| `gate_smoke_times.tsv` | 9 public gate cases, wall time at 32 threads | 1.6.1 and 1.8.0 (build 0afad89b) | gate `refs/cases.tsv`, `gate_c.log` |
| `gate_smoke_times_v190.tsv` | 9 public gate cases at 32 threads: 6 paired, order-alternating rounds of 1.8.0 vs 1.9.0, medians, ratio, reader path per version, per-run `timing_valid` (load1 ≤ 112); single re-baseline passes kept with their own flags | 1.8.0 (build 0a502c77) vs 1.9.0 | `data:/ceph/ibmi/abi/oliver/jpr-bench/gate-v190/` |
| `gate_smoke_times_v180.tsv` | the 1.8.0 side of the paired runs above (not the 1.8.0 column of `gate_smoke_times.tsv`, which is another build) | 1.8.0 (build 0a502c77) | same |
| `gate_smoke_times_runs_v190.tsv` | every gate run behind the two files above (162 rows), incl. the index control on exact-offset inputs | 1.8.0, 1.9.0 | same |
| `regression_v180_vs_v190.tsv` | per gate case: tag rows, gapped rows, duplicates, (spectrum,tag) Jaccard, best-E-value tag agreement, recon/reversed placements | 1.8.0 vs 1.9.0 | `gate-v190/regcmp_v180_vs_v190.tsv` |
| `directag_accuracy_pxd000001.tsv` | valid tag within top k, FASTag vs DirecTag | 1.2.x (pre-port) | repo `doc/BENCHMARK-DirecTag.md` |
| `directag_runtime_memory.tsv` | wall time and RSS vs DirecTag, public rows only | 1.2.x / pre-1.4.2 | `BENCHMARK-DirecTag.md`, `BENCHMARK-corpus-128t.md` |
| `gap_penalty_pxd000001.tsv` | rank-1/top-5 by `-gap_penalty` | pre-1.4 | knowledge `BACKLOG.md` |
| `peak_budget_pxd000001.tsv` | rank-1 and wall time by peak budget | 0.13 | knowledge `BACKLOG.md` |
| `species_pxd003531_gate.tsv` | species report of the gate case | 1.6.1 refs, identical in 1.8.0 | gate `refs/out/species/species.tsv` (copy kept in `refs/out-v1.6.1/`) |
| `species_pxd003531_gate_v190.tsv` | the same report from 1.9.0 (Homo observed 12998 → 14732; top 3 genera unchanged) | 1.9.0 | gate `refs/out-v1.9.0/species/species.tsv` |
| `digest_runtime_v180.tsv` | paired extra wall time of the reports | 1.8.0 | `fastag-digest-val/runtime.tsv` |
| `digest_runtime_v190.tsv` | the same paired protocol on ibminode05 (idle, all pairs `timing_valid`); compare deltas only, absolute times are from another node | 1.9.0 | `jpr-bench/timing_v190_ibminode05/` |
| `species_fastag_timing.tsv` / `species_fastag_timing_v190.tsv` | species default arm, 48 runs; the `_v190` file has 1.8.0 and 1.9.0 interleaved on ibminode05 at 32 and 48 threads (use its 1.8.0 rows for the ratio) | 1.8.0 (spock) / 1.8.0 + 1.9.0 | `jpr-bench/timing_v190_ibminode05/` |
| `directag_accuracy_pxd000001_v190.tsv` | valid tag within top k, FASTag 1.9.0 vs DirecTag, both scored by the harness flank rule (not a version-only refresh of the 1.2.x table: other scorer) | 1.9.0 | `tag_accuracy_topk_v190.tsv` |
| `digest_val_runs.tsv` | 244 runs of the digest differential test with calls and annotations | 1.8.0 | `fastag-digest-val/layer2.json` |

Rows marked pre-port were measured before FASTag moved to OpenMS develop (1.7.0): their speed numbers
do not describe 1.8.0. Tag output is byte-identical from 1.6.1 to 1.8.0 apart from the isobaric tie
change, so the accuracy rows are expected to carry over but were not re-run.

1.9.0 gate timings (`gate_smoke_times_v190.tsv`): dda_default, nontryptic_ext and species take a
different mzML reader path in the two versions. 1.8.0 looks for an MS2 in the first 64 spectra only;
PXD003531 and PXD040407 open with 977 and 1804 MS1 scans, so 1.8.0 falls back to OpenMS's reader with
a serial metadata pre-pass (it logs "fast path is unavailable"), while 1.9.0 probes to the first MS2
and keeps its own reader. Their speedups (ratio 0.32-0.68) come from that reader change. They do not
measure tagging. The gate mzMLs (ThermoRawFileParser 2.0.0.dev) have every index offset 3 bytes early,
so FASTag's mzML reader logs "has no index, or one that no longer matches the file" and rescans
(0.02-0.04 s). With exact offsets the message goes away and the outputs stay byte-identical.
`fig_gate_times.py --suffix v190` plots the paired medians and marks these three cases.

## Tag accuracy (`fastag-bench accuracy`, Figure 3)

`config/accuracy-ibminode05.yaml` runs, per dataset with the `tag_accuracy` experiment:

```bash
fastag-bench accuracy -c config/accuracy-ibminode05.yaml --dataset PXD003531 --steps sage,comet,run,score,overlap
fastag-bench accuracy -c config/accuracy-ibminode05.yaml --dataset PXD000001 --steps gap_penalty,peak_budget
fastag-bench accuracy -c config/accuracy-ibminode05.yaml --dataset PXD003531 --steps collect   # all datasets
```

- **Ground truth.** Sage target PSMs at spectrum q <= 0.01 with the settings in each dataset's
  `search:` block (from the SDRF, else the deposited search, else stated defaults); Comet
  (concatenated decoys, target-decoy q on the E-value) on PXD003531 and PXD001819; the deposited
  Mascot searches (PXD000001 `F063721.dat`, PXD001819 `WF3-8_UPS1_25000amol_R1.dat`) where present.
- **Profiles.** `fastag_default` (FASTag defaults + the dataset's fixed modifications; 0.5 Da on
  ion-trap data), `fastag_matched` (DirecTag's default algorithm settings: TL 3, 50 tags, 100 peaks,
  no window quota, no gaps, no deisotoping, `tagger.fragment_tol_da`), `directag_default` (DirecTag
  hard-coded defaults, 0.5 Da, + static modifications), `directag_matched` (fragment and complement
  tolerance `tagger.fragment_tol_da`, isotope tolerance half of it), and `*_matched_tl<L>` for
  precision by tag length. 32 threads on every tool; accuracy does not depend on the thread count.
- **Sweeps** (pre-port protocol: TL 4, one-gap tags, unlimited tags) at 1 thread, 3 timed reps,
  started only when the node's 1-min load is below 0.25 per logical CPU; `timing_valid` records
  whether that held before and after every rep.
- **Caveats.** On ion-trap data (PXD001819, 0.5 Da fragments) the 0.05 Da flank tolerance is far below the
  fragment accuracy, so the flank rule there mostly measures flank precision (sequence rule: rank-1
  0.42 FASTag, 0.48 DirecTag; flank rule: 0.25 vs 0.29). PXD054073 is converted per ddaPASEF precursor
  (AlphaTims MGF, 2,767 of 133,378 spectra without a precursor m/z or charge dropped); DirecTag reads 0
  spectra from the OpenMS-written mzML and is given the same filtered MGF (identical `index=<n>` IDs).
  The deposited PXD001819 Mascot search is not used as truth (see `datasets.yaml`).
- **Peak RSS.** Tools are started through a small helper interpreter (`timing.py`): Linux keeps a
  process's RSS high-water mark across fork/exec, so a tool forked straight from the harness reported
  the harness's RSS (510 MB for `/bin/true` from a 500 MB parent on ibminode05). Runs before this fix
  (the 2026-11-03 minirun ladder in `results/benchmark/`) can overstate peak RSS by the harness size.
- **Outputs.** `results/tag_accuracy_{runs,summary,topk,by_length,by_evalue,evalue_density,overlap}_{v180,v190}.tsv`,
  `results/{gap_penalty,peak_budget}_pxd000001_{v180,v190}.tsv`; Figure 3: `scripts/fig_tag_accuracy.py` (1.9.0 tables; `--suffix ''` for the 1.8.0 baseline).
  The 1.9.0 pass (`config/accuracy-ibminode05-v190.yaml`, `accuracy.result_tag: v190`) re-ran FASTag only;
  Sage, Comet and DirecTag outputs of the 1.8.0 pass were reused. The `fastag_matched*` tags are byte-identical
  in 1.8.0 and 1.9.0.

## End-to-end check (`results/benchmark/`)

`config/minirun-data.yaml` was run on IBMI node `data` on 2026-11-03 with FASTag 1.8.0 (RC `71a68e0`,
same source as `v1.8.0`), Sage from bioconda `sage-proteomics=0.14.7` and DirecTag 1.4.21142, on
PXD003531 (27,345 MS2): fetch (mirrors), thread ladder 1/16/64 x 2 reps on mzML and both mzPeak
layouts, reports, species, Sage, DirecTag, score, time summary. All nine ladder tag TSVs and the
reports run are byte-identical (sha256 `837e99fb...`, the gate reference). The node was shared
(load 235-257 on 224 CPUs), so the times are smoke figures. DirecTag ran with its own settings
(TL 3, 50 tags, 100 peaks), FASTag with its defaults, so the DirecTag row is a parser and pipeline
check, not a matched comparison.

## De novo reference points (`results/denovo_*.tsv`)

Full-peptide de novo tools as reference points for tag accuracy (open issue 4), on IBMI node `data`
(AMD EPYC 9654, 224 logical CPUs; NVIDIA H100 PCIe, GPU index 1), 2026-11-03:

| tool | version | hardware | notes |
|---|---|---|---|
| Casanovo | 5.2.1, weights `casanovo_orbitrap_v5-2-0.ckpt` (sha256 `236fee3d...59a8`) | GPU, beam 1, batch 1024 | Apache-2.0; vocabulary has no phospho, TMT or methylthio |
| InstaNovo | 1.2.2, transformer `instanovo-v1.2.0` | GPU, beam 5, batch 128, fp16 | code Apache-2.0, **weights CC BY-NC-SA 4.0**; no TMT/methylthio in the vocabulary |
| Novor | 1.05.0573 free academic edition (bundled in bioconda `searchgui` 4.3.15) | CPU, 16 cores | proprietary academic EULA (accepted by the user); TMT6plex and Methylthio via `PTMFile` |
| PepNovo+ | build 20101117 (bioconda `pepnovo`) | CPU, 32 single-threaded chunks | model `CID_IT_TRYP` (ion-trap CID; the data are HCD); top peptide and native tag mode (`-tag_length 3`) |

Every MS2 spectrum is written once as MGF (`fastag_bench.mgf`) and given to every tool; PXD076528 uses
a fixed-seed subsample of 20,000 MS2 spectra (`write_ms2_subsample`, seed 20261103). Tags are
derived from each spectrum's top peptide (every window of length k = 3, 4, 5; k = 3 is FASTag's
default) with prefix and suffix residue masses, ranked by the mean per-residue score when the tool
reports one. Both correctness rules of the tag-accuracy task are applied (`flank`: substring either
direction, I = L, plus one flanking mass within 0.05 Da, reversed readings with the H2O offset of
`score.tag_correct_flank`; `sequence`: substring only), with a shuffled-peptide chance control. The
full peptide is scored against Sage too (residues equal, I = L; and additionally all modification
masses). PepNovo+ gaps are converted from ion to residue masses (C-Gap minus H2O and a proton,
measured: +19.02 Da offset).

```bash
python -m fastag_bench.denovo config/denovo-data.yaml --results results   # paths are on node data
python -m fastag_bench.denovo config/denovo-data-v190.yaml --results results  # FASTag 1.9.0 -> denovo_*_v190.tsv
python -m fastag_bench.denovo config/denovo-data-v1100-mgf.yaml --results results  # FASTag 1.10.0 on the MGFs -> denovo_*_v1100_mgf.tsv
python3 scripts/fig_3_denovo_reference.py                                  # de novo panel, 1.9.0 tables
python3 scripts/fig_3_denovo_reference.py --suffix ''                      # 1.8.0 baseline
```

Run scripts, tool parameters and environment recipes: `scripts/denovo_runs/`. Sage ground truth:
`/ceph/ibmi/abi/oliver/jpr-bench/accuracy/sage-<PXD>` (shared with the accuracy task). The node was
shared (1-minute load 230-390 on 224 CPUs), so no timing in `denovo_runtime.tsv` passes the
load/core < 0.25 rule; the times are indicative only.

FASTag 1.10.0 on the comparator MGFs (2026-11-05; `config/denovo-data-v1100-mgf.yaml`, run key `input: mgf` maps
FASTag's `index=<k>` spectrum IDs to the MGF record via `denovo.fastag_mgf_keys`): `denovo_tag_accuracy_v1100_mgf.tsv`,
`denovo_peptide_accuracy_v1100_mgf.tsv`, `denovo_rank_curves_v1100_mgf.tsv`, `denovo_runtime_v1100_mgf.tsv`. Every
tool now reads the same spectra, including the 20,000-spectrum PXD076528 subsample; all metrics equal the `_v190`
tables (tags from MGF and mzML are identical), only the PXD076528 FASTag runtime row now covers 20,000 spectra.

## Species identification (`fastag-bench species-run` / `species-score`, Figure 6)

`config/species_runs.tsv` lists 48 public runs (37 PXD projects): 24 runs with two or more known genera
(mixtures, the PXD028735 human/yeast/E. coli series, the PXD046460 Thauera/Pseudomonas series, human/mouse
xenografts and co-cultures, the SIHUMIx community) and 24 single-organism runs (11 of the 48 have ion-trap MS2). `results/species_datasets.tsv`
gives the composition and its source for each project. `config/species_universe.txt` lists the 50 genera of the
bundled index; a genus outside it cannot be called by FASTag and is reported as `out_of_index`.

Per run, on one node (spock, 224 logical CPUs, 2.2 TB RAM):

```bash
fastag-bench species-run --work runs --fastag <bundle>/FASTag --sage <sage-0.14.7> \
  --sage-fasta ref50.fasta --unipept <unipept> --threads 48 --jobs 4 --scratch /scratch/$USER/in
fastag-bench species-run --work runs --fastag <bundle>/FASTag --steps timing --threads 32 --reps 3 \
  --scratch /scratch/$USER/in --jobs 1          # sequential, load-gated wall times (run alone)
fastag-bench species-score --work runs --results results
python3 scripts/species_index_stats.py --taxdir <bundle>/share-FASTag-taxonomy --out results/species_index.tsv
python3 scripts/fig_6_species.py                 # 1.9.0 tables (species_*_v190.tsv); --suffix '' for 1.8.0
```

- **FASTag** 1.8.0 release bundle (unsuffixed tables) and 1.9.0 release bundle (`species_*_v190.tsv`; same args,
  node data, `--jobs 2`; Sage and Unipept reused) with its bundled index (identical in both bundles) (`share-FASTag-taxonomy/tax_k7.taxdb`, sha256
  `34427bba...`): `-extension 2 -species` (the public gate case), plus `-fixed_modifications` for TMT/TMTpro and
  MMTS runs and `-fragment_tolerance 0.3 Da` when the MS2 filter strings are ion trap (`ITMS`). Three arms: default,
  `-species_deconvolve`, `-species_use_gapped`.
- **Sage** v0.14.7 (GitHub release binary) against the 50 reference proteomes of the index (UniProt reference
  proteomes for the same taxids, fetched 2026-10-29; 589,010 entries, `ref50.fasta`, sha256 `2bc7295c...`), trypsin,
  2 missed cleavages, 10 ppm precursor, 20 ppm or 0.5 Da fragment, decoys generated. Peptides for Unipept: target,
  spectrum q <= 0.01 and peptide q <= 0.01, modifications removed, length >= 5, unique.
- **Unipept** CLI 4.2.2 (UniProt 2026.02), `pept2lca -e -a` (I = L, full lineage), web service.

Decision rules, fixed before scoring, at NCBI genus level: `fastag_q` = FASTag's background test, q <= 0.01;
`fastag_dec` = `-species_deconvolve` evidence share (adjusted / sum over genera) >= 1%; `unipept` = share of
genus-resolved peptides >= 1% and >= 3 peptides. Negatives are the other index genera, minus the reagent and
contaminant genera of the index (Bos, Sus, Oryctolagus, Ovis, Equus) and minus Homo in non-human samples
(keratin). `species_sweep.tsv` gives sensitivity and specificity over a threshold sweep of both share scores.

## Thread ladder (`scripts/ladder/`, Figures 4 and 5)

Run on IBMI node `kim` (2 x AMD EPYC 9654, 384 logical CPUs, 2.27 TB RAM, inputs on node-local
NVMe) from 2026-11-03T19:51Z to 2026-11-04T04:29Z with the FASTag 1.8.0 release bundle and DirecTag
1.4.21142 (bioconda `bumbershoot`, native x86-64).

- `prep_vendor.sh`, `prep_mzpeak.sh`, `chain*.sh`: untimed input preparation (ThermoRawFileParser
  2.0.0 for PXD076528; 7z + `mzpeak-convert 0.18.0 --to mzml` for PXD054073; `mzpeak-convert
  0.18.0 --layout point|chunked` for every mzML). `patch_count.py` and `patch_cv.py` write
  equal-length header copies (PXD028735 `spectrumList count="0"`; three post-2012 CV accessions that
  DirecTag refuses in PXD076528). `results/ladder_inputs_v180.tsv` lists bytes and sha256 of every input.
- `build_plans.sh` + `make_plan.py`: the 524 runs (rep -> threads -> format order); `ladder_run.sh`
  runs a plan: it waits until the 1-minute load and the running threads on the node are below
  GATE x 384, records both before and after, runs under `/usr/bin/time -v` with `FASTAG_TIMING=1`,
  stores wall, CPU, peak RSS, phase times, tag count and the sha256 of the tag file, and deletes the
  output. `run_all.sh`/`go.sh` run all plans; `resume_plans.py` drops finished rows after a restart.
- `mem_run.sh` + `memsample.py` (`mem_go.sh`, `mem_fix_go.sh`): memory re-measurement of the 1.9.0
  ladder cells (default profile, PXD003531/PXD076528/PXD047793, 1-384 threads, 2 repetitions; matched
  profile on PXD047793, 1-384 threads, 2 repetitions; DirecTag at 1 and 32 threads once, at 64 and 384
  threads twice) with the same gate and command lines; each run samples `/proc/<pid>/status` VmRSS
  every 50 ms (5 ms in five interval-check runs) next to `ru_maxrss` and writes
  `results/memory_sampled_v190.tsv` (see `MEMORY-190.md`).
- `python -m fastag_bench.ladder RAW --ncpu 384 --gate 0.25 --corrections results/ladder_corrections_v180.tsv --out results`
  writes `ladder_raw/summary/identity/directag_status/outspectra_v180.tsv`;
  `scripts/fig_4_speed_scaling_memory.py` and `scripts/fig_5_input_formats.py` draw the figures.

Large inputs (PXD054073, PXD028735, PXD047793) ran 1 and 2 threads on mzML only, once; every other
cell has 3 repetitions. The raw copy and logs are in `/ceph/ibmi/abi/oliver/jpr-bench/ladder/`.

**FASTag 1.9.0 ladder (`ladder_*_v190.tsv`, the article's).** Same node, inputs (`ladder_inputs_v180.tsv`),
runner and the same 486 FASTag rows of the 1.8.0 plans in the same order (`plans_v190/`, run by
`run_all_v190.sh` with `FASTAG=/ceph/ibmi/abi/oliver/opt/fastag-1.9.0/FASTag/FASTag` and `GATE=0.05`),
2026-11-04T04:34Z to 13:14Z; raw copy, logs and progress log in `/ceph/ibmi/abi/oliver/jpr-bench/ladder-v190/`.
DirecTag was not re-run (same build, same inputs); its 38 rows are taken from the 1.8.0 raw table:

```bash
python -m fastag_bench.ladder res_v190/raw.tsv --reuse directag=res/raw.tsv --suffix v190 \
    --ncpu 384 --gate 0.25 --corrections results/ladder_corrections_v180.tsv --out results --prov ...
python3 scripts/fig_4_speed_scaling_memory.py --suffix v190   # '' renders the 1.8.0 ladder
python3 scripts/fig_5_input_formats.py --suffix v190
```

The column `origin` of `ladder_raw_v190.tsv` names the raw table of each row. One 1.9.0 run (PXD047793 chunked,
64 threads, rep 2) fails the 0.25 gate on foreign threads after the run and is left out (n = 2 in that cell).
Peak RSS (`maxrss_kb`, `rss_mb_*`) is `ru_maxrss` from `/usr/bin/time -v`; on kim's Linux 6.8 it under-reports
multithreaded peaks (see "Runtime analysis of PXD047793"), so the ladder memory values are lower bounds.

## Paired statistics (`scripts/stats_paired.py`)

```bash
# on a node that holds the accuracy run directories (FASTag 1.9.0 run dirs; DirecTag, Sage, Comet run dirs)
python3 scripts/stats_paired.py export --fastag-work <accuracy>/work-v190 --directag-work <accuracy>/work \
    --data-dir <data> --datasets datasets.yaml --out results/accuracy_pairs_v190.tsv.gz
# anywhere, from results/ only
python3 scripts/stats_paired.py stats
```

- `accuracy_pairs_v190.tsv.gz`: one row per ground-truth PSM spectrum, truth (Sage; Mascot for PXD000001;
  Comet for PXD003531 and PXD001819) and tag length, with FASTag's and DirecTag's outcome at matched
  settings (tagged; rank-1 tag correct; any of the top 10 correct; flank rule).
- `stats_accuracy_paired_v190.tsv`: exact two-sided McNemar test on the discordant spectra, Holm-adjusted
  across datasets within each (truth, tag length, metric, scope) family, and the FASTag - DirecTag difference
  with a 95% bootstrap CI that resamples peptides (2,000 draws, seed 20261104). Scope `both_tagged` is the
  rank-1 precision comparison; `all_psm` counts an untagged spectrum as not correct.
- `stats_runlevel_v190.tsv`: protease (shipped and prose-auto models), label (termini rule, and with the
  mass-gap SILAC call) and alkylation calls against SDRF truth, per subset (`all`, `validation`,
  `independent_nontryptic`, `submitter_sdrf`): accuracy with a no-call counted as wrong, accuracy among
  called runs, coverage, the majority-class baseline on the same runs, balanced accuracy, and per class the
  recall with a 95% Wilson interval and the run and PXD counts.

## Runtime analysis of PXD047793 (`results/runtime_pxd047793_v190.tsv`)

One diaTracer 2.2.1 pseudo-MS2 mzML of PXD047793 (3,086,644 spectra, 24.7 GB) and the PXD003531 Q Exactive
mzML as contrast, on ibminode05 (1 x AMD EPYC 7763, 128 logical CPUs, node-local NVMe, warm page cache unless
stated), serial and load-gated runs, FASTag 1.9.0 and 1.8.0 release bundles and DirecTag 1.4.21142
(`LC_ALL=C`) at matched settings, median of 3 unless the row says n = 1. Phase times of DirecTag come from
time stamps on its own log lines; FASTag phases from `FASTAG_TIMING=1`; profiles from gdb stack sampling
(`perf` is not permitted on the node). Exact peak RSS is the maximum of `/proc/<pid>/status` VmRSS sampled
every 0.5 s; `ru_maxrss` (`/usr/bin/time -v`) is given beside it because Linux 6.2 and later fold per-CPU RSS
counters into it only in batches, which hides up to max(32, 2 x CPUs) pages per CPU.

## 1.8.0 baseline tables

These tables describe FASTag 1.8.0 (tag `v1.8.0`) or an older build. They are kept unchanged so that the
1.8.0 to 1.9.0 differences (`regression_v180_vs_v190.tsv`,
`digest_calls_v180_vs_v190.tsv`) can be checked. None of them is used in the article (the 1.9.0 ladder reuses
the DirecTag rows of the 1.8.0 raw ladder table and reads `ladder_inputs_v180.tsv` and `ladder_corrections_v180.tsv`).

- 1.8.0 pass: `tag_accuracy_*_v180.tsv`, `gap_penalty_pxd000001_v180.tsv`, `peak_budget_pxd000001_v180.tsv`,
  `digest_calls_v180.tsv`, `digest_calls_nontryptic_v180.tsv`, `digest_runtime_v180.tsv`,
  `gate_smoke_times_v180.tsv`, and the unsuffixed `species_*.tsv`, `denovo_*.tsv`, `table_s3_digest_truth.tsv`,
  `fig7_*.tsv` (the `_v190` file of the same name supersedes each of them).
- Thread ladder, 1.8.0 (superseded by `ladder_*_v190.tsv`): `ladder_*_v180.tsv`.
- History only (pre-port builds, 1.6.1-1.7.0, RC 71a68e0): `directag_accuracy_pxd000001.tsv`,
  `directag_runtime_memory.tsv`, `gap_penalty_pxd000001.tsv`, `peak_budget_pxd000001.tsv`,
  `decode_threads_v170.tsv`, `regression_pxd003531_v161_vs_v170.tsv`, `gate_smoke_times.tsv`,
  `digest_calls_rc71a68e0.tsv`, `digest_calls_rc_vs_v180.tsv`, `digest_status_changed_rc_vs_v180.tsv`,
  `digest_val_runs.tsv`, `digest_val_layer2.json`, `benchmark/`.

<!-- inventory:start -->

## Table and figure index

Generated by `python3 scripts/readme_inventory.py` (do not edit by hand). Version: the FASTag release the table describes (`pre-port` = before 1.7.0, not valid for 1.8.0 speed). Source: the first `#` line of the file; the full provenance and conditions are in the file header.

### Result tables (`results/`)

| file | FASTag | figure | source |
|---|---|---|---|
| `ablation_v190.tsv` | 1.9.0 | table only | source: fastag-bench 1.9.0 scripts/ablation_v190.py (one-setting-at-a-time ablation, matched -> default and default -> matched); host data (224 logical CPUs)... |
| `accuracy/` | 1.8.0 | table only | directory, 42 files |
| `accuracy_pairs_v190.tsv.gz` | 1.8.0 | table only |  |
| `benchmark/` | 1.8.0 | fig_tag_precision | directory, 12 files |
| `decode_threads_v170.tsv` | 1.7.0 | fig_decode_threads | source: work/BACKLOG.md 'Measured 2026-11-03' (FASTag 1.7.0, PXD003531 point mzPeak, 64 FASTag threads, node data); values given as ranges in the source; no ... |
| `denovo_peptide_accuracy.tsv` | 1.8.0 | fig_3_denovo_reference | source: fastag-bench denovo score (python -m fastag_bench.denovo config/denovo-data.yaml); runs under /ceph/ibmi/abi/oliver/jpr-bench/denovo/runs; host data;... |
| `denovo_peptide_accuracy_v1100_mgf.tsv` | 1.10.0 | table only | source: fastag-bench denovo score (python -m fastag_bench.denovo config/denovo-data-v1100-mgf.yaml); FASTag 1.10.0 runs on the comparator MGFs under /scratch... |
| `denovo_peptide_accuracy_v190.tsv` | 1.9.0 | fig_3_denovo_reference_v190 | source: fastag-bench denovo score (python -m fastag_bench.denovo config/denovo-data-v190.yaml); FASTag 1.9.0 runs under /scratch/kohlbach/denovo/fastag_v190 ... |
| `denovo_rank_curves.tsv` | 1.8.0 | fig_tag_precision | source: fastag-bench denovo score (python -m fastag_bench.denovo config/denovo-data.yaml); runs under /ceph/ibmi/abi/oliver/jpr-bench/denovo/runs; host data;... |
| `denovo_rank_curves_v1100_mgf.tsv` | 1.10.0 | table only | source: fastag-bench denovo score (python -m fastag_bench.denovo config/denovo-data-v1100-mgf.yaml); FASTag 1.10.0 runs on the comparator MGFs under /scratch... |
| `denovo_rank_curves_v190.tsv` | 1.9.0 | table only | source: fastag-bench denovo score (python -m fastag_bench.denovo config/denovo-data-v190.yaml); FASTag 1.9.0 runs under /scratch/kohlbach/denovo/fastag_v190 ... |
| `denovo_runtime.tsv` | 1.8.0 | table only | source: fastag-bench denovo score (python -m fastag_bench.denovo config/denovo-data.yaml); runs under /ceph/ibmi/abi/oliver/jpr-bench/denovo/runs; host data;... |
| `denovo_runtime_v1100_mgf.tsv` | 1.10.0 | table only | source: fastag-bench denovo score (python -m fastag_bench.denovo config/denovo-data-v1100-mgf.yaml); FASTag 1.10.0 runs on the comparator MGFs under /scratch... |
| `denovo_runtime_v190.tsv` | 1.9.0 | table only | source: fastag-bench denovo score (python -m fastag_bench.denovo config/denovo-data-v190.yaml); FASTag 1.9.0 runs under /scratch/kohlbach/denovo/fastag_v190 ... |
| `denovo_tag_accuracy.tsv` | 1.8.0 | fig_3_denovo_reference | source: fastag-bench denovo score (python -m fastag_bench.denovo config/denovo-data.yaml); runs under /ceph/ibmi/abi/oliver/jpr-bench/denovo/runs; host data;... |
| `denovo_tag_accuracy_v1100_mgf.tsv` | 1.10.0 | table only | source: fastag-bench denovo score (python -m fastag_bench.denovo config/denovo-data-v1100-mgf.yaml); FASTag 1.10.0 runs on the comparator MGFs under /scratch... |
| `denovo_tag_accuracy_v190.tsv` | 1.9.0 | fig_3_denovo_reference_v190 | source: fastag-bench denovo score (python -m fastag_bench.denovo config/denovo-data-v190.yaml); FASTag 1.9.0 runs under /scratch/kohlbach/denovo/fastag_v190 ... |
| `difftest_layer1_v180_vs_v190.tsv` | 1.8.0 vs 1.9.0 | table only | source: prose-auto 0.1.3 differential test, node data, work dirs /scratch/kohlbach/fastag-digest-val-v180rel/w (FASTag 1.8.0 release bundle) and /scratch/koh... |
| `difftest_layer2_v180_vs_v190.tsv` | 1.8.0 vs 1.9.0 | table only | source: prose-auto 0.1.3 differential test, node data, work dirs /scratch/kohlbach/fastag-digest-val-v180rel/w (FASTag 1.8.0 release bundle) and /scratch/koh... |
| `digest_calls_nontryptic_v180.tsv` | 1.8.0 | table only | source: data:/ceph/ibmi/abi/oliver/jpr-bench/sdrf/nontryptic/reports (nt_reports.tgz), FASTag 1.8.0 release bundle /ceph/ibmi/abi/oliver/opt/fastag-1.8.0/FAS... |
| `digest_calls_nontryptic_v190.tsv` | 1.9.0 | table only | source: data:/ceph/ibmi/abi/oliver/jpr-bench/sdrf/nontryptic/reports_v190 (nt_reports_v190.tgz), FASTag 1.9.0 release bundle /ceph/ibmi/abi/oliver/opt/fastag... |
| `digest_calls_rc71a68e0.tsv` | 1.8.0 RC | table only | source: data:/ceph/ibmi/abi/oliver/fastag-digest-val/reports.tgz, FASTag 1.8.0 RC 71a68e0 (pre-release validation build), same options as digest_calls_v180.tsv |
| `digest_calls_rc_vs_v180.tsv` | 1.8.0 RC vs 1.8.0 | table only | source: digest_calls_rc71a68e0.tsv vs digest_calls_v180.tsv (244 runs) |
| `digest_calls_v180.tsv` | 1.8.0 | table only | source: data:/ceph/ibmi/abi/oliver/jpr-bench/sdrf/rerun180/ (rerun180_reports.tgz), FASTag 1.8.0 release bundle /ceph/ibmi/abi/oliver/opt/fastag-1.8.0/FASTag... |
| `digest_calls_v180_vs_v190.tsv` | 1.8.0 vs 1.9.0 | table only | source: digest_calls_v180.tsv + digest_calls_nontryptic_v180.tsv vs digest_calls_v190.tsv + digest_calls_nontryptic_v190.tsv (254 runs; script compare_digest... |
| `digest_calls_v190.tsv` | 1.9.0 | table only | source: data:/ceph/ibmi/abi/oliver/jpr-bench/sdrf/rerun190/ (rerun190_reports.tgz), FASTag 1.9.0 release bundle /ceph/ibmi/abi/oliver/opt/fastag-1.9.0/FASTag... |
| `digest_nontryptic_runs.tsv` | 1.8.0 | table only | source: non-tryptic public runs added for Figure 7 (open issue 6), chosen from bigbio/sdrf-annotated-datasets by SDRF cleavage agent (single non-tryptic enzy... |
| `digest_runtime_v180.tsv` | 1.8.0 | fig_digest_overhead | source: data:/ceph/ibmi/abi/oliver/fastag-digest-val/runtime.tsv + runtime.py (FASTag 1.8.0 RC 71a68e0, same source as v1.8.0) |
| `digest_runtime_v190.tsv` | 1.9.0 | fig_digest_overhead_v190 | source: ibminode05:/ceph/ibmi/abi/oliver/jpr-bench/timing_v190_ibminode05/digest_runtime_v190.tsv + digest_rt_v190.py (replay of data:/ceph/ibmi/abi/oliver/f... |
| `digest_runtime_v190_commands.tsv` | see source | table only | source: paired commands for the digest/label/mass-gap runtime overhead with FASTag 1.9.0 (protocol of digest_runtime_v180.tsv: data:/ceph/ibmi/abi/oliver/fas... |
| `digest_status_changed_rc_vs_v180.tsv` | 1.8.0 RC vs 1.8.0 | table only | source: digest_calls_rc71a68e0.tsv vs digest_calls_v180.tsv |
| `digest_val_layer2.json` | 1.8.0 | table only | JSON record |
| `digest_val_runs.tsv` | 1.8.0 RC | fig_digest_confusion | source: data:/ceph/ibmi/abi/oliver/fastag-digest-val/layer2.json, exported to output/jpr-paper/digest-val-runs.tsv (FASTag 1.8.0 RC 71a68e0 vs prose-auto 0.1.3) |
| `directag_accuracy_pxd000001.tsv` | pre-port | fig_directag_accuracy | source: FASTag repo origin/main doc/BENCHMARK-DirecTag.md (measured 2026-09-07, FASTag 1.2.x pre-port; DirecTag 1.4.21142) |
| `directag_accuracy_pxd000001_v190.tsv` | 1.9.0 | fig_directag_accuracy_v190 | source: results/tag_accuracy_topk_v190.tsv (fastag-bench accuracy, scored 2026-11-04T03:34:34+01:00); profiles fastag_matched (FASTag 1.9.0, /ceph/ibmi/abi/o... |
| `directag_runtime_memory.tsv` | pre-port | fig_directag_runtime | sources: repo doc/BENCHMARK-DirecTag.md (PXD000001, PXD076528, PXD054073; x86-64 emulation on Apple silicon, FASTag 1.2.x) and output/knowledge/fastag-doc-v1... |
| `fig7_confusion.tsv` | 1.8.0 | fig_digest_sdrf | source: sdrf_truth_runs.tsv (source: SDRF files under sdrf/ (see sources.tsv: source: community SDRFs from github.com/bigbio/sdrf-annotated-datasets commit 7... |
| `fig7_confusion_v190.tsv` | 1.9.0 | fig_digest_sdrf_v190 | source: sdrf_truth_runs.tsv (source: SDRF files under sdrf/ (see sources.tsv: source: community SDRFs from github.com/bigbio/sdrf-annotated-datasets commit 7... |
| `fig7_digest_summary.tsv` | 1.8.0 | table only | source: sdrf_truth_runs.tsv (source: SDRF files under sdrf/ (see sources.tsv: source: community SDRFs from github.com/bigbio/sdrf-annotated-datasets commit 7... |
| `fig7_digest_summary_v190.tsv` | 1.9.0 | table only | source: sdrf_truth_runs.tsv (source: SDRF files under sdrf/ (see sources.tsv: source: community SDRFs from github.com/bigbio/sdrf-annotated-datasets commit 7... |
| `gap_penalty_pxd000001.tsv` | pre-port | fig_gap_penalty | source: output/knowledge/fastag-doc-v1.4.3/doc/BACKLOG.md (-gap_penalty validation, pre-1.4); PXD000001, 2,254 Mascot PSMs at 1% FDR, -tag_length 4 -gaps 1; ... |
| `gap_penalty_pxd000001_v180.tsv` | 1.8.0 | fig_gap_penalty_v180, fig_tag_accuracy | source: fastag-bench 0.1.0 accuracy sweep gap_penalty: PXD000001 (PXD000001_Erwinia_TMT6); host ibminode05 (128 logical CPUs); 2026-11-03T21:09:48+01:00 |
| `gap_penalty_pxd000001_v190.tsv` | 1.9.0 | fig_gap_penalty_v190, fig_tag_accuracy_v190 | source: fastag-bench 0.1.0 accuracy sweep gap_penalty: PXD000001 (PXD000001_Erwinia_TMT6); host ibminode05 (128 logical CPUs); 2026-11-04T03:30:21+01:00 |
| `gate_refs_v190.tsv` | 1.9.0 | table only | source: data:/ceph/ibmi/abi/oliver/fastag-gate/refs/<case>.digest.v1.9.0 (references written 2026-11-04 with gate.sh --refs from FASTag 1.9.0 /ceph/ibmi/abi/... |
| `gate_smoke_times.tsv` | 1.6.1/1.8.0 | fig_gate_times | source: data:/ceph/ibmi/abi/oliver/fastag-gate/refs/cases.tsv (v1.6.1 refs, 32 threads, load ~194) and data:/scratch/kohlbach/fastag-digest/gate_c.log (1.8.0... |
| `gate_smoke_times_runs_v190.tsv` | 1.9.0 | table only | source: data:/ceph/ibmi/abi/oliver/jpr-bench/gate-v190/<run>/{results.tsv,BINARY.txt,<case>/run.log} (hot copies data:/scratch/kohlbach/gate-v190/); runners ... |
| `gate_smoke_times_v180.tsv` | 1.8.0 | table only | source: data:/ceph/ibmi/abi/oliver/jpr-bench/gate-v190/{pair_r1..r6_v180,v180}/results.tsv and <case>/run.log; runners run.sh, run_fix.sh beside them; gate d... |
| `gate_smoke_times_v190.tsv` | 1.9.0 | fig_gate_times_v190 | source: data:/ceph/ibmi/abi/oliver/jpr-bench/gate-v190/{pair_r1..r6_v180,pair_r1..r6_v190,v180,v190_r1,v190_r2,v190_verify}/results.tsv and <case>/run.log (p... |
| `ladder_corrections_v180.tsv` | 1.8.0 | table only | source: follow-up run kim:/scratch/kohlbach/ladder/followup (KEEP_OUT=1, same command, 2026-11-04T04:35Z): GNU time 'Command terminated by signal 11' with 'E... |
| `ladder_directag_status_v180.tsv` | 1.8.0 | fig4_speed_scaling_memory | source: kim:/scratch/kohlbach/ladder/res/raw.tsv (copy: /ceph/ibmi/abi/oliver/jpr-bench/ladder/raw.tsv), runner scripts/ladder/ladder_run.sh, plans scripts/l... |
| `ladder_directag_status_v190.tsv` | 1.9.0 | fig4_speed_scaling_memory_v190 | source: FASTag rows kim:/scratch/kohlbach/ladder/res_v190/raw.tsv (copy with logs/, progress.log: /ceph/ibmi/abi/oliver/jpr-bench/ladder-v190/), runner scrip... |
| `ladder_identity_v180.tsv` | 1.8.0 | table only | source: kim:/scratch/kohlbach/ladder/res/raw.tsv (copy: /ceph/ibmi/abi/oliver/jpr-bench/ladder/raw.tsv), runner scripts/ladder/ladder_run.sh, plans scripts/l... |
| `ladder_identity_v190.tsv` | 1.9.0 | table only | source: FASTag rows kim:/scratch/kohlbach/ladder/res_v190/raw.tsv (copy with logs/, progress.log: /ceph/ibmi/abi/oliver/jpr-bench/ladder-v190/), runner scrip... |
| `ladder_inputs_v180.tsv` | 1.8.0 | fig4_speed_scaling_memory, fig4_speed_scaling_memory_v190, fig5_input_formats, fig5_input_formats_v190 | source: kim:/scratch/kohlbach/ladder/in/inputs_sha.tsv (stat + sha256sum, 2026-11-03), copy in /ceph/ibmi/abi/oliver/jpr-bench/ladder/ |
| `ladder_outspectra_v180.tsv` | 1.8.0 | fig5_input_formats | source: kim:/scratch/kohlbach/ladder/res/raw.tsv (copy: /ceph/ibmi/abi/oliver/jpr-bench/ladder/raw.tsv), runner scripts/ladder/ladder_run.sh, plans scripts/l... |
| `ladder_outspectra_v190.tsv` | 1.9.0 | fig5_input_formats_v190 | source: FASTag rows kim:/scratch/kohlbach/ladder/res_v190/raw.tsv (copy with logs/, progress.log: /ceph/ibmi/abi/oliver/jpr-bench/ladder-v190/), runner scrip... |
| `ladder_raw_v180.tsv` | 1.8.0 | fig5_input_formats, fig_s1_thread_identity | source: kim:/scratch/kohlbach/ladder/res/raw.tsv (copy: /ceph/ibmi/abi/oliver/jpr-bench/ladder/raw.tsv), runner scripts/ladder/ladder_run.sh, plans scripts/l... |
| `ladder_raw_v190.tsv` | 1.9.0 | fig5_input_formats_v190, fig_s1_thread_identity_v190 | source: FASTag rows kim:/scratch/kohlbach/ladder/res_v190/raw.tsv (copy with logs/, progress.log: /ceph/ibmi/abi/oliver/jpr-bench/ladder-v190/), runner scrip... |
| `ladder_summary_v180.tsv` | 1.8.0 | fig4_speed_scaling_memory, fig5_input_formats | source: kim:/scratch/kohlbach/ladder/res/raw.tsv (copy: /ceph/ibmi/abi/oliver/jpr-bench/ladder/raw.tsv), runner scripts/ladder/ladder_run.sh, plans scripts/l... |
| `ladder_summary_v190.tsv` | 1.9.0 | fig4_speed_scaling_memory_v190, fig5_input_formats_v190 | source: FASTag rows kim:/scratch/kohlbach/ladder/res_v190/raw.tsv (copy with logs/, progress.log: /ceph/ibmi/abi/oliver/jpr-bench/ladder-v190/), runner scrip... |
| `llm_commits_v190.tsv` | 1.9.0 | table only | source: scripts/llm_commit_stats.py on git log v1.9.0 (commit 153bd23fed242e41b48817374372918fcac3f878) of the FASTag repository; commits: 443, of which 38 m... |
| `longtag_v190/` | 1.9.0 | table only | directory, 26 files |
| `massgap_absent_v190.tsv` | 1.9.0 | fig_s3_report_flow_v190 | source: prose-auto 0.1.3 v9d run logs /ceph/ibmi/abi/oliver/prose-auto-20261029/<set>_v9d/out/<PXD>/auto/run.log on node data, via the inventory /ceph/ibmi/a... |
| `memory_sampled_v190.tsv` | 1.9.0 | table only | source: kim:/scratch/kohlbach/ladder/memv190/res_main/raw.tsv (90 runs), res_fix/raw.tsv (18 runs, repair 2026-11-04: DirecTag at 64/384 threads and FASTag m... |
| `peak_budget_pxd000001.tsv` | pre-port | fig_peak_budget | source: output/knowledge/fastag-doc-v1.4.3/doc/BACKLOG.md (peak-cap defaults, v0.13); PXD000001, 2,254 Mascot PSMs, TL 4 -gaps 1; wall times from that build,... |
| `peak_budget_pxd000001_v180.tsv` | 1.8.0 | fig_peak_budget_v180, fig_tag_accuracy | source: fastag-bench 0.1.0 accuracy sweep peak_budget: PXD000001 (PXD000001_Erwinia_TMT6); host ibminode05 (128 logical CPUs); 2026-11-03T21:14:42+01:00 |
| `peak_budget_pxd000001_v190.tsv` | 1.9.0 | fig_peak_budget_v190, fig_tag_accuracy_v190 | source: fastag-bench 0.1.0 accuracy sweep peak_budget: PXD000001 (PXD000001_Erwinia_TMT6); host ibminode05 (128 logical CPUs); 2026-11-04T03:32:48+01:00 |
| `ranksum_range_v190.tsv` | 1.9.0 | table only | source: scripts/ranksum_range.py on FASTag 1.9.0 include/FASTag/ranksum.h (commit 153bd23, ranksumCdfs); host MacBook Pro, Apple M4 Max, macOS 26.6.2; Apple ... |
| `regression_pxd003531_v161_vs_v170.tsv` | 1.6.1 vs 1.7.0 | fig_memory_threads, fig_thread_scaling | source: data:/scratch/kohlbach/fastag-omsdev/regress/results.tsv (raw rows, copied 2026-11-03; script regress.sh beside it) |
| `regression_v180_vs_v190.tsv` | 1.8.0 vs 1.9.0 | table only | source: data:/ceph/ibmi/abi/oliver/jpr-bench/gate-v190/regcmp_v180_vs_v190.tsv, made by regcmp.py beside it from the gate outputs v180/<case>/ and v190_r1/<c... |
| `runtime_pxd047793_v190.tsv` | 1.9.0 | table only | source: ibminode05:/scratch/kohlbach/rt047793 (raw.tsv, runs/, prof/, baseline.tsv, rescan.tsv); copy in /ceph/ibmi/abi/oliver/jpr-bench/runtime-pxd047793/; ... |
| `sdrf/` | 1.8.0 | table only | directory, 258 files |
| `sdrf_truth_runs.tsv` | 1.8.0 | table only | source: SDRF files under sdrf/ (see sources.tsv: source: community SDRFs from github.com/bigbio/sdrf-annotated-datasets commit 70bd3534b73ad336bd6db2d0a4c17f... |
| `search_configs.tsv` | 1.8.0 | table only | source: comparator configurations as run, copied from data:/ceph/ibmi/abi/oliver/jpr-bench/accuracy/work/runs/<dataset>/{sage/default/sage.json,comet/default... |
| `species_agreement.tsv` | 1.8.0 | fig6_species | source: /ceph/ibmi/abi/oliver/jpr-bench/species/runs (fastag-bench species-score) |
| `species_agreement_v190.tsv` | 1.9.0 | fig6_species_v190 | source: /ceph/ibmi/abi/oliver/jpr-bench/species/runs_v190 (fastag-bench species-score) |
| `species_datasets.tsv` | 1.8.0 | table only | source: PRIDE Archive API v3 project metadata (resolved 2026-11-03) and the dataset publications (PubMed/PMC, read 2026-11-03) |
| `species_fastag_timing.tsv` | 1.8.0 | table only | source: /ceph/ibmi/abi/oliver/jpr-bench/species/runs (fastag-bench species-score) |
| `species_fastag_timing_v190.tsv` | 1.9.0 | table only | source: ibminode05:/ceph/ibmi/abi/oliver/jpr-bench/timing_v190_ibminode05/{species_fastag_timing_v190.tsv,species_fastag_timing_v190_supp.tsv} written by spe... |
| `species_genus_calls.tsv` | 1.8.0 | fig6_species, fig_s2_species_ranks | source: /ceph/ibmi/abi/oliver/jpr-bench/species/runs (fastag-bench species-score) |
| `species_genus_calls_v190.tsv` | 1.9.0 | fig6_species_v190, fig_s2_species_ranks_v190 | source: /ceph/ibmi/abi/oliver/jpr-bench/species/runs_v190 (fastag-bench species-score) |
| `species_index.tsv` | 1.8.0 | table only | source: /ceph/ibmi/abi/oliver/opt/fastag-1.8.0/FASTag/share-FASTag-taxonomy/tax_k7.taxdb (FASTag 1.8.0 release bundle, share-FASTag-taxonomy); sha256 34427bb... |
| `species_index_v190.tsv` | 1.9.0 | table only | source: /ceph/ibmi/abi/oliver/opt/fastag-1.9.0/FASTag/share-FASTag-taxonomy/tax_k7.taxdb (FASTag 1.9.0 release bundle, share-FASTag-taxonomy; scripts/species... |
| `species_metrics.tsv` | 1.8.0 | fig6_species | source: /ceph/ibmi/abi/oliver/jpr-bench/species/runs (fastag-bench species-score) |
| `species_metrics_v190.tsv` | 1.9.0 | fig6_species_v190 | source: /ceph/ibmi/abi/oliver/jpr-bench/species/runs_v190 (fastag-bench species-score) |
| `species_pxd003531_gate.tsv` | 1.6.1/1.8.0 | fig_species_gate | source: data:/ceph/ibmi/abi/oliver/fastag-gate/refs/out/species/species.tsv (FASTag 1.6.1 refs; byte-identical in 1.8.0, gate PASS) |
| `species_pxd003531_gate_v190.tsv` | 1.9.0 | fig_species_gate_v190 | source: data:/ceph/ibmi/abi/oliver/jpr-bench/gate-v190/v190_r1/species/species.tsv (= refs/out-v1.9.0/species/species.tsv; sha256 012e2858..., identical in v... |
| `species_runs.tsv` | 1.8.0 | fig6_species, fig_s2_species_ranks | source: /ceph/ibmi/abi/oliver/jpr-bench/species/runs (fastag-bench species-score) |
| `species_runs_v190.tsv` | 1.9.0 | fig6_species_v190, fig_s2_species_ranks_v190 | source: /ceph/ibmi/abi/oliver/jpr-bench/species/runs_v190 (fastag-bench species-score) |
| `species_sweep.tsv` | 1.8.0 | fig6_species | source: /ceph/ibmi/abi/oliver/jpr-bench/species/runs (fastag-bench species-score) |
| `species_sweep_v190.tsv` | 1.9.0 | fig6_species_v190 | source: /ceph/ibmi/abi/oliver/jpr-bench/species/runs_v190 (fastag-bench species-score) |
| `species_timing.tsv` | 1.8.0 | table only | source: /ceph/ibmi/abi/oliver/jpr-bench/species/runs (fastag-bench species-score) |
| `species_timing_v190.tsv` | 1.9.0 | table only | source: /ceph/ibmi/abi/oliver/jpr-bench/species/runs_v190 (fastag-bench species-score) |
| `species_top1.tsv` | 1.8.0 | table only | source: /ceph/ibmi/abi/oliver/jpr-bench/species/runs (fastag-bench species-score) |
| `species_top1_v190.tsv` | 1.9.0 | table only | source: /ceph/ibmi/abi/oliver/jpr-bench/species/runs_v190 (fastag-bench species-score) |
| `species_truth_ranks.tsv` | 1.8.0 | table only | source: /ceph/ibmi/abi/oliver/jpr-bench/species/runs (fastag-bench species-score) |
| `species_truth_ranks_v190.tsv` | 1.9.0 | table only | source: /ceph/ibmi/abi/oliver/jpr-bench/species/runs_v190 (fastag-bench species-score) |
| `species_v190_commands.tsv` | see source | table only | source: /ceph/ibmi/abi/oliver/jpr-bench/species/results_v190/species_v190_commands.tsv; FASTag 1.9.0 species commands as run by fastag-bench species-run --st... |
| `stats_accuracy_paired_v190.tsv` | 1.9.0 | table only | source: scripts/stats_paired.py stats (2026-11-04T13:21:09+01:00) on accuracy_pairs_v190.tsv.gz |
| `stats_runlevel_v190.tsv` | 1.9.0 | table only | source: scripts/stats_paired.py stats (2026-11-04T13:21:09+01:00) on table_s3_digest_truth_v190.tsv |
| `table_s3_digest_truth.tsv` | 1.8.0 | fig_digest_sdrf, fig_s3_report_flow | source: sdrf_truth_runs.tsv (source: SDRF files under sdrf/ (see sources.tsv: source: community SDRFs from github.com/bigbio/sdrf-annotated-datasets commit 7... |
| `table_s3_digest_truth_v190.tsv` | 1.9.0 | fig_digest_sdrf_v190, fig_s3_report_flow_v190 | source: sdrf_truth_runs.tsv (source: SDRF files under sdrf/ (see sources.tsv: source: community SDRFs from github.com/bigbio/sdrf-annotated-datasets commit 7... |
| `tag_accuracy_by_evalue_v180.tsv` | 1.8.0 | table only | source: fastag-bench 0.1.0 accuracy collect (2026-11-03T21:14:43+01:00): 8 tables |
| `tag_accuracy_by_evalue_v190.tsv` | 1.9.0 | table only | source: fastag-bench 0.1.0 accuracy collect (2026-11-04T03:32:48+01:00): 8 tables |
| `tag_accuracy_by_length_v180.tsv` | 1.8.0 | fig_tag_accuracy | source: fastag-bench 0.1.0 accuracy collect (2026-11-03T21:14:43+01:00): 8 tables |
| `tag_accuracy_by_length_v190.tsv` | 1.9.0 | fig_tag_accuracy_v190 | source: fastag-bench 0.1.0 accuracy collect (2026-11-04T03:32:48+01:00): 8 tables |
| `tag_accuracy_evalue_density_v180.tsv` | 1.8.0 | fig_tag_accuracy | source: fastag-bench 0.1.0 accuracy collect (2026-11-03T21:14:43+01:00): 8 tables |
| `tag_accuracy_evalue_density_v190.tsv` | 1.9.0 | fig_tag_accuracy_v190 | source: fastag-bench 0.1.0 accuracy collect (2026-11-04T03:32:49+01:00): 8 tables |
| `tag_accuracy_overlap_v180.tsv` | 1.8.0 | table only | source: fastag-bench 0.1.0 accuracy collect (2026-11-03T21:14:43+01:00): 2 tables |
| `tag_accuracy_overlap_v190.tsv` | 1.9.0 | table only | source: fastag-bench 0.1.0 accuracy collect (2026-11-04T03:32:49+01:00): 2 tables |
| `tag_accuracy_runs_v180.tsv` | 1.8.0 | table only | source: fastag-bench 0.1.0 accuracy runs from /scratch/kohlbach/jpr-acc/work/timing.tsv (2026-11-03T21:14:43+01:00, host ibminode05) |
| `tag_accuracy_runs_v190.tsv` | 1.9.0 | table only | source: fastag-bench 0.1.0 accuracy runs from /scratch/kohlbach/jpr-acc-v190/work/timing.tsv (2026-11-04T03:32:49+01:00, host ibminode05) |
| `tag_accuracy_summary_v180.tsv` | 1.8.0 | table only | source: fastag-bench 0.1.0 accuracy collect (2026-11-03T21:14:43+01:00): 8 tables |
| `tag_accuracy_summary_v190.tsv` | 1.9.0 | table only | source: fastag-bench 0.1.0 accuracy collect (2026-11-04T03:32:49+01:00): 8 tables |
| `tag_accuracy_topk_v180.tsv` | 1.8.0 | fig_tag_accuracy | source: fastag-bench 0.1.0 accuracy collect (2026-11-03T21:14:43+01:00): 8 tables |
| `tag_accuracy_topk_v190.tsv` | 1.9.0 | fig_tag_accuracy_v190 | source: fastag-bench 0.1.0 accuracy collect (2026-11-04T03:32:49+01:00): 8 tables |
| `xplat_phases12_v190.tsv` | 1.9.0 | table only | source: phase protocol of FASTag 1.9.0 release binaries at 12 threads (FASTAG_TIMING=1 phase timer plus process sampler, about 0.1 s), PXD063151 Proteome_EIF... |
| `xplat_runtime_v190.tsv` | 1.9.0 | table only | source: scripts/xplat_runtime_v190.py from the per-run tables ibminode05/results.tsv, studio/results_macstudio.tsv, flash/results.tsv (results/xplat_v190, re... |
| `xplat_v190/` | 1.9.0 | table only | directory, 6 files |

### Figures (`figures/`, PDF and PNG; `fastag-bench figures` renders all of them)

| figure | script | tables |
|---|---|---|
| `fig4_speed_scaling_memory` | `scripts/fig_4_speed_scaling_memory.py` `--suffix ''` | `ladder_directag_status_v180.tsv`, `ladder_inputs_v180.tsv`, `ladder_summary_v180.tsv` |
| `fig4_speed_scaling_memory_v190` | `scripts/fig_4_speed_scaling_memory.py` `--suffix v190` | `ladder_directag_status_v190.tsv`, `ladder_inputs_v180.tsv`, `ladder_summary_v190.tsv` |
| `fig5_input_formats` | `scripts/fig_5_input_formats.py` `--suffix ''` | `ladder_inputs_v180.tsv`, `ladder_outspectra_v180.tsv`, `ladder_raw_v180.tsv`, `ladder_summary_v180.tsv` |
| `fig5_input_formats_v190` | `scripts/fig_5_input_formats.py` `--suffix v190` | `ladder_inputs_v180.tsv`, `ladder_outspectra_v190.tsv`, `ladder_raw_v190.tsv`, `ladder_summary_v190.tsv` |
| `fig6_species` | `scripts/fig_6_species.py` `--suffix ''` | `species_agreement.tsv`, `species_genus_calls.tsv`, `species_metrics.tsv`, `species_runs.tsv`, `species_sweep.tsv` |
| `fig6_species_v190` | `scripts/fig_6_species.py` `--suffix v190` | `species_agreement_v190.tsv`, `species_genus_calls_v190.tsv`, `species_metrics_v190.tsv`, `species_runs_v190.tsv`, `species_sweep_v190.tsv` |
| `fig_3_denovo_reference` | `scripts/fig_3_denovo_reference.py` `--suffix ''` | `denovo_peptide_accuracy.tsv`, `denovo_tag_accuracy.tsv` |
| `fig_3_denovo_reference_v190` | `scripts/fig_3_denovo_reference.py` `--suffix v190` | `denovo_peptide_accuracy_v190.tsv`, `denovo_tag_accuracy_v190.tsv` |
| `fig_decode_threads` | `scripts/fig_decode_threads.py` | `decode_threads_v170.tsv` |
| `fig_digest_confusion` | `scripts/fig_digest_confusion.py` | `digest_val_runs.tsv` |
| `fig_digest_overhead` | `scripts/fig_digest_overhead.py` `--suffix ''` | `digest_runtime_v180.tsv` |
| `fig_digest_overhead_v190` | `scripts/fig_digest_overhead.py` `--suffix v190` | `digest_runtime_v190.tsv` |
| `fig_digest_sdrf` | `scripts/fig_digest_sdrf.py` `--suffix ''` | `fig7_confusion.tsv`, `table_s3_digest_truth.tsv` |
| `fig_digest_sdrf_v190` | `scripts/fig_digest_sdrf.py` `--suffix v190` | `fig7_confusion_v190.tsv`, `table_s3_digest_truth_v190.tsv` |
| `fig_directag_accuracy` | `scripts/fig_directag_accuracy.py` `--suffix ''` | `directag_accuracy_pxd000001.tsv` |
| `fig_directag_accuracy_v190` | `scripts/fig_directag_accuracy.py` `--suffix v190` | `directag_accuracy_pxd000001_v190.tsv` |
| `fig_directag_runtime` | `scripts/fig_directag_runtime.py` | `directag_runtime_memory.tsv` |
| `fig_gap_penalty` | `scripts/fig_gap_penalty.py` `--suffix ''` | `gap_penalty_pxd000001.tsv` |
| `fig_gap_penalty_v180` | `scripts/fig_gap_penalty.py` `--suffix v180` | `gap_penalty_pxd000001_v180.tsv` |
| `fig_gap_penalty_v190` | `scripts/fig_gap_penalty.py` `--suffix v190` | `gap_penalty_pxd000001_v190.tsv` |
| `fig_gate_times` | `scripts/fig_gate_times.py` `--suffix ''` | `gate_smoke_times.tsv` |
| `fig_gate_times_v190` | `scripts/fig_gate_times.py` `--suffix v190` | `gate_smoke_times_v190.tsv` |
| `fig_memory_threads` | `scripts/fig_memory_threads.py` | `regression_pxd003531_v161_vs_v170.tsv` |
| `fig_peak_budget` | `scripts/fig_peak_budget.py` `--suffix ''` | `peak_budget_pxd000001.tsv` |
| `fig_peak_budget_v180` | `scripts/fig_peak_budget.py` `--suffix v180` | `peak_budget_pxd000001_v180.tsv` |
| `fig_peak_budget_v190` | `scripts/fig_peak_budget.py` `--suffix v190` | `peak_budget_pxd000001_v190.tsv` |
| `fig_s1_thread_identity` | `scripts/fig_s1_thread_identity.py` `--suffix ''` | `ladder_raw_v180.tsv` |
| `fig_s1_thread_identity_v190` | `scripts/fig_s1_thread_identity.py` `--suffix v190` | `ladder_raw_v190.tsv` |
| `fig_s2_species_ranks` | `scripts/fig_s2_species_ranks.py` `--suffix ''` | `species_genus_calls.tsv`, `species_runs.tsv` |
| `fig_s2_species_ranks_v190` | `scripts/fig_s2_species_ranks.py` `--suffix v190` | `species_genus_calls_v190.tsv`, `species_runs_v190.tsv` |
| `fig_s3_report_flow` | `scripts/fig_s3_report_flow.py` `--suffix ''` | `table_s3_digest_truth.tsv` |
| `fig_s3_report_flow_v190` | `scripts/fig_s3_report_flow.py` `--suffix v190` | `massgap_absent_v190.tsv`, `table_s3_digest_truth_v190.tsv` |
| `fig_species_gate` | `scripts/fig_species_gate.py` `--suffix ''` | `species_pxd003531_gate.tsv` |
| `fig_species_gate_v190` | `scripts/fig_species_gate.py` `--suffix v190` | `species_pxd003531_gate_v190.tsv` |
| `fig_tag_accuracy` | `scripts/fig_tag_accuracy.py` `--suffix ''` | `gap_penalty_pxd000001_v180.tsv`, `peak_budget_pxd000001_v180.tsv`, `tag_accuracy_by_length_v180.tsv`, `tag_accuracy_evalue_density_v180.tsv`, `tag_accuracy_topk_v180.tsv` |
| `fig_tag_accuracy_v190` | `scripts/fig_tag_accuracy.py` `--suffix v190` | `gap_penalty_pxd000001_v190.tsv`, `peak_budget_pxd000001_v190.tsv`, `tag_accuracy_by_length_v190.tsv`, `tag_accuracy_evalue_density_v190.tsv`, `tag_accuracy_topk_v190.tsv` |
| `fig_tag_precision` | `scripts/fig_tag_precision.py` | `benchmark`, `denovo_rank_curves.tsv` |
| `fig_thread_scaling` | `scripts/fig_thread_scaling.py` | `regression_pxd003531_v161_vs_v170.tsv` |

<!-- inventory:end -->

## License

MIT, as FASTag (see `LICENSE`). Cite with `CITATION.cff`.
