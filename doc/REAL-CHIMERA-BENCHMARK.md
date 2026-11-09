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

DEV (PXD003531 NO_03, harness development only) and the single held-out scoring: see
`acceptance/1.13/item12/RESULTS.md` on branch `acceptance/1.13`. The summary below is filled in from there.
