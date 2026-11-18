# PREREG-alknodb: database-free call of the cysteine alkylation (`-alkylation_tags_out`, 1.13 backlog arm alknodb)

Status 2026-11-10: **FROZEN** in the commit that adds this file. Not run, not scored. The held-out split `alknodb`
(57 runs, one per PRIDE project) is run once and scored once; nothing is tuned on it; no re-run with other settings,
no re-scoring. A FAIL or INCONCLUSIVE is a valid result.
Draft and design: output/backlog-1.13/alknodb/{PREREG-draft,DESIGN,REASSESS,RESULT}.md.

## Question

Does `-alkylation_tags_out`, without a protein database, name the cysteine alkylation of a run correctly when it
makes a call?

## Frozen software

| What | Value |
|---|---|
| Candidate | branch `feat/b113-alknodb` at f002351 |
| FASTag binary | `data:/scratch/kohlbach/b113/alknodb/heldout/opt/FASTag` sha256 `de6a4f39cd77377ef1ac75716d3006576563ca4337e81784ce8e14773f7df67f` (copy of the DEV build; its source tree `src/` and CMakeLists.txt are byte-identical to f002351, 74 files compared by sha256) |
| CFG-alknodb-heldout-113 (primary) | `FASTag -in <mzML> -out <tsv> -tag_length 4 -extension 6 -fixed_modifications "" -fragment_tolerance 20 -fragment_tolerance_unit ppm -threads 8 -alkylation_tags_out <report>`; all other options at defaults (min_spectra 10, min_share 0.6, vote E <= 1e-4) |
| Secondary database call | the same options with `-alkylation_out <report> -alkylation_proteome /ceph/ibmi/abi/oliver/jpr-bench/data/PXD054073/UP000005640_9606.fasta`, only on rows with `db_fasta = human` (PRIDE lists Homo sapiens as the only organism; 25 rows) |
| Run script | `alknodb/scorers/run_alknodb.py` (checks binary and mzML sha256, refuses a second start) |
| Scorer and verdict | `alknodb/scorers/score_alknodb.py`; synthetic test `test_score_alknodb.py` prints `SYNTHETIC TEST PASS`. sha256 of all three in `alknodb/scorers/SHA256SUMS` |
| Conversion | ThermoRawFileParser 2.0.0 (`/ceph/ibmi/abi/oliver/prose-auto-20261029/env/bin/thermorawfileparser`, sha256 `73039004...ccb2`) `-f 2` |
| Manifest | `manifests/alknodb.tsv` sha256 `8320049a615d81f95528adb75001e694001a8b180e63550740630bfa46a1fc39` |

Commands on node data (env `/ceph/ibmi/abi/oliver/envs/fastag-omsdev`), in /scratch/kohlbach/b113/alknodb/heldout:

    python3 scripts/run_alknodb.py inputs/alknodb.tsv staged runs opt/FASTag de6a4f39cd77377ef1ac75716d3006576563ca4337e81784ce8e14773f7df67f 8
    python3 scripts/score_alknodb.py inputs/alknodb.tsv runs results

## Selection (all of it done before the freeze, without FASTag; scripts in `alknodb/scripts`, tables in `alknodb/inputs`)

1. Pool: `acceptance/1.12/inputs/h2r_pride_candidates.tsv`, instrument classes `qe` and `astral` (16,976 projects).
   Removed: every PXD in `alknodb/inputs/exclude_pxd.txt` (1,634: the draft's exclusion list, all acceptance
   branches, the species draft manifest, the reserved PXDs of HELDOUT-COMMON.md, every PXD named in
   output/backlog-1.13) and every PXD whose number is divisible by 4. 12,288 projects remain.
2. Draw: sorted, then shuffled with `random.Random("fastag-1.13:alknodb:heldout:2026-11-10")`
   (`draw_alknodb.py` -> `draw_order.tsv`). Everything below goes in this order.
3. Mechanical pre-screen of the PRIDE project record (`prescreen_alknodb.py` -> `prescreen.tsv`): projects naming DIA,
   targeted or top-down work are out; keyword classes CAM, OTHER, NONE (explicit negative) and NONE_B (no reducing or
   alkylating agent named in either protocol and a search stated to use no fixed / no cysteine modification). Read:
   the first 80 CAM, the first 130 OTHER and all 31 NONE / NONE_B candidates (241).
4. Truth (`truth.tsv`): five readers, who saw only the PRIDE record text (no FASTag output exists for any of these
   runs, and none was produced before the freeze), gave per project one class of the method (Carbamidomethyl,
   Nethylmaleimide, Methylthio, Propionamide, Carboxymethyl, none) with a verbatim quote of at most 14 words, or
   EXCLUDE. Excluded: no clear statement, two or more alkylation states or reagents in the project, a reagent the
   method does not name, kit without reagent, top-down / DIA-only / targeted-only. Two-key rule: a project is eligible
   only when the reader's class falls into the stratum of its keyword class; otherwise it is out and the next project
   of the stratum in draw order replaces it. Grade A = explicit statement about the sample preparation. Grade B
   (`none` only) = complete preparation described without a reduction/alkylation step and the search stated to use no
   fixed / no cysteine modification. Result: 145 eligible (CAM 75, OTHER 54, NONE 16), 96 out.
5. Run per project (`stage_alknodb.py` -> `staging.tsv`, all tried files): `.raw` files of at most 5e9 bytes, sorted
   by name; the first three are tried; a file qualifies with at least 5,000 MS2 spectra, every MS2 filter string
   FTMS or ASTMS, every MS2 filter string data-dependent. First qualifying file = the run. No qualifying file among
   the three (or no `.raw` file): project out, replaced by the next of its stratum. Staged: all 16 NONE, the first
   28 OTHER, the first 40 CAM; 70 qualify (CAM 33, OTHER 25, NONE 12).
6. Manifest: the first 30 CAM, the first 15 OTHER and all 12 NONE projects with a run, in draw order.
   Truth classes: Carbamidomethyl 30, Methylthio 7, Propionamide 6, Carboxymethyl 2, none 12 (grade A 3, grade B 9).
   `disjointness/alknodb.tsv`: overlap with the exclusion list 0 of 57, no PXD number divisible by 4.

## Criterion and verdict

Call of a run = `alkylation_tags_call reagent` when `status` is `call`; else no call.
Primary endpoint: accuracy among called runs = runs with call equal to truth / called runs, Wilson 95 % interval.

- INCONCLUSIVE if more than 10 % of the 57 rows give no report (technical failure); else
- FAIL if fewer than 30 runs are called or the accuracy among calls is below 0.80; else
- PASS if the lower end of the Wilson interval is at least 0.80; else
- INCONCLUSIVE.

Technical failure (rc not 0, no report, mzML sha256 mismatch): the row is `no_report`, counts as not called, is not
replaced and not rerun.
Secondary, no verdict: call rate overall and per stratum; recall of `none` on the NONE stratum; accuracy among calls
per stratum and per truth reagent; truth x call table with no-call reasons; agreement with the database call on the
25 human rows; the NONE results split by truth grade A / B (read from `calls.tsv` and the manifest).

## Deviations from the draft and from the task, fixed here before the run

- **57 projects (30 / 15 / 12), not 120 and not the minimum of 60 in 2:1:1.** The pool holds 31 projects whose record
  supports "not alkylated" at all; 16 passed the reader and 12 have a qualifying run. CAM and OTHER are kept at
  30 / 15; all 12 NONE are used.
- Truth source is the PRIDE project record (sample and data processing text), not the paper.
- NONE truth by grade B (9 of 12 rows) is an inference from a complete protocol plus the search settings, not an
  explicit statement. A wrong grade-B truth counts against the method.
- Thermo Orbitrap / Astral data-dependent runs with high-resolution MS2 only; timsTOF and other TOF data are not
  tested (no conversion path without FASTag).
- Peptide-level scope includes immunopeptidomics and other non-tryptic samples.
- The draft's "for 60 calls at least 54 right" is wrong: 54/60 gives a Wilson lower end of 0.7985; 55/60 is needed.
  The rule (lower end at least 0.80) is unchanged.
