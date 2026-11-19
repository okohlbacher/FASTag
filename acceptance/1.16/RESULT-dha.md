# RESULT-dha: held-out blind mass-shift survey, PXD045734 (scored 2026-11-19)

Scored once under PREREG-dha, AMENDMENT-1 and AMENDMENT-2 (author-approved), and AMENDMENT-3.

AMENDMENT-3 holds the execution details. **The executing agent wrote it on 2026-11-18, before any held-out FASTag or MSFragger output existed. The author has not yet seen it.**

Before scoring, the SHA256SUMS of `freeze1/`, `freeze2/` and `heldout/` were verified OK, and verified OK again after scoring. Gating arm: **blind** (no variable modifications). Intervals are exact Clopper–Pearson 95 %. A criterion passes on its lower bound (LB).

## Verdict

**B: FAIL.**

- G1 fails on its lower bound, with enough data, for two of the eight common shifts: Methyl@C −43.006 and unalkylated Cys −57.021.
- By AMENDMENT-2 §4, B fails when any criterion fails on its LB with enough data. This holds whatever the hand-check finds.
- The G4/G5 hand-check is still PENDING and should still be done. It is reported, but it cannot change the overall verdict.

| # | criterion | value (CP 95 %) | threshold | verdict |
|---|---|---|---|---|
| G1 | shift precision, 8 common shifts | see below; LBs 0.725–0.958 | LB ≥ 0.80 each | **FAIL** (2 of 8) |
| G2 | recovery among joined MSFragger positives | see below; LBs 0.619–0.933 | LB ≥ 0.60 each | **PASS** |
| G3 | site agreement, fragment-localized | 19,194/22,034 = 0.871 [0.867, 0.876]; null 97/40,511 = 0.24 % | LB ≥ 0.80; null ≤ 2 % | **PASS** |
| G4 | hand-check, common shifts | 100 calls sampled (10,317 eligible) | ≥ 80 correct | **PENDING** (hand-check) |
| G5 | rare shifts, all calls | −91.009 on C: 40 calls; −18.011 on S/T: 42 calls; −33.988 on C: 0 | LB ≥ 0.50 per shift with ≥ 20 calls | **PENDING** (−91.009, −18.011); **INCONCLUSIVE** (−33.988, 0 calls) |
| G6 | S/T enrichment of −18.011 | 42 of 85 calls on S/T; null mean 16.9; p = 0.0001 (smallest possible with 10,000 draws) | p ≤ 0.05 with ≥ 10 calls | **PASS** |
| G7 | naming, top 20 pooled rows | 17 of 20 | ≥ 14 | **PASS** |

### G1 / G2 per shift (blind arm, charge-given, joined spectra)

| shift | Da | G1 precision | G1 | G2 recovery (joined) | G2 | joined MSF positives |
|---|---|---|---|---|---|---|
| Oxidation | 15.9949 | 23,762/28,637 = 0.830 [0.825, 0.834] | PASS | 23,762/25,397 = 0.936 [0.933, 0.939] | PASS | 25,397 |
| Cation:Na | 21.9819 | 11,968/12,772 = 0.937 [0.933, 0.941] | PASS | 11,968/12,791 = 0.936 [0.931, 0.940] | PASS | 12,791 |
| Dioxidation | 31.9898 | 10,384/10,794 = 0.962 [0.958, 0.966] | PASS | 10,384/11,492 = 0.904 [0.898, 0.909] | PASS | 11,492 |
| Methyl@C (vs CAM) | −43.0058 | 4,391/5,961 = 0.737 **[0.725**, 0.748] | **FAIL** | 4,391/4,770 = 0.921 [0.913, 0.928] | PASS | 4,770 |
| Acetyl | 42.0106 | 4,672/5,374 = 0.869 [0.860, 0.878] | PASS | 4,672/7,419 = 0.630 [0.619, 0.641] | PASS | 7,419 |
| Carbamyl | 43.0058 | 4,476/5,367 = 0.834 [0.824, 0.844] | PASS | 4,476/6,118 = 0.732 [0.720, 0.743] | PASS | 6,118 |
| Carbamidomethyl extra | 57.0215 | 8,341/9,815 = 0.850 [0.843, 0.857] | PASS | 8,341/9,365 = 0.891 [0.884, 0.897] | PASS | 9,365 |
| Unalkylated Cys | −57.0215 | 1,486/1,948 = 0.763 **[0.743**, 0.782] | **FAIL** | 1,486/1,612 = 0.922 [0.908, 0.934] | PASS | 1,612 |

- Every shift has ≥ 30 joined positives, so no shift is INCONCLUSIVE.
- Dev LBs for the two failing shifts were 0.917 (Methyl@C) and 0.869 (unalkylated Cys).
- This result records what was measured. No cause was investigated, and nothing was tuned after the outputs were seen.

### G7 rows (blind arm)

- 17 of the 20 largest nonzero pooled rows count.
- The three that fail fail on (b), MSFragger confirmation:
  - +156.102 (Arg extension): 0.47;
  - +128.096 (Lys extension): 0.13;
  - +269.187 (+2 residues): 0.01.
- Table: `dha/score/G7_blind.tsv`.

### Runs

All 171 held-out runs passed every `check_*` row in all three arms. **No run was excluded** (`dha/score/run_checks.tsv`).

## Hand-check packets (G4, G5)

- **G4:** 100 items, `G4-001`…`G4-100`.
  - Stratified sample, seed 20261118.
  - Allocation (sampled / eligible calls):

    | shift | sampled | eligible |
    |---|---|---|
    | Oxidation | 28 | 3,174 |
    | Na | 9 | 1,255 |
    | Dioxidation | 8 | 590 |
    | Methyl@C | 23 | 2,650 |
    | Acetyl | 8 | 1,029 |
    | Carbamyl | 8 | 274 |
    | CAM extra | 8 | 559 |
    | unalkylated Cys | 8 | 786 |
- **G5:** 82 items, `G5-001`…`G5-082`.
  - All charge-given fragment-localized calls: 40 Cys→Dha at −91.009 on C, and 42 at −18.011 on S/T.
- **Packet contents:** each item folder holds `peaks.tsv`, `item.json`, `annotation.tsv` and `annotated.png`.
  - Ions: b/y 1+/2+ from OpenMS TheoreticalSpectrumGenerator, 20 ppm, one panel per candidate residue, in random order.
  - Each packet folder has a `handcheck.tsv` template with empty checker columns.
- **Locations:**
  - `output/features-1.16/item1-heldout/handcheck/{G4,G5}/`;
  - `data:/ceph/ibmi/abi/oliver/fastag-deepexam/heldout-dha/handcheck/`;
  - the `handcheck.tsv` templates also in `dha/handcheck/`.
- **Sealed, not for checkers:** the call lists and item keys in `/ceph/ibmi/abi/oliver/fastag-deepexam/heldout-dha/sealed/`. They were hashed before any packet was shown:

  | file | sha256 |
  |---|---|
  | G4_population.tsv | `40a6b881e0f6b889abff6373b6eb08b45561658ca080b1ae859b8d0e7ee10408` |
  | G4_sample.tsv | `71ce230acd93c9ec4d5614e62f2082e337192c890f6f99c89a9b9332cab4942b` |
  | G5_population.tsv | `abc5ef22fe8e4e8201772e061cd438351f437eb1598c7426f829eb2a2eddd457` |
  | G4_key.tsv | `740ee86926114788cea60908d2c24685a993f6c4bed152a1c4ecb297d42af43b` |
  | G5_key.tsv | `886a55c3c1f0a951d0ac1260b5df3ae425c29a5a7872e06f36d877f0a5568476` |
- **Protocol §4:** one checker, plus a second for every "wrong" and for a 10-item random overlap.
  - The verdict is derived at unblinding from (a), (b) and the key.
  - MSFragger site agreement of the same spectra is reported beside it from the key.

## Reported, not gating

- **Informed arm (variable Oxidation (M), Deamidated (N/Q)):**
  - G1 precision would fail for more shifts: Oxidation 0.799, Methyl@C 0.686, unalkylated Cys 0.497, and Carbamidomethyl extra 0.815 [0.806, 0.823] just above the line.
  - G7: 17 of 20. G6: 32 of 74 on S/T, p = 0.0001.
  - Tables: `dha/score/watch_main.tsv`, `G7_informed.tsv`.
- **Overall agreement on joined spectra:**

  | arm | joined | shift agreement | same peptide | missed-shift rate |
  |---|---|---|---|---|
  | blind | 664,342 | 0.723 | 0.857 | 0.006 |
  | informed | 595,156 | 0.652 | 0.862 | 0.101 |
- **Deamidation / 13C+1 (blind):** precision 0.631 / 0.898; recovery 0.892 / 0.602 (joined).
- **Rare shifts, shift precision (blind, all samples in the window, not only localized calls):**
  - −18.011: 0.917 [0.897, 0.934];
  - −91.009: 0.481 [0.421, 0.540];
  - −33.988: 11/24.
- **Recovery against all MSFragger positives** (placement-limited): 0.36–0.49 for the common shifts (`G1_G2_blind.tsv`).
- **Precursor-flank share (blind):** +1.003: 0.962; +2.007: 0.999; +0.984: 0.436.
- **Entrapment run (informed + shuffled proteome):** 1,862 of 439,935 gapped samples = 0.42 % (dev 0.40 %); localized 170 of 66,514.
- **Charge-assumed stratum (blind):**
  - 56,833 of 812,099 samples (7.0 %);
  - gap precision 0.205, against 0.713 for charge-given.
- **Reconciliation (blind):**

  | MS2 read | tagged | placed | samples |
  |---|---|---|---|
  | 5,284,802 | 3,649,456 | 833,081 | 812,099 |

  - The samples are 313,449 exact, 482,111 region gaps and 16,539 terminal gaps.
  - Fragment-localized: 40,842. All sum checks are ok.

All tables are in `dha/score/`.

## Commands, versions, runtimes (data node)

**FASTag**
- `feat/deep-exam` `425f16b2` (`v1.15.0-35-g425f16b2`), fresh checkout.
- Built against OpenMS develop `70cebcd144` (env `fastag-omsdev`); binary sha256 `054c3819…ec84`.
- Reproduces the dev survey outputs byte-identically (48/48 files).
- Command: `heldout/heldout_fastag.sh runs_heldout.txt /scratch/kohlbach/heldout-dha/mzML /scratch/kohlbach/heldout-dha/fastag`, with the arguments of `freeze2/item1_dev3.sh`.
- Runtime: 1,074 s wall for 3 arms × 171 runs; sums 319 s blind, 310 s informed, 439 s entrapment; peak RSS 0.80 GB.

**MSFragger**
- MSFragger 4.4.1 under Java 21.0.12.1.
- Command: `heldout/heldout_msf.sh … freeze1/open.params`. The params sha256 was checked, and the target+decoy database was checked byte-identical to dev.
- Runtime: one invocation, 2:11:13 wall, peak RSS 31.7 GB; 1,129,385 PSMs at q ≤ 0.01 across 171 runs.

**Scoring**
- Command: `python3 -I heldout/harden_heldout.py freeze2/harden_analysis.py <fastag> <msf> runs_heldout.txt score/`.
- Runtime: 3,114 s.

**Packets**
- `handcheck_packet.py` under pyOpenMS 3.4.1 (env `pyprophet`), with matplotlib 3.10.9.
- Runtime: 1,145 s.

**Inputs**
- 171 mzML from ThermoRawFileParser 2.0.0.0 (`-f=2 -L=1-`); see `dha/STAGED.md` and `mzML.SHA256SUMS`.

## Amendments

- AMENDMENT-1 and AMENDMENT-2: author-approved.
- **AMENDMENT-3** (2026-11-18, commit `800e8549`): execution details, written by the agent before any held-out output existed. Not yet seen by the author. It sets:
  - run exclusion;
  - per-shift INCONCLUSIVE below 30 joined positives;
  - the G4 population (any residue), allocation and sampling;
  - charge-given G5/G6;
  - the G7 row reading;
  - packet blinding with a sealed key.

  No change was made after the held-out outputs were seen.

## Storage

| what | where | size |
|---|---|---|
| RAW (new) | `/ceph/ibmi/abi/dont-backup/pride/PXD045734/raw/` | 60.3 GB |
| mzML (new) | `/ceph/ibmi/abi/dont-backup/pride/PXD045734/mzML/` | 46.9 GB |
| scratch: mzML copies, FASTag arms, MSFragger | `data:/scratch/kohlbach/heldout-dha` | 29 GB on disk |
| results, packets, sealed lists | `/ceph/ibmi/abi/oliver/fastag-deepexam/heldout-dha` | packets 32 MB |
