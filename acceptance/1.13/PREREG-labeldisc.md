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
