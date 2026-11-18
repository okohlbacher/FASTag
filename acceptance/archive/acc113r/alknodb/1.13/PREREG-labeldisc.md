# PREREG-labeldisc: database-free label discovery (`-label_discovery_out`), evaluation 2

Committed 2026-11-10 **before any tuning** of the fixes on branch `feat/label-discovery` (base 55d2b46 +
merge of origin/main 076984a, FASTag 1.12.2) and before any FASTag run on the TEST half or the held-out set.
The frozen software (commit, binary sha256, options, thresholds) is added in addendum A1, committed before the
first TEST or held-out run. Each set is run once and scored exactly once; nothing is tuned on the TEST half or the
held-out set; no criterion is relaxed after this commit; a FAIL is a valid result.

## What is tested

The first evaluation (`output/label-discovery/EVALUATION.md`, branch 1cdcb65) found 67 of 159 label-free runs
with a false label call, among them the gate input PXD003531 (`unknown:N+0.9839`). The fixes under test: null
images from neutral losses (NH3, H2O) of every unlabelled image type and of the precursor; a stronger evidence
bar for unknown offsets, with a lower bar for known labels (TMT, TMTpro, iTRAQ4/8, SILAC Lys4/6/8 and Arg6/10,
dimethyl light/medium/heavy, Unimod labels with N-term or K specificity); and an honest iTRAQ8/TMTpro decision
(a corrected calibration uncertainty, else `isobaric_ambiguous`). The thresholds are set on the DEV half only.

## Sets (`labeldisc/manifests/`)

| set | what | rows scored | use |
|---|---|---|---|
| DEV | `split-256.tsv` half DEV, scored rows `labeldisc-dev256.tsv` (sha256 831ee43246f62d37292c7d16169c71fdb0b48f12118cd74a0c4505ec001339e0) | 99: label-free 80, TMT 7 (incl. the PXD000001 extra), TMTpro 3, iTRAQ8 2, iTRAQ4 1, SILAC 6 | tuning, any number of runs |
| TEST | `split-256.tsv` half TEST, scored rows `labeldisc-test256.tsv` (sha256 fb1b2fb5beabd80dc2b8ef9904df66dbe5b31254d4c4b9865f03bc79fccabceb) | 95: label-free 79, TMT 7, TMTpro 3, iTRAQ8 1, SILAC 5 | scored once after the freeze |
| HELD-OUT | `heldout_A.tsv` (sha256 fe4b2bb52a3e02ea7df6815ddc3c604a532762ca344bcfeef13a85e38ac67c10) + `heldout_B.tsv` (sha256 8f7249cf18bb66dc54ef84696a153ad0763c6d663eb2f8cf7c7667d60555d345), as one set | A 172 (label-free 150, SILAC 15, TMT 4, TMTpro/iTRAQ8 3) + B 18 (TMT 6, TMTpro 6, iTRAQ4 6) | scored once after the freeze |

- **Split** (`scripts/split_labeldisc.py`, sha256 3c835db6c17efe82b0fbd27f1e1a70fdd3b1e90dcacbeff877718be8ab2e397c, over `inputs/runs256.tsv` 9af0b87b24f35ae8d56f535499409026b754995ae19721b41864de268db30f8d): the
  256 runs of the first evaluation by PXD (236 PXDs: 117 DEV, 119 TEST), stratified by the rarest truth class of
  each PXD, balanced on evaluable runs; PXD001587, PXD004541 (the implementation probes) and PXD003531 forced into
  DEV. Scored rows: the 193 label-evaluable runs and the PXD000001 extra (SDRF TMT); PXD000865 (truth "?") is not
  scored.
- **The TEST half is not blind.** Its runs were part of the first evaluation's aggregate numbers, and some were
  named there (PXD001670, PXD047517, PXD037434, PXD073683, PXD025560, PXD079013, PXD027945 ...). It is "never
  used for tuning", nothing more. The held-out set is the confirmatory one.
- **Held-out A**: the 172 included rows of `manifests/item08-heldout.tsv` (bigbio 452596762d38, outside the 234
  DEV PXDs; staged 2026-11-08, sha256 per input in the manifest). `-label_discovery_out` was never run on them;
  item #8 scored `-label_out`'s `label_call` on them (a different output; its result is known).
- **Held-out B**: new labelled runs, `scripts/select_heldout_labeldisc.py` (sha256 3de9c2c25ed40d33659de86815519da1012a2af07d8e509f58c86a4d36e5ec3d, the
  revision used; rule in its header) over `bigbio_runs.tsv` (sha256 f12594abc824cc6c79df7cf8e682e3bd2477e9002faa4776d2be6dbdb5fbb513) and `excl_chem.txt`
  (4fae9263b4ffad61f4a28508020b2137d7bad2cf37c23155804b2ebb1505fb69): PXDs outside the 256, `excl_chem.txt` and every PXD named in an acceptance/1.12 or 1.13 TSV;
  Trypsin; DDA; Thermo .raw <= 6 GiB on PRIDE; high-resolution collisional MS2 by the SDRF; 6 runs per class, at
  most 2 per PXD. Revision 1 of the rule replaced try 0 (HCD named in the dissociation column, 3 GiB) before any
  download, because SDRFs call Q Exactive HCD "collision-induced dissociation" (`manifests/selection-try0/`).
  iTRAQ8 and dimethyl have **no** eligible run: their only pool PXDs (PXD030690, PXD067243) are not in PRIDE. So
  the held-out set cannot test iTRAQ8 naming or dimethyl; that stays a DEV-only, descriptive statement.
- **Disjointness** (`manifests/disjointness.tsv`): 162 A PXDs and 18 B PXDs, none among the 236 PXDs of the 256
  runs, none shared between A and B.
- Inputs of B: staged by `scripts/stage_pride_labeldisc.sh` (acceptance/1.12 `stage_pride.sh`, root
  `data:/scratch/kohlbach/fastag-labeldisc/heldout/in`; PRIDE SHA-1 or size plus a second identical download;
  ThermoRawFileParser 2.0.0 -f 2). The B manifest with each input's sha256 is committed (addendum A0) before any
  FASTag run; a failed download stays in the denominator as a no call.

## Runs

Node data, `FASTAG_FULL_PRECISION=1`, no `-fasta`, the frozen binary of addendum A1, `-label_out` and
`-label_discovery_out` in the same run:

- DEV and TEST: the stored item05 arm-B label-report command of each run with `-label_discovery_out` added, as in
  the first evaluation (`eval/scripts/run_eval.py`), 8 threads.
- HELD-OUT: `-tag_length 4 -threads 8 -subsample_fraction 0.25 -fragment_tolerance 20.0
  -fragment_tolerance_unit ppm -digest_out ... -label_out ... -label_discovery_out ...` (the item #8 termini
  command at 8 threads; thread count does not change either report).

## Endpoints (`labeldisc/scorers/score_labeldisc.py`, sha256 efeaa227d760a283e1f0bf7e3be245522b210ede8fd345b17d76e2fa382c10b8)

Classes, tokens and the strict correctness rule are in the scorer's header. In short: truth = SDRF label class
(TMTpro and iTRAQ8 one class); an `ld_call` is correct when its status is `call` and every label token has the
truth class (a call with an extra `unknown:` or other label is wrong); a no call is wrong.

- **P1 (primary, safety):** false label calls on the label-free runs of the set (status `call`, label not
  `label-free`). **PASS iff 0.** Reported with the Clopper-Pearson 95% interval and one-sided 95% upper bound.
- **P2 (primary):** correct(ld_call) >= correct(majority baseline) on the set.
- **P3 (primary):** correct(ld_call) >= correct(label_call of the same run), paired.
- Descriptive: Wilson intervals, confusion, per-class recall, lenient correctness, sign tests, no-call reasons,
  the names given to TMTpro/iTRAQ8 runs.

A false call on a label-free run counts even when `label_call` agrees with it (a possible SDRF error is reported
as such, not removed).

**Decision rule.** `-label_discovery_out` stays an experimental, opt-in report in any case. Its call may be
described as "no false label calls on held-out label-free runs" only if P1 PASSES on both TEST and HELD-OUT. A
change of `label_call` reading `ld_site` is not part of this item. Option off must remain byte-identical (gates).

## DEV scorer check (in-sample, first-evaluation outputs, DEV half only)

`score_labeldisc.py` on the first evaluation's DEV reports (branch 1cdcb65): P1 32/80 false calls (FAIL),
correct ld 50/99, majority 80, label_call 81. The TEST half of the first evaluation was not re-scored.

## Addendum A1: frozen software (2026-11-10, committed before any TEST or held-out run)

Fixed after the DEV runs only (DEV half, `output/label-discovery/eval2/dev/`); the TEST half and the held-out set
have not been run with any evaluation-2 build.

| What | Value |
|---|---|
| Source | `feat/label-discovery` **fda6026** (76bdff8 = 55d2b46 + merge of origin/main 076984a, then the fixes) |
| FASTag binary | BinAC2 job 6515072 build of fda6026, `data:/scratch/kohlbach/fastag-labeldisc/frozen/FASTag.bin`, sha256 **c9275d35c47439be0110426c19a40721368798546ab0644a3f1296f17e4f5f1f**; wrapper `frozen/FASTag` b84c190a1348e2f4c8435671fc27c94e0af89691d8ca7bebeef7efcca5fdb43b (sets OPENMS_DATA_PATH to OpenMS 70cebcd144) |
| Checks of that build | BUILD_RC=0; ctest 70/70 passed (3 environment skips); `gate.sh` vs refs-1.12.0 GATE PASS (9 cases); `gate_new_cases.sh` NEW CASES PASS (8 cases). On data its DEV reports equal the data build's (126/126 runs, run rows aside) |
| Digest tables | `frozen/digest`: digest_models.tsv b486bbb2...7c36, massgap_mods.tsv c1ec6f57...a106 (= the branch's `data/digest`) |
| Thresholds | the code's defaults; the DEV-fitted evidence bar `tier_min_relative` 0.15 / 0.35 / 0.5, `tier_min_clean_share` 0.02 / 0.1 / 0.2, `tier_min_ladder` 0 / 3 / 5 (tiers 0 known label, 1 Unimod label, 2 other); all `-label_discovery_*` options at their defaults |
| TEST runner | `labeldisc/scripts/run_set.py` sha256 4e5103f383ab8851221a69d216141a4393aad7c419318803f2dd810e3394a54d (`split-256.tsv TEST`, 14 jobs) |
| Held-out runner | `labeldisc/scripts/run_heldout_labeldisc.py` sha256 34b1bcff09ed8c940ac31e6068586423a417fe7580c58cfb103e08f6a30a053d (checks the binary and each input sha256) |
| Scorer | unchanged, `score_labeldisc.py` efeaa227d760a283e1f0bf7e3be245522b210ede8fd345b17d76e2fa382c10b8 |

Configs (`frozen-configs.tsv`): CFG-LD-test-113 (param_hash 95da356cbb9dcc0418c9217fb7b07a39f1413f8c905aa9ef98e09b3f1de23c76),
CFG-LD-heldout-113 (060499a3dc4ed82a862013887f8ed398f39546413c1a71a26a22893da2dd8ff1); hash as acceptance/1.12.

DEV result of this binary (in-sample, the tuning set): P1 3/80 false label calls (FAIL; all three, iTRAQ8plex on
PXD041747, K:Lys8 on PXD066890, iTRAQ4 on PXD006679, agree with `label_call` and look like SDRF errors), P2 85/99
correct against the majority's 80 (PASS), P3 85 against `label_call`'s 81 (PASS). Thread determinism: the report is
byte-identical at 1, 8 and 24 threads on PXD004541, PXD001587, PXD001540 and PXD003531, with and without
FASTAG_FULL_PRECISION.

Commands (node data):

    python3 -I labeldisc/scripts/run_set.py labeldisc/manifests/split-256.tsv TEST \
      /scratch/kohlbach/fastag-labeldisc/frozen/FASTag /scratch/kohlbach/fastag-labeldisc/eval2/test 14
    python3 -I labeldisc/scorers/score_labeldisc.py labeldisc/manifests/labeldisc-test256.tsv \
      /scratch/kohlbach/fastag-labeldisc/eval2/test labeldisc/results test

## TEST half: scored once (2026-11-10, node data, CFG-LD-test-113)

`results/summary_test.json`, `results/per_run_test.tsv` (130 runs, all rc 0; 95 scored rows):

- **P1 FAIL:** 4 of 79 label-free runs with a label call (5.1 %, Clopper-Pearson 95 % 1.4-12.5 %, one-sided upper
  11.2 %): R:Arg10 (PXD017052), TMT+K:TMT (PXD027945), iTRAQ8plex (PXD003575), Dimethyl:2H(4) (PXD078554).
- **P2 FAIL:** correct 68/95 against the majority's 79/95 (sign test p = 0.09).
- **P3 FAIL:** correct 68/95 against `label_call`'s 70/95 (p = 0.77).
- No calls: 21 (few_spectra 10, no_reference 11), 19 of them on label-free runs.

Nothing was changed after this result.

## Addendum A0: the held-out manifest (committed before any held-out run)

`labeldisc/manifests/labeldisc-heldout.tsv` sha256 **6290a0f62268f22d0c010bc27e4ebb8908cf5cf2483168ccde8071cb57044311**: 190 rows, all included, every input staged (part A:
the item08 inputs and sha256 unchanged; part B: `staged_B.tsv` and one retry, `staged_B_retry1.tsv`, of the 4
downloads PRIDE broke off; all 18 B inputs converted, rc 0). Built by `scripts/build_heldout_manifest.py`
(sha256 f3d729c3798c34395a23c87766933af68b1773200494397b26a56d1189c871cd).

    python3 -I labeldisc/scripts/run_heldout_labeldisc.py labeldisc/manifests/labeldisc-heldout.tsv \
      /scratch/kohlbach/fastag-labeldisc/frozen/FASTag /scratch/kohlbach/fastag-labeldisc/frozen/FASTag.bin \
      c9275d35c47439be0110426c19a40721368798546ab0644a3f1296f17e4f5f1f /scratch/kohlbach/fastag-labeldisc/frozen/digest \
      /scratch/kohlbach/fastag-labeldisc/eval2/heldout 8
    python3 -I labeldisc/scorers/score_labeldisc.py labeldisc/manifests/labeldisc-heldout.tsv \
      /scratch/kohlbach/fastag-labeldisc/eval2/heldout labeldisc/results heldout

## HELD-OUT: scored once (2026-11-10, node data, CFG-LD-heldout-113)

`results/summary_heldout.json`, `results/per_run_heldout.tsv`, `results/heldout_inputs_verified.tsv` (190 of 190
inputs sha256 OK; 187 runs rc 0, 3 refused as raw DIA by the acquisition check, rc 11, scored as no calls):

- **P1 FAIL:** 6 of 150 label-free runs with a label call (4.0 %, Clopper-Pearson 95 % 1.5-8.5 %, one-sided upper
  7.7 %): K:Lys6 (PXD011457), Dimethyl (PXD062076, a TAILS run; PXD003342), TMT+K:TMT (PXD059755, PXD029210),
  K:Lys8 (PXD002759, "lab_eff"). `label_call` agrees on three (both TMT, the Lys8).
- **P2 FAIL:** correct 96/190 against the majority's 150/190 (65 label-free runs are no calls: few_spectra 39,
  no_reference 23, DIA refused 3).
- **P3 PASS:** correct 96/190 against `label_call`'s 91/190 (11 vs 6 discordant, sign test p = 0.33).
- Labelled runs (40): correct ld 17, label_call 13. iTRAQ8 named twice (PXD008165, PXD008152, both SDRF iTRAQ4,
  304.20 Da flanks); TMTpro 5 of 9; one TMTpro|iTRAQ8plex ambiguous.

Decision rule: P1 fails on both TEST and HELD-OUT, so the report is not described as free of false label calls; it
stays experimental and opt-in. Nothing was changed after the result.
