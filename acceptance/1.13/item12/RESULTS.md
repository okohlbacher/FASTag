# Item 12 (#16) held-out result: tag accuracy on real chimeric spectra

Scored once, 2026-11-09, on node data, by `item12/scripts/run_heldout.sh` under `CFG-12-realchimera` (PREREG-item12.md;
acceptance files from 6c468ac, harness feat/b113-chimeric c80faa3, all hashes checked by the script). Tables:
`results/endpoints_HO.tsv` (sha256 `89743fd6ab877122fbf2cb4ad6802216245ec60505184c8b9b2627c65323760f`), `results/verify_HO.tsv`,
`results/run_heldout.log`, `results/sage_counts_HO.tsv`. Per-spectrum table (28 MB, not committed):
`data:/scratch/kohlbach/b113/chimeric/work/heldout/spectra_HO.tsv.gz`, sha256
`6c4e73995608570f442bfeb88430b616155fe4255febf0825ac31bebd9e9e797`. FASTag 1.12.1, profile `default` unless stated.

## Spectra

| Run | Sage chimeric | nested | single | pure single (purity >= 0.9) |
|---|---|---|---|---|
| PXD066944 (Astral, HEK, 2 Th) | 6,577 | 4 | 20,373 | 1,054 |
| PXD076528 (Astral) | 19,492 | 263 | 38,952 | 5,440 |
| PXD009612 (Danio, QE) | 45 | 0 | 2,316 | 508 |
| PXD040230 (C. elegans, QE HF) | 2,032 | 5 | 9,618 | 1,818 |
| PXD049370 (B. subtilis, QE Plus) | 0 | 0 | 0 | 0 |
| pooled | 28,146 | 272 | 71,259 | 8,820 |

PXD049370 contributes nothing: Sage's chimera/wide-window search reported 0 target PSMs at 1 % FDR (its lowest
spectrum_q is 0.0116, on 6,495 target and 6,047 decoy PSMs over 13,059 MS2 spectra). Under the preregistered
denominators the run has no spectra in any group; it stays in the manifest and nothing was rerun. The pooled
numbers are dominated by PXD076528 (69 % of the chimeric spectra). Five runs were staged, four have truth, and
one of those has only 45 chimeric spectra: 93 % of the chimeric spectra come from the two Astral runs. The cause
of the failed PXD049370 truth (ion-trap MS2 searched at 20 ppm) and the truth check are in the post-result notes
below.

Validity: median MS1 purity is 0.33 for chimeric, 0.41 for single and 0.89 for nested spectra; the largest chimeric
cluster holds 1.2 % (9,407 clusters), the largest pure or impure single cluster 0.2 %.

## Endpoints

| | Value (95 % cluster-bootstrap CI) | Verdict |
|---|---|---|
| E1 rank-1 tag correct for either peptide, chimeric | 0.723 (0.716-0.729); chance 0.0001 | descriptive |
| E1 attribution of the rank-1 tag | rank-1 peptide 0.513, rank-2 peptide 0.209, both 0.00004, neither 0.277 | descriptive |
| E1 both peptides within the top 10 / top 50 | 0.399 / 0.643 | descriptive |
| H1 rank-1 precision for the rank-1 peptide, chimeric (0.513) minus pure single (0.781) | -0.267 (-0.279 to -0.255) | **penalty shown** |
| H2 either peptide on chimeric (0.723) minus pure single (0.781) | -0.058 (-0.069 to -0.047) | **non-inferior** (margin -0.10) |
| H3 single spectra, purity >= 0.9 (0.781) minus purity < 0.5 (0.493) | 0.287 (0.276 to 0.299) | **gradient shown** |
| H4 `-max_tags 10 -diversity` minus `-max_tags 10`: both peptides in the top 10 (0.399 -> 0.491) | +0.093 (0.088 to 0.097), p 5e-5, rank-1 loss 0 | **benefit** |

Per run (descriptive), either-peptide rank-1 on chimeric / rank-1 on pure single: PXD066944 0.714 / 0.806,
PXD076528 0.724 / 0.796, PXD040230 0.741 / 0.762, PXD009612 0.578 (n 45) / 0.628.

## Reading

- On spectra with two identified peptides FASTag's rank-1 tag is correct for one of them as often as 72 % of the
  time, but it belongs to the Sage rank-1 peptide only in 51 %; in 21 % it reads the second peptide. Against the
  rank-1 peptide alone this is 27 points below pure spectra (H1). Counting either peptide the gap is about 6-7
  points (pooled -0.058; run-standardized -0.073, post hoc, see below), inside the preregistered 10-point margin
  (H2), but not zero. PXD066944 alone sits at the margin (-0.092, CI -0.118 to -0.065).
- Which peptide the rank-1 tag reads follows the header precursor (descriptive, `E1 by header`): when only pep1
  explains the header mass the rank-1 tag reads pep1 in 69 %, when only pep2 does, pep2 in 39 % and pep1 in 33 %.
- On spectra with a single identification, rank-1 precision is 29 points higher at MS1 purity >= 0.9 than below
  0.5 (H3; 30 points run-standardized, 18-32 points within each run). This is an association: pure and impure
  singles come from different run and isolation-window mixes, and the purity bins are not monotone (0.504 below
  0.25, 0.473 at 0.25-0.5), so it is not shown that co-isolation causes the whole difference.
- `-diversity` under a 10-tag cap raises the share of chimeric spectra with both peptides in the top 10 by 9.3
  points without changing rank 1 (H4), on all of these runs pooled. This differs from 1.12 #4 (F4-04, synthetic
  chimeras, measured under a 50-tag cap), which found no benefit; on DEV the gain was 17.8 points. It is a
  result for `-max_tags 10` only; `-diversity` under the default 50-tag cap was not tested here. The option stays
  off by default (this benchmark changes no default).
- Limits: Sage-chimeric spectra are selected for having two confident identifications, so H1/H2 compare
  different spectra, not the same spectrum with and without its second peptide. One run (PXD049370) gave no
  identifications in the chimera search and the pooled result rests mostly on two Astral runs. The pooled H1-H3
  compare groups with different run mixes (chimeric: 69 % PXD076528, 23 % PXD066944, 7 % PXD040230; pure single:
  62 %, 12 %, 21 %, and 6 % PXD009612, the weakest run); the run-stratified rows below show the size of that.

## Post-result review notes (2026-11-09, post hoc; nothing re-scored)

Added after the adversarial review of the held-out result. The preregistered verdicts above stand; no endpoint
was recomputed and `results/endpoints_HO.tsv` is unchanged. Files: `item12/posthoc/`,
`disjointness/item12-realchimera-reuse.tsv`, `disjointness/item12-realchimera-reuse-declared.tsv`; harness
feat/b113-chimeric after c80faa3 (truth check, `precheck` and `reuse` steps, `--sensitivity`).

### 1. Run-stratified sensitivity (not preregistered)

`posthoc/sensitivity_HO.tsv` (`stats_realchimera.py --sensitivity` on `spectra_HO.tsv.gz`, sha256 6c4e7399...,
scorer sha256 bdca47bc...): per-run differences, weighted by each run's share of the chimeric spectra (H1, H2)
or of the pure + impure single spectra (H3), 95 % cluster bootstrap within run and group.

| | Pooled (preregistered) | Run-standardized | PXD066944 | PXD076528 | PXD040230 | PXD009612 |
|---|---|---|---|---|---|---|
| H1 | -0.267 (-0.279, -0.255) | -0.282 (-0.295, -0.270) | -0.310 | -0.284 | -0.178 | -0.184 (n 45 chim.) |
| H2 | -0.058 (-0.069, -0.047) | -0.073 (-0.085, -0.061) | -0.092 (-0.118, -0.065) | -0.072 (-0.086, -0.059) | -0.021 | -0.050 |
| H3 | +0.287 (0.276, 0.299) | +0.302 (0.290, 0.315) | +0.290 | +0.312 | +0.317 | +0.185 |

H2 stays inside the margin when the run mix is held fixed (lower bound -0.085 > -0.10), but the gap is 7, not
6, points, and on PXD066944 alone the interval reaches -0.118. H1 and H3 keep their sign in every run.

### 2. PXD049370: why there is no truth

The staging checked MS levels and isolation windows only. Post hoc diagnosis on the same mzML (Sage 0.14.7,
non-endpoint searches; `posthoc/pxd049370/*/sage.json`, counts in `posthoc/truthqc_HO_posthoc.tsv`): every MS2
filter string is `ITMS + c ... @cid35` (13,059 of 13,059), i.e. ion-trap CID MS2, but the manifest searched it
with a 20 ppm fragment tolerance (the prose-auto candidates list names the instrument Q Exactive Plus, the raw
file name says Orbi1). A plain closed search at 20 ppm identifies 420 of 13,059 MS2 at 1 % (rank-1 target:decoy
466:44); wide_window alone drops this to 0 (4,196:3,843). At 0.5 Da the closed search identifies 4,103. The run
therefore also falls outside the preregistered selection rule (high-resolution MS2); it entered because the
instrument label in the candidate list was wrong. It contributes no spectra, so no number changes.

Truth check (1.12 rule 4b, now in the harness): `score` writes `truthqc_<split>.tsv` and the report marks a run
"without truth" (no rank-1 target at q <= fdr, or rank-1 target:decoy < 1.2) and leaves it out of every group.
On the HO chimera searches only PXD049370 is flagged (0 at 1 %, ratio 1.09); the others have 2,361-58,707
passing rank-1 targets and ratios 1.42-4.37. The scored table has 0 rows of PXD049370, so leaving it out changes
no endpoint.

For later items the harness has a pre-freeze `precheck` step (plain closed search, not the endpoint search): it
refuses a run without truth, a run that identifies fewer than 5 % of its MS2, or ion-trap MS2 under a ppm
fragment tolerance. Run post hoc on these five runs (`posthoc/precheck/precheck_HO.tsv`) it flags PXD049370
only (420 of 13,059 MS2, 3.2 %; ITMS at 20 ppm); the others identify 8.2-43.8 % of their MS2. Its thresholds
were set after this result.

### 3. Reuse of the held-out runs in other records

`disjointness/item12-realchimera.tsv` compared the runs with this item's DEV run only. The reuse scan
(`fastag-bench realchimera reuse`, `posthoc/reuse/reuse-HO.yaml`) searched origin/acceptance/1.12,
origin/acceptance/1.13 at 28a9a63 and the 1.13 backlog DEV tables for each run's PXD, raw file name, raw SHA-1
and mzML sha256 (`disjointness/item12-realchimera-reuse.tsv`, 267 hits). All five runs appear elsewhere:

- HO-PXD066944-OFF03: the held-out run of 1.12 #2 and #6 (H1 and H1-r2, scored; #2 INCONCLUSIVE, #6 not passed,
  no default changed) and of the concurrent 1.13 compltol (#15) held-out set; also in the 1.12 #7 DIA-refusal
  sweep list, the 1.12 chemistry DEV lists and the 1.13 #8 label-call DEV table.
- HO-PXD076528-7673: in the 1.12 species-call DEV training lists and in the concurrent 1.13 #23 digqual
  evaluation manifest (same raw file, another mzML conversion).
- HO-PXD009612-MW3, HO-PXD040230-S2R1, HO-PXD049370-185: in the 1.12 chemistry (alkylation call) DEV fit tables,
  the 1.12 #7 sweep list (same mzML sha256), the 1.13 #8 label-call DEV table and the concurrent alknodb DEV table.
- PXD-only overlaps (other runs of the same projects) are listed as "reported".

Why this does not touch the evaluated binary: item 12 scores FASTag 1.12.1 at its defaults (plus `-max_tags 10`
and `-diversity`). 1.12.0/1.12.1 keep every 1.11 default except the #7 DIA refusal, which acts on DIA input only
(CHANGELOG 1.12.0: DDA outputs byte-identical to 1.11.0); the species and alkylation calls fitted on these runs
are opt-in reports, not tag generation; and the harness was developed on PXD003531 only. The runs are therefore
held out from everything that shaped the evaluated tags, but they are not unused data, and the earlier record's
"disjoint=True" covered the DEV run only. Each reuse is declared with its reason in
`disjointness/item12-realchimera-reuse-declared.tsv`; with that file the reuse step passes, without it the step
refuses all five runs.
