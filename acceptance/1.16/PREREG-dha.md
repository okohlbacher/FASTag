# PREREG-B: blind mass-shift survey, PXD045734 held-out donors (frozen 2026-11-18)

Status: **signed off by the author on 2026-11-18** (171-run held-out split, thresholds as below, ~60 GB of held-out RAW). Frozen in `dha/freeze1/` (SHA256SUMS) at FASTag `47181587`; nothing has been run on a held-out run. Scored once; later changes are dated amendments.

Development evidence: `output/features-1.16/item1-dev/RESULT.md` and `OPENSEARCH-DEV.md` (not in the repository) (six runs of the 57-year-old donor). Plan: `output/features-1.16/PLAN.md`, "Acceptance for B".

## 1. Runs

`runs.tsv` lists all 180 RAW files of PXD045734 (from PRIDE's file list): name, size, SHA-1, series, donor token and split.

| split | runs | size |
|---|---|---|
| dev (the six development runs) | 6 | 2.0 GB |
| excluded: same donor as dev (57 y, the three `_OC_` runs) | 3 | 1.0 GB |
| held-out, other donors, series 4068 (21, 48, 50, 64 y) | 36 | 11.2 GB |
| held-out, all other runs | 135 | 49.0 GB |

**Needs the author: what "donor 4068" means.** "4068" is a sample series in the file name, not a donor. Under it are the 57-year-old dev donor and the 21-, 48-, 50- and 64-year-old donors; the donor is the age token. This draft holds out every run not of the dev donor (171 runs) and excludes the dev donor's 3 remaining runs.

The literal reading, "all runs not of series 4068", would hold out 135 runs. It would also drop 36 runs of four other donors that development never saw. The 72 `pQE4_pp` runs (2022, donors 211 and 233 and two batches without a donor in the name) are held out under either reading.

## 2. Pipeline (frozen at sign-off)

- **Conversion:** ThermoRawFileParser, as for the dev mzML: peak picking on, indexed mzML. Archive the SHA-256 of each mzML.
- **FASTag:** `feat/deep-exam` at the sign-off commit (`59492fa2` or later), with the dev arguments plus `-delta_spectra_out`:
  ```
  -fragment_tolerance 20 -fragment_tolerance_unit ppm -extension 3
  -variable_modifications "Oxidation (M)" "Deamidated (N)" "Deamidated (Q)"
  -recon_fasta uniprot-human-22.fasta -recon_out -recon_localize -delta_out -delta_spectra_out -threads 32
  ```
  The defaults are frozen: `-delta_group 0.004`, `-recon_sub_tolerance 5 ppm`, `-delta_name_tolerance 10 ppm`.
- **MSFragger 4.4.1:** `../item1-dev/open.params` unchanged, with the target + reversed-decoy database of `opensearch.sh`. Per-run target-decoy competition on `expectscore`, q ≤ 0.01. The scripts are `../item1-dev/compare_open.py` and `rows_vs_msf.py`, as run on dev.
- **Pooling:** `../item1-dev/pool2.py`: all held-out runs pooled, rows grouped within 4 mDa.

## 3. Metrics and thresholds

The "Dha shifts" are:
- Cys→Dha at **−91.009** on C (against carbamidomethyl-Cys; carbamidomethyl is fixed). Dev showed that Cys Dha appears here, not at −33.988.
- Cys→Dha at **−33.988** on C (unalkylated Cys).
- Ser→Dha / Thr→Dhb at **−18.011** on S or T.

A **FASTag Dha call** is a `-delta_spectra_out` line with |delta − shift| ≤ 0.01 Da whose `localized` site class has the expected residue: C (or N-term|C, C-term|C) for the Cys shifts, and S or T (including terminal-ambiguous) for −18.011.

### Gating criteria (all must pass)

| # | metric | threshold | dev value | why this threshold |
|---|---|---|---|---|
| B1 | Presence: pooled localized calls on C (−91.009 or −33.988), and separately on S/T (−18.011) | ≥ 10 each | C 2, S/T 1 (6 runs) | the plan asks that the paper's shifts appear with C and S/T among localized observations; at the dev rate, 171 runs give about 57 C and 28 S/T calls; 10 rules out a few stray calls |
| B2 | Hand-checked precision of FASTag Dha calls (protocol §4) | ≥ 0.80, i.e. ≥ 40 of 50 correct; with fewer than 50 calls, all are checked and the same share applies with n ≥ 30 | 12 of 14 sites agree with MSFragger (0.86) | the plan's threshold; dev agreement is consistent with it |
| B3 | Shift precision of the Dha calls against MSFragger (joined calls with massdiff within 0.01 Da of the shift) | ≥ 0.80 | −18.011: 0.97; −91.009: 1.00 | the plan's independent search; for the shifts away from 1 Da, dev precision is 0.83–1.00 |
| B4 | Naming: of the 20 largest nonzero pooled rows, those with a Unimod name (or an `isotope_error` reading) whose mass MSFragger confirms (≥ 50 % of the row's joined spectra within 0.01 Da) | ≥ 14 of 20 | 16 of 20 | coverage counts every top-20 row, so selective naming cannot pass; 14 leaves room for donor variation |

For B4, a row named only by an isotopic label (`Label:15N(1)`, `Label:18O(1)`) counts only if its `isotope_error` cell is set.

B1–B4 hold if every one holds. A criterion with too few spectra (B2 with n < 30) is **inconclusive**, not passed, and so is B.

### Reported, not gating (dev values in OPENSEARCH-DEV.md)

- The OPENSEARCH-DEV.md table for every watch shift:
  - FASTag n, joined n, precision, MSFragger n, recall, site agreement;
  - shifts: deamidation, 13C+1, oxidation, Na, Dioxidation (W), Methyl@C, Acetyl, Carbamyl, extra carbamidomethyl, and the three Dha shifts.
- Overall peptide and shift agreement on joined spectra (dev: 0.90 and 0.72).
- Localized share of gaps (dev: 46.1 %).

**Refinements against PLAN.md, with reasons:**
- **Cys Dha mass:** the plan names Cys −33.988. With carbamidomethyl fixed, the Cys Dha gap is −91.009 (dev: 3 spectra there, 0 at −33.988), so both masses count.
- **−18.011 is mostly not S/T Dha:** on dev it is mostly N-terminal pyro-Glu (E) and Asp succinimide in both engines (only 1 of 12 localized calls on S/T). The S/T part of B1 can therefore fail for chemical reasons. It is kept, because it is the paper's claim, and a failure is reported as such.
- **Deamidation and 13C+1 are not gating** (dev precision 0.69 / 0.78):
  - the ±0.01 Da windows at 0.984 and 1.003 overlap FASTag's gap error;
  - MSFragger does not localize offsets under 1.5 Da, so their sites cannot be checked.
- **Hand-check count:** the plan fixes 50 spectra. Dev yields about 0.5 Dha calls per run, so the 171 held-out runs may give fewer than 50; hence the n ≥ 30 rule and the inconclusive outcome.

## 4. Hand-check protocol (50 spectra)

1. **Population:** all FASTag Dha calls (§3) in the held-out runs, pooled.
2. **Sample:**
   - with more than 50 calls: a stratified random sample of 25 Cys calls (−91.009 and −33.988) and 25 S/T calls (−18.011), Python `random.Random(20261118)` over the calls sorted by (run, scan); a stratum with fewer than 25 is taken whole and the other filled up to 50;
   - with 50 or fewer: all calls.
3. **Blinding:** the checker sees, per spectrum:
   - the peak list (the mzML spectrum) and the precursor;
   - FASTag's peptide with the shift on **each** candidate residue of the gap region, in random order;
   - not FASTag's chosen site, not MSFragger's result, and not the run's donor.
4. **Annotation:** b/y ions (1+ and 2+, 20 ppm) for each candidate placement, drawn with OpenMS's `TheoreticalSpectrumGenerator`, and the shifted and unshifted ions marked. The checker records:
   - (a) whether the peptide explains the spectrum: at least 6 matched b/y ions, the major peaks explained;
   - (b) which candidate residue(s) the site-determining ions support: ions present that are shifted on one candidate and not on the others;
   - (c) a verdict: **correct** (a holds and b singles out FASTag's residue), **ambiguous** (a holds, b does not separate the residues), or **wrong** (a fails, or b supports another residue).
5. **Score:** precision = correct / (correct + ambiguous + wrong). Ambiguous counts against.
   - Report the Wilson 95 % interval.
   - Report the MSFragger site agreement of the same spectra beside it.
6. **Who:** one checker, plus a second for every "wrong" and a 10-spectrum random overlap; disagreements are resolved by discussion and recorded.
7. **Records:**
   - `handcheck.tsv`: run, scan, peptide, candidates, verdict, ions cited, checker;
   - the annotated plots;
   - the sampling seed and the full call list, archived before unblinding.

## 5. What is not claimed

- No frequencies of modifications.
- No FDR for FASTag's rows.
- No result on PXD040281; it is a separate hypothesis test (PLAN.md).
- Passing B shows that FASTag's localized Dha calls on these runs are mostly right, and that its top names have masses an independent search confirms.
