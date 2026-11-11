# Optional gap-mode benchmark, 2026-11-11

The files at this directory's top level are the **complete primary experiment on dax**: two public datasets × seed lengths 3 and 5 × five arms × three repetitions = 60 successful runs. Each process used 32 threads; processes ran serially in a reproducibly shuffled order. The host has two AMD EPYC 9654 CPUs, 192 physical cores / 384 logical CPUs, and approximately 2.2 TiB RAM. Default affinity was 0–383; cores were not exclusively allocated or manually pinned.

The arms are the unchanged 1.13.1 baseline, the feature build with both options off, modified two-residue gaps, three-residue gaps, and both options. All arms use identical configured modifications, one permitted gap, extension 0, top-50 output, and E-value cutoff 20. No parameters were tuned to improve the new modes.

## Files and interpretation

- `summary.tsv`: counts and rates by dataset, length, arm, correctness rule, and modification cohort. `rank1_accuracy` and `recall50` use **all reference PSM spectra** as their denominator, including spectra without a reported tag. `rank1_precision_tagged` uses only tagged reference spectra.
- `paired_changes.tsv`: spectra gained and lost relative to baseline, separately for rank 1 and recall@50.
- `timing_summary.tsv`: median and full range of wall time, median aggregate CPU time, and observed system load. `timings.jsonl` retains every command, repetition, return code, output hash, wall/CPU time, and load measurement.
- `manifest.json`: input/truth hashes, settings, software versions, original search settings, binary hashes, and harness/scorer hashes.
- `validation.json`, `default_equivalence.json`, and `cross-host-equality.json`: completeness, determinism, unchanged-default, source-hash, and cross-platform checks.
- `provenance/`: original Sage configurations; dax compiler, build, binary/library, hardware, environment, and launcher records; Mac build validation.

The exact four Python modules used for parsing, scoring, and timing are frozen in `provenance/bench-package/src/fastag_bench/`. They come from the original paper supplement. The newer repository copy adds support for other ion series and additional helpers; this experiment uses b/y scoring throughout. The manifest records the actual frozen scorer's SHA256, not the newer repository scorer's hash.

PXD003531 supplies 8,254 target rank-1 Sage PSMs at spectrum q ≤ 0.01, including 4,358 with configured oxidation or phosphorylation. PXD001819 supplies 13,342 PSMs, including 205 with methionine oxidation. The paper rule checks the residue sequence and at least one flank within 0.05 Da. The supplemental strict rule also checks every residue's fixed-plus-variable mass within 0.02 Da in the matching orientation. These measure agreement with the Sage assignments; the phosphosites were not independently localization-filtered.

Wall time includes process startup, input reading, tagging, and TSV writing. Scoring and backup occur after the timed runs. Keep the low-resolution L5 combined-mode range of 84.085–122.121 seconds: no outlier was discarded.

## Supplemental local experiments

`supplemental/mac-1thread/` contains the complete high-resolution single-thread panel and one completed low-resolution timing. Its high-resolution accuracy values reuse the byte-identical eight-thread outputs, as proved by the saved hashes.

`supplemental/mac-8threads/` contains the complete high-resolution panel and a partial low-resolution L3 preview. The local experiment was interrupted after substantial interactive workstation load appeared. These records are supplemental; they are not substituted into the primary dax results. Protocol-change records explicitly identify the final dax/32-thread protocol.

## Raw data, builds, and reproduction

The durable experiment root is:

`/ceph/ibmi/abi/oliver/fastag-gap-modes-20261111-0322813`

It contains `results-dax-32threads/` (approximately 3 GB), `bin/{baseline,feature}/FASTag`, `build/`, the launcher, harness, and scoring package. The raw result directory retains the first-repetition TSV for every cell; later identical TSVs were removed after recording their hashes. Logs and timing records cover all 60 runs. Large raw TSVs and spectrum files are intentionally outside Git.

Node-local input staging is `/scratch/kohlbach/fastag-gap-modes-20261111-0322813/benchmark/`. Original public inputs remain under `/ceph/ibmi/abi/oliver/jpr-bench/data/`; original Sage truth remains under `/ceph/ibmi/abi/oliver/jpr-bench/accuracy/work/runs/`. Exact filenames, dataset IDs, and hashes are in the manifest.

The recorded invocation is `provenance/run_dax_benchmark.sh`. To repeat it, retain its library environment and input paths, but choose a **fresh output directory**: the harness refuses to append duplicate timing runs. The harness is `bench/optional_gap_modes.py` in the repository; pass this result directory's `provenance/bench-package` as `--bench-package`, plus the recorded `--baseline`, `--feature`, `--data-root`, a fresh `--output`, and `--threads 32`. The feature source is commit `032281356fc69ed9e86a074aaf70a95a164fbff8`; baseline source is `d16328b4a7f9746055dcc1623918867ff7ee6b93`. Compiler, OpenMS, binary, and library details are preserved in `provenance/dax-build/`.

CMake cache and CLI-help text snapshots have trailing whitespace normalized for version control; the original build records remain in the durable experiment directory.
