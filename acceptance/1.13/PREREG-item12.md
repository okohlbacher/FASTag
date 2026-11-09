# PREREG item 12: backlog #16, tag accuracy on real chimeric spectra

Committed before any FASTag, Sage or scorer run on a held-out file of `manifests/item12-realchimera.tsv`. The only
runs so far are on the one DEV run (PXD003531 NO_03, the gate's dda_default input); their tables are in
`item12/dev/`. Files of this item: `PREREG-item12.md`, `manifests/item12-realchimera.tsv`,
`disjointness/item12-realchimera.tsv`, `item12/` (frozen config, run script, staging script and log, DEV
results, `SHA256SUMS` of the frozen harness, `SHA256SUMS.acceptance`), the `CFG-12-realchimera` row of
`frozen-configs.tsv` and the `HO-12-*` rows of `validation-registry.tsv`.

This is a benchmark of FASTag as released, not a FASTag change. A FAIL or "not shown" is a valid result.

## What is evaluated

- FASTag 1.12.1 (`Version: 1.12.1`), built on node data from origin/main 702b45c (the base of
  `feat/b113-chimeric`; no file under `src/` changed on that branch), binary sha256
  `8f683f83b21061a30e5a87d0d3b864ceeb99bec5a18c839d0c157606fa6c7d0a` at `data:/scratch/kohlbach/b113/chimeric/opt/FASTag`.
- Three profiles on each mzML, `-threads 8`: `default` (no options), `cap10` (`-max_tags 10`),
  `cap10_div` (`-max_tags 10 -diversity`).
- Harness: `bench/fastag-bench` of `feat/b113-chimeric` at `c80faa359be4d259be042721b3747d43095a252a`, unpacked by
  `git archive` to `data:/scratch/kohlbach/b113/chimeric/frozen-c80faa3`; every file's sha256 in `item12/SHA256SUMS`
  (scorer `scripts/stats_realchimera.py` `06bd3db99cd0110c94737e126b8069e1e2c5c6bb84726f2fdf5875b4fde709d7`,
  `src/fastag_bench/realchimera.py` `660759958620b0fcdb0f386338a896495efc37e3ed27daa1a49196b2ff03c740`,
  `score.py` `e2b8788a...1f75f79`, `parsers.py` `01e27548...a51f49`, `sage.py` `4d8542d5...41fdab`,
  `scripts/stats_unidentified.py` `4418f9e9...42cee7`, `scripts/stats_paired.py` `e02cc411...afd`).
  Python 3.11.18, pandas 3.1.0, numpy 2.4.6 (`data:/scratch/kohlbach/fastag112-f4/envs/bench`).
- Frozen config `item12/realchimera-HO.yaml` (sha256 in `SHA256SUMS.acceptance`; param_hash of `CFG-12-realchimera` =
  its sha256), run once by `item12/scripts/run_heldout.sh`, which checks every hash above, both binaries and the
  manifest before it starts and refuses a second scoring.

## Truth per run

- Sage (bioconda env binary `data:/scratch/kohlbach/jpr-bench/envs/sage/bin/sage`, sha256
  `ebc0b04c6e4a0f71bd5b214fddf97ce0ce4ff0a4be8d9c21f2c148c1670e928a`, prints 0.14.6, the 0.14.7 release), config from
  `sage.py` mode `chimera`: the bench's closed search (trypsin KR/not before P, 2 missed cleavages, 7-50 residues,
  peptide mass 500-5000, b/y ions, isotope errors 0..1, deisotoping on, generated reversed decoys `rev_`) with
  `chimera: true`, `wide_window: true` (precursor tolerance = isolation window; the manifest's 10 ppm is unused),
  `report_psms: 2`. Fixed C+57.021464, variable M+15.994915, at most 3; fragment tolerance 20 ppm.
- Databases (manifest, sha256 per file): human UP000005640_9606 (deposited with PXD054073) for PXD066944 and
  PXD076528; the prose-auto panel Swiss-Prot proteomes Danio_rerio, Caenorhabditis_elegans, Bacillus_subtilis for
  PXD009612, PXD040230, PXD049370.
- FDR 0.01. **Chimeric**: rank-1 and rank-2 PSMs targets with Sage `spectrum_q <= 0.01`, rank 2 also with a
  target-decoy q <= 0.01 computed among the run's rank-2 PSMs alone (`realchimera.rank_q`, Sage discriminant score,
  tied scores share one q), I/L-normalized peptides different and neither contained in the other. **Nested**:
  both pass but one contains the other (excluded). **Single**: rank 1 passes, rank 2 does not.
- MS1 precursor purity: `realchimera.precursor_purity` on the MS2's preceding MS1 scan, 10 ppm (doubled, as
  OpenMS), window around the isolation target (`purity_center: target`). DEV check of the port: with
  `center: selected` it equals pyopenms 3.4.1 `computePrecursorPurity` on 27,345/27,345 spectra
  (`item12/dev/xcheck_selected_dev.tsv`, PASS).

## Correctness, cells, pooling

- A tag is correct for a peptide by `score.py`'s flank rule. Rank = row order in FASTag's TSV.
- Spectra of the five runs are pooled. Clusters never cross runs: single spectra by `run|I/L peptide`; chimeric
  spectra by connected components over both peptides. Intervals: 95 % percentile cluster bootstrap, 2,000
  replicates, seed 20261104 (two independent groups: clusters resampled within each group); H4 also the cluster
  sign-flip permutation p (20,000 Monte Carlo patterns).
- Chance arm: each spectrum scored against the (pep1, pep2) of another spectrum of its category sharing no
  identity (seeded cycle, seed 1). Reported, not an endpoint.

## Endpoints (profile `default` unless stated; all in `endpoints_HO.tsv`)

| | Metric | Groups / denominator | Verdict rule |
|---|---|---|---|
| E1 | union_rank1 (rank-1 tag correct for pep1 or pep2), with pep1/pep2/both rank-1, pep2_top10, both_top10, top50, attribution | chimeric spectra | descriptive |
| H1 | pep1_rank1(chimeric) - pep1_rank1(pure single) | pure single = single with purity >= 0.9 | upper bound < 0: **penalty shown**; lower bound > -0.05 and upper < 0.05: **no penalty**; else inconclusive |
| H2 | union_rank1(chimeric) - pep1_rank1(pure single) | as H1 | lower bound > -0.10: **non-inferior**; else not shown |
| H3 | pep1_rank1(single, purity >= 0.9) - pep1_rank1(single, purity < 0.5) | single spectra | lower bound > 0: **gradient shown**; else not shown |
| H4 | both_top10(cap10_div) - both_top10(cap10), paired by (run, spectrum) | chimeric spectra | 1.12 rule: gain >= 0.03 and p < 0.05 and union_rank1 loss <= 0.005: **benefit**; else no benefit claimed |

Evaluability: an endpoint is **not evaluable** when a group it needs has fewer than 100 spectra or its largest
cluster holds 10 % or more of it; H4 also when a chimeric spectrum lacks either profile. Spectra without a
purity value count in no purity group. Per-run values and purity bins are descriptive. One test per hypothesis,
no multiplicity adjustment across H1-H4 (each is a separate claim; reported as such).

What the endpoints cannot show: Sage-chimeric spectra are those where both peptides were identified, so they
are selected for quality; H1/H2 compare them with pure single spectra, not with the same spectra unmixed.

## Data and split

`manifests/item12-realchimera.tsv`, five held-out runs, all public PRIDE data, no AGXT/Sxx:

Selection rule (fixed before any run): label-free, unenriched, tryptic DDA runs with high-resolution MS2 on an
Orbitrap or Astral instrument, not the DEV PXD, from (a) the bench's `datasets.yaml` (single-organism human lysate
runs: PXD066944, PXD076528; excluded there: TMT/SILAC/phospho/non-tryptic/ion-trap/timsTOF/metaproteome entries)
and (b) the prose-auto `valset_all/picked.tsv` rows of organisms that have a prose-auto panel proteome (PXD009612
Danio rerio QE, PXD040230 C. elegans QE HF, PXD049370 B. subtilis QE Plus). One run each (the one staged there).
Raw files hashed in place (sha256, sha1; PRIDE SHA-1 equal where PRIDE lists one); mzML and FASTA copied to
`data:/scratch/kohlbach/b113/chimeric/heldout/<run>/` and hashed (`item12/staged.tsv`, `item12/scripts/stage_item12.sh`).
The staging only copied and hashed; it inspected MS levels and isolation windows (all five have MS1 scans and
isolation windows), nothing else. Disjoint from DEV by PXD, raw name, raw SHA-1 and mzML sha256
(`disjointness/item12-realchimera.tsv`).

The ProteomeTools split `reserved_16` of 1.12 (#4) stays unused: this item uses real lysate chimeras.
