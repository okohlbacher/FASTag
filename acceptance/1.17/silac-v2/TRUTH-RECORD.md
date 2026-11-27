# PREREG-silac-v2: truth record (committed before any held-out FASTag run)

Written 2026-11-26 after the deposited search files were fetched and read, **before any held-out FASTag run**.
No FASTag output of a held-out run exists at this commit.

| Item | Value |
|---|---|
| Truth script | `truth_silac_v2.py` sha256 cc689d3acdd979c12e9c1105eec2bd3f7497d3b88e901f9260be068d89360647 (rule of PREREG section 3.3) |
| Truth table | `truth-silac-v2.tsv` sha256 5f970090aec352e575ab8d382640084ebb6d0970f7304bac58e5056f6cff6b8f (132 runs) |
| Harness generator | `make_harness.py` sha256 6f7693946354e7bffb7ef790923b1c4b5094ba99e2bfa2858b0de4fc267e29c7 (after deviation D1) |

Truth by class: Orbitrap 84 runs, 120 truth-present and 147 truth-absent label-run pairs, 20 light-only and 49
labelled runs; timsTOF 48 runs, 24 present and 129 absent pairs, 22 light-only and 13 labelled runs. Both classes
reach the 15/15 minimum of section 5 (conclusive).

How the rule was applied (implementation details, fixed before the run):
- MaxQuant evidence rows with MS/MS count >= 1 and labeling state >= 0; labels per state from mqpar.xml, else
  summary.txt (Labels0..2). PXD065290 deposits no label set: states from its deposited protocol text ("triple
  SILAC: heavy Lys8, medium Lys4, light Lys"); its sperm searches have no labels (ARI-sperm.raw: light-only).
- Renamed deposits matched by name rules (RAWMAP): PXD064721 '+' -> '-'; PXD066221 `*_TP|ssABE_LPS_<N>[HL]`
  -> `SILAC_<set>_rep<N>` (replicate number); PXD065290 `CCE<date>_..._rep<N>_..._hfx<k>` -> `SILAC-SFP-CCE<date>-rep<N>-hfx<k>`.
- PXD039806: FragPipe per-experiment `peptide_label_quant.tsv` (peptide level, tier T1-peptide), light and heavy
  forms with PeptideProphet probability >= 0.95; its K label is Lys6 (untested), its R label Arg6.
- PXD048421: PEAKS pepXML export (no PeptideProphet result: every exported top hit counts).
- PXD031924: PEAKS mzIdentML, rank-1 items with passThreshold.
- Not scored: PXD066863 (Lys6 only, `other_label`); PXD079824 (no per-run search for its timsTOF runs: the
  MaxQuant search holds the Lumos runs only, FragPipe only a combined table; `no_search`); PXD042191
  HFX201118_C_SRP72_05 (not in the deposited search; `no_search`).

Deviations so far (all before the run; listed again in the result):
- D0 PXD042191: its per-run search is in `others.tar` (MaxQuant txt), not in the frozen `search.tar` (MaxQuant's
  internal index only); `others.tar` was fetched in addition.
- D1 Input path: `pxd convert` refuses the pinned OpenMS FileConverter (its deployment tree sha256 changed:
  e36e496b... != pinned eb7c3b8b...), so the Orbitrap `.raw` runs are read directly by the frozen binary (the same
  OpenMS Thermo bridge, vendor centroiding). On the development control (PXD045734 ah_4068 UIF_IC) the `.raw` run
  gives the mzML run's label.tsv and tags.tsv byte for byte (input row aside; check run on kim, 2026-11-26).
- D2 Fetch over HTTPS instead of Globus (Globus ran at ~11 MB/s); not a protocol change.
- D3 timsTOF has 4 scored SILAC PXDs (PXD031924, PXD039806, PXD048421, PXD056725), not 5 (PXD079824 has no
  per-run truth); the 8-PXD target was already short at the freeze.
