# Real-chimera benchmark (1.13 item 12, backlog #16)

How accurate are FASTag's tags on MS2 spectra that really contain two co-isolated peptides? This is a
benchmark of FASTag as released; it adds no option and changes no output. The harness is
`fastag-bench realchimera` (`bench/fastag-bench`, README section "Real chimeric spectra").

## Truth

Two independent views per MS2 spectrum:

- **Sage chimera search** (Sage 0.14.7, `chimera: true`, `wide_window: true`, `report_psms: 2`; otherwise the
  bench's closed search). *Chimeric*: rank 1 and rank 2 are targets at Sage `spectrum_q <= 0.01` and rank 2
  also passes a target-decoy q <= 0.01 computed among the rank-2 PSMs alone (Sage's q pools both ranks, which
  let the rank-2 subset run at 2.5 % FDR on the DEV run), with different I/L-normalized peptides, neither
  contained in the other. *Nested* pairs (one peptide inside the other) are excluded. *Single*: rank 1 only.
- **MS1 precursor purity**: share of the isolation window's intensity in the preceding MS1 scan that lies on
  the header precursor's isotope positions; a port of OpenMS `PrecursorPurity::computePrecursorPurity`
  (window around the isolation target as in OpenMS develop; with the OpenMS 3.4 window around the selected
  ion it reproduces pyopenms 3.4.1 exactly on all 27,345 DEV spectra).

A tag is correct for a peptide by the bench's flank rule (substring with I = L and one flank mass within
0.05 Da). A chance arm scores the same tags against another spectrum's peptides that share no identity.

## Endpoints

Pooled over runs, clusters within runs; 95 % cluster-bootstrap intervals; preregistered with their margins
in `acceptance/1.13/PREREG-item12.md`:

| | Endpoint | Claim when |
|---|---|---|
| E1 | rank-1 tag correct for either peptide on chimeric spectra (descriptive), chance arm, attribution | — |
| H1 | rank-1 precision for the rank-1 peptide: chimeric minus pure single (purity >= 0.9) | upper bound < 0: penalty shown |
| H2 | either-peptide rank-1 precision on chimeric minus pure single | lower bound > -0.10: non-inferior |
| H3 | single spectra: purity >= 0.9 minus purity < 0.5 | lower bound > 0: gradient shown |
| H4 | `-max_tags 10 -diversity` minus `-max_tags 10`: both peptides covered in the top 10 | gain >= 0.03, permutation p < 0.05, rank-1 loss <= 0.005 |

## Results

Held-out, scored once (2026-11-09; `acceptance/1.13/item12/RESULTS.md` on branch `acceptance/1.13`), FASTag
1.12.1 defaults. Five public runs were staged (PXD066944, PXD076528 Astral; PXD009612, PXD040230 Q Exactive
family; PXD049370), four have truth, and one of those (PXD009612) has only 45 chimeric spectra: 28,146
Sage-chimeric and 71,259 single spectra, 93 % of the chimeric ones from the two Astral runs (PXD076528 69 %).
PXD049370 gave no Sage PSMs at 1 % in the chimera search; post hoc, its MS2 turned out to be ion-trap CID
searched at 20 ppm, outside the selection rule (see below).

| | Result | Verdict |
|---|---|---|
| E1 | rank-1 tag correct for either peptide 0.723 (95 % CI 0.716-0.729; chance 0.0001); rank-1 peptide 0.513, rank-2 peptide 0.209 | descriptive |
| H1 | 0.513 vs 0.781 on pure single spectra: -0.267 (-0.279 to -0.255) | penalty shown |
| H2 | 0.723 vs 0.781: -0.058 (-0.069 to -0.047) | non-inferior (margin -0.10) |
| H3 | single spectra, purity >= 0.9 vs < 0.5: 0.781 vs 0.493, +0.287 (0.276 to 0.299) | gradient shown |
| H4 | `-diversity` under `-max_tags 10`: both peptides in the top 10 0.399 -> 0.491, +0.093 (0.088 to 0.097), rank 1 unchanged | benefit |

The pooled H1-H3 compare groups with different run mixes (pure singles hold more PXD040230 and PXD009612 than
the chimeric set). A run-stratified sensitivity, added after the result and not preregistered (per-run
differences weighted by the chimeric share, cluster bootstrap within run), gives H1 -0.282 (-0.295 to -0.270),
H2 -0.073 (-0.085 to -0.061) and H3 +0.302 (0.290 to 0.315). So the either-peptide gap is about 6-7 points; it
stays inside the margin with the run mix fixed, but PXD066944 alone sits at it (-0.092, -0.118 to -0.065). H3
is an association: purity differs with run and isolation window, and the purity bins are not monotone below
0.5, so it does not show that co-isolation causes the whole drop.

Which peptide the rank-1 tag reads follows the header precursor. `-diversity` stays off by default; its benefit is
shown for a 10-tag cap only (1.12 #4 found none on synthetic chimeras under a 50-tag cap). The comparison of
chimeric with pure spectra is between different spectra, and Sage-chimeric spectra are selected for two
confident identifications.

The held-out runs are held out from everything that shaped the evaluated tags (1.12.1 keeps the 1.11 tag
defaults; the harness was developed on PXD003531), but they are not unused data (note of 2026-11-09): PXD066944
OFF-03 was a held-out run of 1.12 #2 and #6 (scored, no default changed) and of the concurrent 1.13 compltol
item; PXD076528 7673_YD12 is in the 1.12 species-call DEV lists and the 1.13 #23 evaluation manifest; the three
Q Exactive-family runs are in 1.12 chemistry-call DEV tables, the 1.12 #7 DIA-refusal sweep and 1.13 DEV tables
(#8 label call, alknodb). All of these are opt-in reports or the DIA refusal, which does not act on DDA input.
The full list is `acceptance/1.13/disjointness/item12-realchimera-reuse.tsv`.

DEV (PXD003531 NO_03, development only): union 0.722, H1 -0.163, H2 +0.021, H3 +0.244, H4 +0.178.

## Checks added after the held-out result

- **Truth check** (`truth_qc`; 1.12 rule 4b): `score` writes `truthqc_<split>.tsv`; the report marks a run
  "without truth" when no rank-1 target passes q <= 0.01 or the rank-1 target:decoy ratio is below 1.2, and
  leaves it out of every group (rows `T truth check`).
- **Pre-freeze precheck** (`fastag-bench realchimera precheck`): a plain closed Sage search per run, not the
  endpoint search. It refuses a run without truth, one that identifies under 5 % of its MS2, or one whose MS2 are
  mostly ion-trap (`ITMS` filter strings) under a ppm fragment tolerance. On the item 12 runs, post hoc, it
  flags PXD049370 only.
- **Reuse check** (`fastag-bench realchimera reuse`, or `verify` with `realchimera.reuse` set): searches other
  manifests and tables for each run's raw file name, raw SHA-1/sha256 and mzML sha256 (PXD-only hits are
  reported) and refuses a run whose reuse is not declared with a reason (`declared` TSV: run_id, file_glob,
  reason).
- **Run-stratified sensitivity** (rows `S run-stratified`; `stats_realchimera.py --sensitivity` for the rows
  alone): H1-H3 with the run mix held fixed, and per run.
