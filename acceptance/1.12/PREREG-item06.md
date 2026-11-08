# PREREG-item06: #6 precursor charge inference (CFG-06-cand against CFG-06-base)

**Amendment 1 (round 3, 2026-11-08) at the end of this file supersedes the provisional rules below. CFG-06-base,
CFG-06-cand and their 0.5 Da ion-trap twins are `frozen`.**

Status 2026-11-08: **protocol fixed; not run, not scored.** This file fixes the truth search per run, the cells and
their pooling, the denominator and the scorer. Status of CFG-06-base and CFG-06-cand: **`blocked_user_signoff`**, not
`frozen`: the same open user decision as #2 (release readiness, decision 4) changes the sets this protocol scores
(PXD001540 has ion-trap MS2; no Astral H2 run). The provisional rules are below; when the user accepts them, the commit
that records the decision in this file sets the configs `frozen` (README gate), with an appended registry row and no
other change. E6-01 (DEV tuning) was not run: the RC constants
are the frozen values. Each config is scored once; nothing is tuned on held-out data.
Source: PLAN-data-types.md #6 (Default behaviour: "A later default of infer needs", Tests: Validation), registry
E6-01/E6-02, PLAN-INTEGRATION.md section 6 (#6).

## Frozen software and configs

| What | Value |
|---|---|
| RC | a117801; FASTag.bin `c4c2ad67fcd9106e474f552267f7cdfefe107f394b268bbc236308b773e4d7f3`; bundle SHA256SUMS `93a1ad6d1184b156febb15b9f564e36a0a974f989fe9e5e7d8cf4849927cc051` |
| CFG-06-base | `RC defaults (-unknown_charge assume2)`, param_hash `57ac9b063dc3f15fe78e1aa4e94b8e92debe8c75cfcc7bad79f94cffb0d47338` |
| CFG-06-cand | `-unknown_charge infer` (charge_min 2, charge_max 4, charge_infer_margin 2, isotope_error 0), param_hash `0f6bc39fad2cd9b68ad0b5235ce77bf04c1b1c312aa0aadc23f21ab160862a00` |
| Truth engine | Sage v0.14.7, binary sha256 `d3820543a31bfa2a556e04f91719204ce0ac6f34dcca6670314a13df87064625` |
| Input preparation | `scorers/strip_charge.py` `2b4e0c3753f7800c056f1be36ea7ba1872ccbec9ccdb4477a01adeaf561b34ab` |
| Scorer | `scorers/score_item06.py` `6eba125f39852862626b800826825acfa513e8645d3c8cf33836ebf6e2f009a0` (imports `score_item02.set_of`: `7928403d16627a7fab4f7e2faadaa76c87225b5f039ea42071af1f7a3b68c52e`), `scorers/acclib.py` `d2342eb4c15e5801d9c13f2edcd1e56cec70349c941df0db2d061bb6630eeedf`, fastag_bench `score.py` `e2b8788a78f1176169f617c01b2e17f21578b8909f7c79b33d23ae1b71075f79`, `parsers.py` `01e27548bcae489d3f205960730c8bc36624e16935ea5df0bec5a6a04ea51f49` |
| Truth configs | `scorers/truth_config.py` `899e387c2d08e02c371f7c1318994c0ecc3e0f208d7bce2eab740b0c25c66ec5` (`--mode charge_truth`) from `scorers/truth/item02.tsv` `6d46734dd6b915c521dba00d5edcfe533fe85bbe878483def888081f02064050` (rows `item06-H1`, `item06-H2`) |

As for #2, the frozen option strings use the RC's 20 ppm fragment tolerance on every run (on the ion-trap DEV run
PXD001819 that leaves about 4% rank-1 correct in both arms; PREREG-item02.md). The isotope-error guard is not involved
(isotope_error 0).

## Runs

- H1: `manifests/item06-H1.tsv` (`b95bcc442e7b36686d032532d0df054c21002a534f6804641a72c69f9b8e3600`, HO-06-H1): the
  #2 H1 files of PXD066944 (Astral), PXD000806, PXD001473, PXD002429 (ion trap) and PXD001540.
- H2: `manifests/item06-H2.tsv` (`de6bd3712a5c65455844b6574fbed7fb18529897b7ed4df99628b4cae8b3a2f7`), the #2 H2
  files; only to confirm a variant after an H1 failure. PXD035981 is not evaluable (no truth database).
- **Sets (provisional, user decision 4):** as #2: PXD001540 is scored in the ion_trap set, so H1 has two sets,
  astral (1 run) and ion_trap (4 runs), and no QE set. The PRIDE replacement reserve proposed for #2/#6 (cb76d59,
  not registered) would be added the same way as for #2 (PREREG-item02.md).

## Inputs and FASTag runs (cells)

- Charge-stripped copy of each staged input: `scorers/strip_charge.py <fastag_input> <run dir>/input.nocharge.mzML`,
  the RC's own derivation of the gate case charge_infer (`grep -v 'accession="MS:1000041"'`; on DEV PXD003531 it
  reproduces the gate input's sha256 19d8ee3f...cbccbd). Its sha256 is recorded with the run.
- Cells per run and arm: `S_L3`, `S_L4`, `S_L5` = the stripped copy at `-tag_length 3/4/5`; `G_L3` = the staged input
  as given at `-tag_length 3`. Command: `FASTag -in <input> -out tags.tsv -threads <n> <arm options> -tag_length <L>`
  into `runs/<CFG>/item06-H1/<run dir>/<cell>/`, `FASTAG_RC=<rc>` appended to `run.log`.

## Truth search per run

Sage 0.14.7 in mode `charge_truth` (`fastag_bench/sage.py`): the #2 closed search of the same run (database,
enzyme, modifications and tolerances of its `item06-*` row in `truth/item02.tsv`, see PREREG-item02.md) with
precursor_charge [1, 4] and isotope_errors [-1, 3], **on the charge-stripped copy**, so the charge is Sage's own
choice, not the header's. Target, rank 1, spectrum_q <= 0.01. The PSM charge labels the spectrum's precursor charge,
its isotope_error the isotope offset.

## Denominators, cells and pooling

- Charge-call accuracy (S_L3, candidate): truth spectra that the candidate tagged (at least one row); the call is the
  `prec_charge` of the spectrum's `selected` = 1 rows; a spectrum with two selected charges counts as wrong. The
  number of untagged truth spectra is reported.
- Flank-correct rank-1 (paper flank rule, rank 1 = first row; for the candidate the first row may come from any
  hypothesis): all truth spectra of the run, untagged = not correct, both arms. Cells: set x length (S_L3..S_L5) x
  Sage charge 2, 3, 4+ (the #2 cells) = 2 x 3 x 3 = 18 cells, spectra pooled over the runs of a set; peptide-cluster
  bootstrap and Holm exactly as PREREG-item02.md (i). Sage charge-1 spectra (only `infer` can call 1+) are reported
  apart per set and length, not gated.
- Per-set comparison for "better": S_L3, all charges pooled, per set.

## Acceptance for a later default `-unknown_charge infer` (all must hold)

1. Charge-call accuracy >= 0.90 (point; Wilson interval reported).
2. (a) Flank-correct rank-1 non-inferior in every cell (#2 margins: >= 200 clusters, point > -0.5, Holm-adjusted
   bound > -1.0; underpowered or empty cells block).
   (b) Better on at least 2 of 3 held-out sets: point > 0 and 2.5th bootstrap percentile > 0. **Provisional:** H1 has
   2 sets (astral, ion_trap), so both must be better.
3. No change on charged spectra: on `G_L3` the candidate's rows equal the baseline's rows on the baseline's columns
   (same number and order).
4. Any run with FASTAG_RC != 0 or without truth makes the verdict INCONCLUSIVE.

Reported, not gating (the plan's other metrics): the share of charge errors with `charge_src` ambiguous (target
>= 50%), truth 2+ spectra called 1+, the Sage isotope_error distribution (the candidate's isotope_error is 0, so no
isotope accuracy is gated and the MS1 envelope check and injected shifts of E6-01 are not run), and precursor-flank-only
rank-1 (`score.tag_correct_precursor_flank`) per set. The entrapment and random-spectrum controls of E6-01 are outside
this scorer.

## Scoring command

    python3 -I scorers/score_item06.py acceptance/1.12 item06-H1 <root>/runs <root>/truth <out>

Output to `results/item06/` with a registry row.

## DEV test of the scorer (DEV outputs only)

`scorers/tests/run_dev_tests.sh`: both arms on the DEV runs PXD003531 (#6 DEV) and PXD001819 (#2 DEV) in all four
cells with the RC bundle, truth = the paper harness's Sage searches (closed mode with header charges, so the DEV
truth charges are the header's; the held-out truth is charge_truth on the stripped copy). Result:
`scorers/tests/dev_results/item06.txt`, `dev_results/item06/`: charge-call accuracy 0.757 (21,328 spectra; 38% of the
errors flagged ambiguous), (2a) INCONCLUSIVE (every 4+ cell under 200 clusters), (2b) FAIL (ion_trap +0.02 points,
bound below 0; qe +0.82, bound +0.48), (3) PASS (G_L3 rows identical). DEV numbers, not a #6 result.


## Amendment 1 (round 3, 2026-11-08): ion-trap cells at 0.5 Da, revised sets, informativeness floor

Decisions 2 and 3 of `DECISIONS-2026-11-08.md`. This amendment replaces the provisional rules above wherever they
differ. It is committed together with the configs set to `frozen`, before any held-out run. Nothing has been run or
scored.

**Configs** (as PREREG-item02.md amendment 1):

| Arm | high-resolution runs | ion_trap runs |
|---|---|---|
| baseline | CFG-06-base `57ac9b063dc3f15fe78e1aa4e94b8e92debe8c75cfcc7bad79f94cffb0d47338` | CFG-06-base-it05 `11d1f6f7e51fe809569c7d59489a7fa858496d44b852a0cd456fad43c34f6aa3` |
| candidate | CFG-06-cand `0f6bc39fad2cd9b68ad0b5235ce77bf04c1b1c312aa0aadc23f21ab160862a00` | CFG-06-cand-it05 `a606fa84765aa41f9a62f3164717a9d296457abc2de0303e61469765eb0eefee` |

- The twins add only `-fragment_tolerance 0.5 -fragment_tolerance_unit Da`. They are used in every cell (S_L3..S_L5,
  G_L3) of the ion_trap runs, and each config is scored exactly once.
- The charge-stripped input and the charge_truth search are unchanged.

**Runs.**
- H1 is `manifests/item06-H1-r2.tsv` (`6103a749cde1ceff07aee6b97823f1871de5a5762af4e1b3c14487ff36bfb0c3`, HO-06-H1-r2), with 6 runs: astral 1 (PXD066944),
  ion_trap 4 (PXD000806, PXD001473, PXD002429, PXD001540) and qe 1 (PXD069528). `item06-H1` is not scored.
- The H2 reserve is `item06-H2` plus `manifests/item06-H2r.tsv` (`0104ecf607e6a0f27bd2da193c13c25e0f95e5855e86ffc6e51d77a3fcba4202`, HO-06-H2r), Astral PXD055983
  only (one run, underpowered). It is used only to confirm a variant chosen after an H1 failure.
- Truth: the `item06-H1-r2` and `item06-H2r` rows of `truth/item02.tsv` (mode charge_truth).

**Cells, endpoints.**
- (2a) covers 3 sets x 3 lengths x 3 charges = 27 cells.
- (2b) has its plan rule back: better on **at least 2 of the 3 sets** (astral, ion_trap, qe). It is no longer the
  provisional "both of 2".
- (1) and (3) are unchanged.

| Scorer file (scorers/) | sha256 |
|---|---|
| `acclib.py` | `7dd85f2888b4b082aae2762ca9ff4a8464adf1b811dafad01caf1551416ef15a` |
| `score_item02.py` | `f2693089ba38c71a3d0ab5984b2700348d16ef6a5014149c1e92c7dcba52900a` |
| `score_item06.py` | `ef24599a4e978e3ed67f100333fd4cdf10c5b48f59eb5470248a1a8ab52ecc72` |
| `score_item09.py` | `b0ef694172e5bb64e0487233819d663389cac0c4c3c540549bf2f8eef88cd3ca` |
| `truth_config.py` (unchanged) | `899e387c2d08e02c371f7c1318994c0ecc3e0f208d7bce2eab740b0c25c66ec5` |
| `truth/item02.tsv` | `42920f3b4d4b27ce72efc998aa12d156aaafcfd081fc0f350e916c9e8aba720e` |
| `truth/item09.tsv` (unchanged) | `fb13f923b75fa571c29aceab8ea7274bfc63b74b139b5539633222d3933b5b4b` |
| `strip_charge.py` (unchanged) | `2b4e0c3753f7800c056f1be36ea7ba1872ccbec9ccdb4477a01adeaf561b34ab` |
| `tests/run_dev_tests_r3.sh` | `818e8dc4f1896d51d91287b8d2f2225f2addbc3aae53db2ba8dbfdb31317eb3e` |

The fastag_bench files `score.py` (`e2b8788a78f1176169f617c01b2e17f21578b8909f7c79b33d23ae1b71075f79`) and
`parsers.py` (`01e27548bcae489d3f205960730c8bc36624e16935ea5df0bec5a6a04ea51f49`) are unchanged. Commit f93b33c
already carried the scorer edits of this amendment, before SHA256SUMS and this text were updated. Nothing was run in
between. The hashes above are the binding ones.

**Informativeness floor (audit finding).** Non-inferiority passed on cells where both arms are near zero. The scorer
now marks a cell `uninformative` when the reference (baseline) arm's rank-1 correct rate in that cell is below
**1.8%** (`acclib.INFO_FLOOR_PCT`). Such a cell is not tested, is not in the Holm family, and never counts as a pass.
Unless another cell fails, it makes the endpoint INCONCLUSIVE. The floor applies to every cell of the endpoint, in
every set.

The floor was derived from DEV ion-trap data only: the #2/#6 DEV run PXD001819 (LTQ Orbitrap Velos, ion-trap MS2),
tagged at 0.5 Da by CFG-02-base-it05 in the 18 cells of #2, scored against its paper-harness Sage truth
(`tests/run_dev_tests_r3.sh`; scored first without a floor,
`tests/dev_results_r3/floor_input_cells_i_nofloor.tsv`).
- The rule: one half of the lowest reference rate among the DEV ion-trap cells with at least 200 clusters, rounded
  down to 0.1 point.
- The lowest such cell is L5_nodeiso z3 at 3.678% (1,088 clusters), which gives 1.8%.
- The other powered DEV ion-trap cells at 0.5 Da are L3-L5 z2 at 18.8-35.3% and z3 at 3.7-6.9%. The z4+ cells
  have 106 clusters and are at 0.2-0.4%.
- At 20 ppm, 16 of the 18 DEV ion-trap cells are below 1.8% (`tests/dev_results/item02/cells_i.tsv`). These are
  the cells the audit named.
- No held-out file was read.

**DEV test (DEV outputs only).** `tests/dev_results_r3/item06.txt` and `dev_results_r3/item06/`. The verdict is FAIL.
Charge-call accuracy is 0.757. (2a) is FAIL: at 0.5 Da, four ion-trap cells fail. S_L3 z2 loses 0.6 points, and
S_L3/S_L4/S_L5 z3 lose 0.9-2.2 points (S_L3 z3: base 10.0%, cand 7.8%). The 4+ cells at S_L4 (1.0%) and S_L5 (0.4%)
are uninformative. (3) is PASS. These are DEV numbers, not a #6 result.


## Amendment 2 (round 4, 2026-11-08): low-resolution data removed; one scoring on the high-resolution H2/H2r runs

User decisions (B) and (D) of round 4, `DECISIONS-2026-11-08.md` (round 4). This amendment replaces amendment 1
wherever they differ. It is committed and pushed before any task it governs. No file of item06-H2 or item06-H2r has
been run or read by FASTag.

**H1 stays as scored.** item06-H1-r2 was scored once (HO-06-H1-r2-result, 607e625) and is INCONCLUSIVE under rule 4
(HO-06-H1-r2-result-corr1). It is never re-scored, and its ion_trap results are not revised.

**1. Low-resolution data removed.** The ion_trap set leaves #6: on H1 it is part of the scored INCONCLUSIVE result
and is not re-scored; on H2 its runs PXD000266 and PXD004644 are not run and not scored. CFG-06-base-it05 and
CFG-06-cand-it05 are not used again.

**2. What is scored (once).** The unused high-resolution runs of the reserve, by user decision (B), with the 20 ppm
configs CFG-06-base (`57ac9b06...`) and CFG-06-cand (`0f6bc39f...`):

| Manifest | Run | Set | Truth row |
|---|---|---|---|
| item06-H2 (`de6bd371...`) | PXD020394 NEG5 (Q Exactive Plus) | qe | `item06-H2` PXD020394, Homo sapiens, CAM static, Trypsin, 10 ppm / 20 ppm |
| item06-H2r (`0104ecf6...`) | PXD055983 20240312_AST1_EXT_CF_1139_sc_PR_NON_120 (Orbitrap Astral) | astral | `item06-H2r` PXD055983, S. cerevisiae, CAM static, Trypsin/P |

- PXD035981 (item06-H2, qe) is not evaluable (no truth database for 'gut metagenome'), as this PREREG stated before
  any run. It is excluded by name (`--exclude-pxd PXD035981`), not counted as a run without truth.
- This scoring supersedes the earlier rule that H2 is used only to confirm a variant chosen after an H1 failure: the
  user decided to score the same two configs once on the unused high-resolution reserve. It is the only scoring of
  CFG-06-base/cand on item06-H2/H2r.
- Each set has one run. Its cells are powered or not by their peptide-cluster counts, as before.

**3. Inputs, cells, truth (unchanged in form).** Charge-stripped copy by `strip_charge.py` (`2b4e0c37...`); cells
S_L3, S_L4, S_L5 (stripped copy, `-tag_length 3/4/5`) and G_L3 (staged input, `-tag_length 3`), both arms; truth
Sage 0.14.7 mode `charge_truth` on the stripped copy from `truth_config.py` and `truth/item02.tsv` (`42920f3b...`,
unchanged), target rank 1, spectrum_q <= 0.01.

**4. Endpoints (all must hold).**
1. Charge-call accuracy >= 0.90 (S_L3, candidate; pooled over the two runs).
2. (a) Non-inferiority in every cell, 2 sets x 3 lengths x 3 charges = 18 cells (>= 200 clusters, point > -0.5,
   Holm bound > -1.0, floor 1.8%; underpowered, empty or uninformative cells block).
   (b) Better on **both** sets present (astral, qe): S_L3, all charges, point > 0 and 2.5th percentile > 0 (the
   scorer's rule for fewer than 3 sets).
3. G_L3 rows of the candidate equal the baseline rows in both runs.
4. Any run with FASTAG_RC != 0 or without truth, including a truth with 0 PSMs at spectrum_q <= 0.01
   (`NO_TRUTH_0PSM`, round-3 audit finding 1), makes the verdict INCONCLUSIVE.

A PASS here is evidence for `-unknown_charge infer` on high-resolution MS2 only. It does not change the default by
itself; that remains a user decision, and H1 remains INCONCLUSIVE.

**5. Scorer.** `score_item06.py` (`7020e187e07588e2de3b77c6629cb8b1148392f23c2f37e24a1be3ef3bc04713`) with
`acclib.py` (`fe387a3455a52678f78c20c3156b63c251e08daa5b92da2f3e205d1d9ab2b1c1`) and `score_item02.py`
(`5704b8634c5a98f8993a4dccc4c331e6d84405dbf0b5dbaa42b523d68677e395`, for `set_of`). Changes, described in
PREREG-item02.md amendment 2, point 4: several manifests in one scoring (each run keeps its own manifest in its paths),
`--sets`, `--exclude-pxd`, `NO_TRUTH_0PSM`, and `acclib.native_key` (no effect here: no timsTOF IDs). The DEV
regression reproduces `tests/dev_results_r3/item06/` byte for byte.

**6. Erratum: scoring command.** `python3 -I` cannot import `acclib` (the script directory is off `sys.path` under
`-I`); the H1-r2 scoring ran without `-I`. The corrected command:

    <python 3.12.15, numpy 2.4.6, pandas 3.1.0> scorers/score_item06.py <acceptance dir> item06-H2,item06-H2r <runs> <truth> <out> \
        --sets astral,qe --exclude-pxd PXD035981

**7. Jobs.** `results/r4-jobs/` (BinAC2 `$FT/r4/jobs`): `item06-strip.slurm` (2), `item06-sage.slurm` (2),
`item06-fastag.slurm` (16 = 2 runs x 2 arms x 4 cells; refuses ion-trap rows), then `item06-score.slurm`. Runs go
to `$FT/runs/CFG-06-{base,cand}/item06-H2{,r}/...`, truths to `$FT/truth/item06-H2{,r}/...`. The run-start row is
pushed while the jobs are held; they are released after the push.
