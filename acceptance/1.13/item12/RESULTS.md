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
numbers are dominated by PXD076528 (69 % of the chimeric spectra).

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
  rank-1 peptide alone this is 27 points below pure spectra (H1). Counting either peptide the gap is 6 points,
  inside the preregistered 10-point margin (H2), but not zero.
- Which peptide the rank-1 tag reads follows the header precursor (descriptive, `E1 by header`): when only pep1
  explains the header mass the rank-1 tag reads pep1 in 69 %, when only pep2 does, pep2 in 39 % and pep1 in 33 %.
- MS1 co-isolation lowers rank-1 precision on spectra with a single identification by 29 points (H3).
- `-diversity` under a 10-tag cap raises the share of chimeric spectra with both peptides in the top 10 by 9.3
  points without changing rank 1 (H4), on all of these runs pooled. This differs from 1.12 #4 (F4-04, synthetic
  chimeras, measured under a 50-tag cap), which found no benefit; on DEV the gain was 17.8 points. It is a
  result for `-max_tags 10` only; `-diversity` under the default 50-tag cap was not tested here. The option stays
  off by default (this benchmark changes no default).
- Limits: Sage-chimeric spectra are selected for having two confident identifications, so H1/H2 compare
  different spectra, not the same spectrum with and without its second peptide. One run (PXD049370) gave no
  identifications in the chimera search and the pooled result rests mostly on two Astral runs.
