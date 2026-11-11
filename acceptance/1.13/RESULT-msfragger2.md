# msfragger export, second held-out test (post-1.13.1): PASS

Run once and scored once on 2026-11-11, node data. Protocol: `acceptance/1.13/PREREG-msfragger2.md` on branch
`post1131/msfragger-heldout2` (freeze 8c26eb1 + dd9c384, staged manifest 740b331; all pushed before the run).
Candidate: `post1131/msfragger` at 8d70454, FASTag sha256 bde217c0...; MSFragger 4.4.1; UP000005640 reviewed
(20,414 entries); 32 threads. Numbers: `acceptance/1.13/msfragger2/results/{verdict.tsv,runs.tsv,a0.tsv}` (copies of
`data:/scratch/kohlbach/post1131/msfragger/heldout2/results/`).

Primary arm: `-shortlist_gapped -recon_min_length 6 -shortlist_max_evalue 10 -recon_missed_cleavages 2`, export
options at defaults, export used unedited.

## Verdict (verdict.tsv)

| Criterion | Threshold | Result | Verdict |
|---|---|---|---|
| C1 export runs unedited | all staged runs | 10 of 10 | PASS |
| C2 kept share, every evaluable run | >= 0.80 | lowest 0.833, median 0.934, pooled 0.932 (9 runs) | PASS |
| G1 median speed-up | > 1.0 | 2.05 (1.64 to 4.72) | PASS |
| G2 entrapment FDP | pooled <= 1.5 %, each run <= 2.0 % | pooled 1.07 %, highest run 1.88 % | PASS |
| Overall | | 9 of 10 runs evaluable (minimum 6) | **PASS** |

## Per run (runs.tsv, a0.tsv)

Identified = spectra at 1 % FDR on hyperscore. Kept = spectra of the full search that the export search identifies
with the same peptide. Speed-up = wall(full search) / (wall(FASTag) + wall(export search)).

| Run | PXD | Shortlist proteins | Full search identified | Export identified | Kept | Speed-up | Entrapment FDP | Default shortlist kept (informational) |
|---|---|---|---|---|---|---|---|---|
| MG01 | PXD006188 | 4,245 | 7,056 | 6,397 | 0.855 | 1.64 | 1.03 % | 0.559 |
| MG02 | PXD012858 | 5,853 | 53,855 | 54,335 | 0.956 | 1.84 | 1.12 % | 0.859 |
| MG03 | PXD006776 | 4,680 | 26,331 | 25,729 | 0.936 | 1.94 | 1.06 % | 0.828 |
| MG04 | PXD018780 | 1,352 | 1,138 | 1,214 | 0.976 | 2.64 | 1.88 % | 0.946 |
| MG05 | PXD053237 | 2,575 | 13,142 | 14,210 | 0.934 | 2.09 | 0.94 % | 0.793 |
| MG06 | PXD001724 | 6 | 10 | 2 | not evaluable | - | - | - |
| MG07 | PXD009324 | 4,201 | 9,751 | 9,224 | 0.884 | 2.05 | 1.22 % | 0.762 |
| MG08 | PXD018404 | 424 | 1,249 | 1,260 | 0.833 | 4.72 | 1.15 % | 0.526 |
| MG09 | PXD059544 | 8,968 | 67,422 | 65,081 | 0.926 | 1.69 | 0.99 % | 0.895 |
| MG10 | PXD052806 | 2,261 | 12,045 | 12,102 | 0.935 | 2.16 | 1.21 % | 0.795 |

- MG06 is not evaluable by the frozen rule (full search identifies 10 spectra, minimum 1,000). All its steps
  returned 0. Cause: the file has almost no fragment signal: 12,495 MS2 with 14 peaks on average, 4,312 below 15
  peaks; MSFragger reports a candidate for 26 spectra in the full search.
- Default shortlist (informational, no criterion): below 0.80 in 5 of 9 evaluable runs (0.526 to 0.946).
- MG04 has the highest entrapment FDP, 1.88 %, on 11 entrapment hits among 1,170 identified; one more hit would
  give 2.05 %, above the per-run limit.
- All wall times are below 90 s per search (FASTag 0.8 to 6.6 s) on a shared node at load 55 to 65.

## Deviations

1. The freeze is two commits (8c26eb1: protocol, scripts, scorer; dd9c384: manifest, draw, staging and exclusion
   tables left out by the `*.tsv` ignore rule). Both pushed before the first download.
2. A first staging launch between the two commits ended after 2 s without a download (staging list missing on the
   node); outputs kept in `heldout2/stage/aborted_no_list/`.
3. The exclusion builder skips this track's own report folder, whose draft draw names the same projects (stated in
   the protocol; no file of them had been downloaded).

No run was repeated, nothing was re-scored, no criterion changed.

## Limits

- 10 runs, Q Exactive, human, trypsin, label-free lysates; 9 evaluable. The verdict covers the recipe and the export
  defaults (including the isotope default of 1.13.1) together, not each alone.
- The recipe is opt-in; with the default shortlist the export keeps less than 80 % in most runs.
- Side observation, not examined: FASTag reports "no index, or one that no longer matches" for all 10 mzML files
  written by ThermoRawFileParser 2.0.0 and scans them instead; results are not affected.
