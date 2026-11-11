# Optional modified-pair and triplet gaps

This feature branch extends FASTag 1.13.1 (`d16328b4a7f9746055dcc1623918867ff7ee6b93`).
Neither new mode is enabled by default. A gap is one graph edge between observed
peaks; its length is the number of residues assigned to their mass difference.
A pair spans one missing intermediate peak and a triplet spans two.

## Usage

```sh
# Existing search: ordinary variable-modified residues are still available,
# but gaps contain only base/fixed-modified residues.
FASTag -in run.mzML -out baseline.tsv -variable_modifications 'Oxidation (M)'

# Also allow one configured variable-modified residue inside a pair gap.
FASTag -in run.mzML -out modified-pairs.tsv -gap_variable_mods \
  -variable_modifications 'Oxidation (M)'

# Also allow base/fixed-modified triplets.
FASTag -in run.mzML -out triplets.tsv -max_gap_residues 3 \
  -variable_modifications 'Oxidation (M)'

# Both extensions, with common modifications for phospho-enriched samples.
FASTag -in run.mzML -out both.tsv -gap_variable_mods -max_gap_residues 3 \
  -variable_modifications 'Oxidation (M)' 'Phospho (S)' 'Phospho (T)' 'Phospho (Y)'
```

The modification list is explicit and uses the existing OpenMS resolver. No
sample-independent modification list is silently added. Fixed modifications
already apply to pairs in the existing algorithm. The library adds variable
deltas to the fixed-modified residue mass, preserving its previous semantics.
`-gap_variable_mods` without variable modifications is a no-op. `-gaps 0`
disables all gap edges. `-max_gap_residues` accepts only 2 or 3.

## Algorithm

1. Build the existing ordinary-residue alphabet, including configured variable
   alternatives. Build the existing unordered base/fixed pair compositions.
2. With `gap_variable_mods`, add pairs containing one base/fixed residue and one
   variable alternative. With `max_gap_residues=3`, add unordered base/fixed
   triplets. I/L remain folded. No pair contains two variable alternatives;
   no triplet contains a variable alternative.
3. For each fragment charge, match observed peak differences against the gap
   mass table. Keep separate pair and triplet edges when the same endpoints
   support both lengths. Suppress a pair when an ordinary two-edge route
   connects its endpoints. Suppress a triplet when an ordinary three-edge
   route, or an ordinary edge plus a pair gap in either order, connects them.
   This is an endpoint-level redundancy rule, consistent with the existing
   pair rule; it does not establish a unique underlying sequence.
4. Walk paths spending one, two, or three residues per edge, admitting at most
   one gap and requiring the exact seed residue budget. Greedily extend each
   seed at either end using ordinary edges only, as before.
5. Enumerate compatible compositions and their distinct residue orders,
   retaining each composition's complete permutation group. The existing pair
   cap is 8 spellings; the triplet cap is 48. Compositions are visited in mass
   order with a deterministic spelling order for isobars. Stop before a group
   would exceed the cap. These caps can exclude valid heavier compositions.
6. Rescore each spelling with its own composition mass. Null tables use the
   number of observed peaks, including two-peak, three-residue seeds. Each
   residue in a gap shares the confidence of the same unresolved edge.
   Candidate multiplicity, the existing gap penalty (100 by default), and
   the output cap apply as before.

The larger alphabet increases ambiguous candidates. A triplet at seed length
3 can have only two observed peaks; the two missing internal cleavages do not
support any particular order. The new modes do not add a new calibration of
the E-value score or gap penalty. Results below use the existing penalty and
evaluate seed lengths 3 and 5 separately.

## Benchmark

The controlled comparison uses two public runs already present in the paper's
benchmark collection. The input mzML checksums are verified against that
collection. Reference identifications are the existing Sage target rank-1 PSMs
at spectrum q-value <= 0.01; they were not regenerated or selected using these
gap-mode outputs.

| Dataset / run | Reference spectra | Configured variable modifications | Fragment tolerance |
| --- | ---: | --- | --- |
| PXD003531 / `20130611_QE3_UPLC10_CFR_SA_OC_T_NO_03_01_01.mzML` | 8,254 | Oxidation (M), Phospho (S/T/Y) | 20 ppm |
| PXD001819 / `UPS1_25000amol_R1.mzML` | 13,342 | Oxidation (M) | 0.5 Da |

Both use fixed Carbamidomethyl (C). Of the reference spectra, 4,358 in PXD003531
carry at least one configured variable modification (1,891 oxidation, 2,924
phosphorylation, with overlap), and 205 in PXD001819 carry oxidation. The Sage
search also allowed N-terminal acetylation, and N/Q deamidation in PXD003531;
these remain in the reference set but are not added to the tested FASTag
variable alphabet. The exact Sage configuration and provenance are retained
beside the local input files.

Five arms compare the release binary, the feature binary with both modes off,
modified pairs, triplets, and both. Every arm has the same fixed/variable
modification lists, seed length, gap limit (1), extension (0), peak selection
(400 maximum; 10 per window), score cutoff (20, before the gap penalty), gap penalty (100), and output
cap (50). Seed lengths 3 and 5 are evaluated separately. This isolates the new
gap search from the already-existing support for ordinary modified residues.

The paper's primary correctness rule requires an I/L-folded tag sequence (or
its reverse) to occur in the reference peptide and at least one flanking mass
to agree at that occurrence within 0.05 Da. It ignores modification labels.
The supplementary **strict mass** rule additionally requires each residue's
fixed-plus-variable mass to match the reference at the same occurrence within
0.02 Da, respecting orientation. It measures agreement with Sage's modification
assignment, not independently established phosphosite localization.

**Recall@50** is the fraction of all reference spectra with at least one correct
tag among the reported top 50. **Rank-1 accuracy** is the fraction of all
reference spectra whose first tag is correct. A spectrum with no returned tag
is a miss under both measures. Conditional rank-1 precision among spectra with
tags is also retained in the machine-readable results. Per-spectrum paired
gains/losses distinguish new recoveries from lost correct tags.

Timing uses three sequential repetitions per arm and length, with reproducibly
shuffled arm order within each repetition. The primary comparison uses 32
FASTag threads on `dax`, a dual AMD EPYC 9654 host with 192 physical cores,
384 logical CPUs, and approximately 2.2 TiB RAM. Its load before benchmarking
was 3.96. Both exact source commits were compiled with GCC 14.4, Release
optimization, OpenMP 4.5, and the same OpenMS SDK at revision `70cebcd144`.
Inputs are staged on node-local scratch and checked against the original
hashes. File hashing warms the input cache; wall times include process startup,
reading the complete input, tagging all spectra, and writing the tag TSV.
They are end-to-end times, not isolated graph-search times. No builds or tests
run concurrently with timing. Affinity, per-run load, CPU time, and timing
ranges are retained with the results; no exclusive CPU allocation is claimed.

Supplementary measurements on an Apple M4 Max (16 cores, 128 GiB RAM) use one
and eight threads, AppleClang 21.0.0.21000401, and the same OpenMS 3.7.0
development SDK for both builds (`3.7.0-pre-exported-20261104`). The high-resolution
panels completed at both thread counts. Background load subsequently made the
local low-resolution timings unreliable, so they are retained as supplementary
records and excluded from the primary runtime conclusions. Interrupted runs
are marked unmeasured. The remote primary comparison covers both full datasets
under one consistent protocol.

## Results: primary 32-thread comparison

**The measurements favor retaining the current defaults.** Triplets reduced recall@50 and rank-1 accuracy in all four dataset/seed-length comparisons. Modified pairs produced only a small overall recall gain with five-residue seeds on the high-resolution run (10 additional reference spectra, +0.12 percentage points), while its rank-1 count fell by 8. They reduced overall recall in the other three comparisons. These are results for the existing, untuned scoring and output limits, not a test of a recalibrated gap model.

Triplets took **1.53–3.56 times** the baseline wall time across the four comparisons; modified pairs took **1.06–1.17 times** the baseline. All 60 runs succeeded. Every arm was byte-deterministic across its three repetitions, and the feature binary with both modes off produced byte-identical tag files to 1.13.1 in all four dataset/length cases.

The tables use the paper flank-correctness rule. Counts in parentheses are correct reference spectra. Wall time is the median of three runs, with the complete minimum–maximum range in brackets; CPU time is the median aggregate CPU time across threads. Times are seconds for the entire input file.

### PXD003531

High-resolution phospho-enriched run; 8,254 reference spectra.

| Seed residues | Mode | Recall@50 | Rank-1 accuracy | Wall seconds [min–max] | CPU seconds |
| ---: | --- | ---: | ---: | ---: | ---: |
| 3 | FASTag 1.13.1 | 96.24% (7,944) | 68.60% (5,662) | 0.862 [0.856–0.883] | 20.25 |
| 3 | Feature, both modes off | 96.24% (7,944) | 68.60% (5,662) | 0.860 [0.848–0.871] | 20.42 |
| 3 | Modified pairs | 96.00% (7,924) | 68.57% (5,660) | 0.968 [0.965–0.997] | 23.66 |
| 3 | Triplets | 90.50% (7,470) | 68.15% (5,625) | 2.864 [2.863–2.872] | 83.75 |
| 3 | Both modes | 90.63% (7,481) | 68.12% (5,623) | 2.914 [2.912–2.932] | 85.09 |
| 5 | FASTag 1.13.1 | 90.48% (7,468) | 64.43% (5,318) | 1.160 [1.153–1.161] | 29.13 |
| 5 | Feature, both modes off | 90.48% (7,468) | 64.43% (5,318) | 1.153 [1.136–1.212] | 29.12 |
| 5 | Modified pairs | 90.60% (7,478) | 64.33% (5,310) | 1.353 [1.348–1.359] | 34.23 |
| 5 | Triplets | 86.31% (7,124) | 63.29% (5,224) | 4.134 [4.132–4.138] | 120.94 |
| 5 | Both modes | 86.61% (7,149) | 63.22% (5,218) | 4.166 [4.156–4.171] | 122.32 |

### PXD001819

Low-resolution ion-trap run; 13,342 reference spectra.

| Seed residues | Mode | Recall@50 | Rank-1 accuracy | Wall seconds [min–max] | CPU seconds |
| ---: | --- | ---: | ---: | ---: | ---: |
| 3 | FASTag 1.13.1 | 63.48% (8,469) | 23.64% (3,154) | 6.256 [6.245–6.272] | 187.40 |
| 3 | Feature, both modes off | 63.48% (8,469) | 23.64% (3,154) | 6.264 [6.262–6.346] | 188.68 |
| 3 | Modified pairs | 63.27% (8,442) | 23.63% (3,153) | 6.643 [6.643–6.745] | 200.22 |
| 3 | Triplets | 62.07% (8,282) | 23.63% (3,153) | 9.559 [9.504–9.651] | 291.49 |
| 3 | Both modes | 61.90% (8,259) | 23.62% (3,152) | 9.882 [9.881–9.981] | 303.37 |
| 5 | FASTag 1.13.1 | 45.12% (6,020) | 14.41% (1,923) | 43.859 [43.817–43.910] | 1375.11 |
| 5 | Feature, both modes off | 45.12% (6,020) | 14.41% (1,923) | 43.140 [43.132–43.588] | 1352.93 |
| 5 | Modified pairs | 44.99% (6,003) | 14.40% (1,921) | 47.175 [47.135–47.238] | 1479.53 |
| 5 | Triplets | 44.39% (5,922) | 14.36% (1,916) | 80.073 [79.873–80.391] | 2519.13 |
| 5 | Both modes | 44.32% (5,913) | 14.34% (1,913) | 84.279 [84.085–122.121] | 2652.14 |

The first low-resolution, five-residue, combined-mode run took 122.121 seconds; the other two took 84.085 and 84.279 seconds. The slow run is retained in the range and raw records. The reported median is 84.279 seconds; the cause of that one-run variation was not established.

### Modified reference peptides: stricter correctness

This subset contains reference PSMs carrying at least one configured variable modification. Correctness additionally requires every residue mass, including its modifications, to agree with the reference assignment. Each cell compares baseline → modified pairs; the denominator is the full subset, including spectra with no tag.

| Dataset | Seed residues | Reference spectra | Strict recall@50: baseline → pairs | Strict rank-1: baseline → pairs |
| --- | ---: | ---: | ---: | ---: |
| PXD003531 | 3 | 4,358 | 95.23% (4150) → 94.88% (4135) | 61.31% (2672) → 61.24% (2669) |
| PXD003531 | 5 | 4,358 | 86.90% (3787) → 87.45% (3811) | 57.27% (2496) → 57.11% (2489) |
| PXD001819 | 3 | 205 | 56.59% (116) → 56.59% (116) | 19.51% (40) → 19.51% (40) |
| PXD001819 | 5 | 205 | 37.56% (77) → 38.54% (79) | 13.66% (28) → 13.66% (28) |

With five-residue seeds, modified pairs gain 24 correctly covered modified reference spectra in PXD003531 (+0.55 percentage points) and 2 in the small PXD001819 oxidation subset (+0.98 points). Rank-1 accuracy falls in the former and is unchanged in the latter. These small subset gains do not establish a general advantage, and phosphosite assignments here have not been independently localization-filtered.

### Recoveries, losses, and interpretation

Adding gap edges can recover true tags while reducing the final recall. Under the strict rule, high-resolution three-residue triplets recover 5 previously missed spectra but lose correct coverage for 484 others. Modified pairs with five-residue seeds recover 46 and lose 31 in that same dataset (net +15 under the strict rule). The [paired results](../bench/results/optional-gaps-2026-11-11/paired_changes.tsv) retain gains and losses for every arm, length, and scoring rule.

FASTag multiplies each candidate's combined score by the number of enumerated candidates. A larger gap alphabet can therefore raise the E-values of existing tags as well as introduce new competing tags. Both the fixed score cutoff and the top-50 cap can remove correct tags. The experiment measures that complete behavior; it does not isolate the contribution of each mechanism. The existing gap penalty was retained, with no mode-specific calibration.

### Single-thread reference on the Mac

These complete high-resolution measurements are supplementary, on different hardware from the primary table. They are medians of three one-thread runs on the Apple M4 Max, in seconds.

| Seed residues | FASTag 1.13.1 | Modified pairs | Triplets | Both |
| ---: | ---: | ---: | ---: | ---: |
| 3 | 12.696 | 14.164 | 60.851 | 61.164 |
| 5 | 17.825 | 21.247 | 83.302 | 83.841 |

Primary [summary tables](../bench/results/optional-gaps-2026-11-11/summary.tsv), [per-run measurements](../bench/results/optional-gaps-2026-11-11/timings.jsonl), and [artifact/provenance guide](../bench/results/optional-gaps-2026-11-11/README.md) accompany this report. The summaries also contain strict all-spectrum results, oxidation/phosphorylation subsets, and conditional rank-1 precision among spectra with tags.

## Validation

- 85 C++/CLI tests passed. Four optional integration tests were skipped because
  external search engines, mzPeak inputs/validator, or a pyteomics environment
  were unavailable. Two filesystem-sensitive tests passed when rerun outside
  the sandbox.
- The release compatibility test passed 126 comparisons: 123 unchanged and
  three expected option additions. Two taxonomic index outputs were identical.
- New tests exercise modified-pair opt-in and exclusion, all triplet orders,
  isobaric pair/triplet endpoints, approximate-isobar mass closure, observed-peak
  nulls, residue budgets, extension, redundant-gap suppression, multiple seed
  lengths, and invalid gap limits.
- GUI type checking and 26 parameter-contract/dependency tests passed. The GUI
  parameter manifest was regenerated from the built CLI.
- All 15 available Mac eight-thread versus Linux 32-thread tag-file comparisons
  were byte-identical; the corresponding 140 accuracy-summary rows agreed.
- Linux builds also passed the gap-mode, release-compatibility, and output
  provenance checks. GCC's warning on the fixed-size `next_permutation` loop
  was checked with an isolated ASan/UBSan run: 7,980 cases across all 1,330
  triplet compositions passed without a sanitizer finding.

## Reproduction

The tested implementation is commit `0322813`; the pristine comparison is
`v1.13.1`. Build both in Release mode against the same OpenMS SDK. Exact build
settings, source and binary hashes, commands, input hashes, and per-run timing
records are retained with the results.

The [benchmark script](../bench/optional_gap_modes.py) reuses the paper's
`fastag_bench` parsers, correctness rule, and timing helper. The exact modules
used are frozen in the result provenance; their scorer hash matches the
measurement manifest. The repository's newer general-purpose scorer also
supports c/z and a/x ions, while this experiment uses b/y ions throughout.
It requires Python
with numpy, pandas, and PyYAML. Arrange the input mzMLs under
`DATA/data/PXD003531/` and `DATA/data/PXD001819/`, and the corresponding
`results.sage.tsv`, `sage.json`, `command.txt`, and `version.txt` under
`DATA/truth/PXD003531/` and `DATA/truth/PXD001819/`. From the checkout root:

```sh
python bench/optional_gap_modes.py \
  --bench-package bench/results/optional-gaps-2026-11-11/provenance/bench-package \
  --baseline /path/to/baseline-build/FASTag \
  --feature /path/to/feature-build/FASTag \
  --data-root /path/to/DATA \
  --output /path/to/new-results \
  --threads 32 --lengths 3 5 --reps 3
```

The script first checks the supplementary correctness rule, then executes and
scores the five arms. It refuses to append duplicate timing runs to an existing
output directory. Raw tag files from the first repetition are retained; hashes
from all repetitions check determinism. `--steps score` recalculates the
accuracy tables from retained tag files without rerunning the algorithms.
