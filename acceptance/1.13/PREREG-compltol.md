# PREREG-compltol: run-measured complement tolerance (CFG-CT-cand against CFG-CT-base)

Backlog item 15 (output/BACKLOG.md: "`auto` from high-confidence complement pairs; held-out test like #2").
Status at this commit: **protocol fixed; not run, not scored.** Manifest, configs and scripts are committed before
any held-out FASTag run of this item. Nothing of this item has been run on a held-out file. Each config is scored
exactly once; nothing is tuned on held-out data; no criterion may be relaxed after this commit. A FAIL is a valid
result: the option then stays experimental.

Design and margins: those of #2 (`acceptance/1.12/PREREG-item02.md` with amendments 1 and 2), applied to a new
pair of configs. Only the configs, the manifest (below) and the set list differ.

## Frozen software and configs

| What | Value |
|---|---|
| Binary | `feat/b113-compltol` c5f96b5, built on IBMI node data (OpenMS 70cebcd144, env fastag-omsdev), FASTag.bin sha256 `b7a1701c7cbe85d6ba7c9ecc270046a86e514e2eed45e4cd2eab78814d3ffac9`; on data gate.sh vs refs-1.12.0 GATE PASS (9 cases) and ctest 67/67 (FASTAG_BASELINE_REQUIRED=1) |
| CFG-CT-base | defaults (`-complement_tolerance_unit Da`, 0.02 Da), param_hash `c12a81b235148e799392b6f438290608dcd0552b3741aff975ccb830037ac092` |
| CFG-CT-cand | `-complement_tolerance_unit auto` (`-complement_probe` 500, fallback 0.02 Da: defaults), param_hash `331af15f96ebef8bf0733932e1321b43d6a2be4dbd01835ae4a4c49e95739407` |
| CFG-CT-base-it05 | CFG-CT-base + `-fragment_tolerance 0.5 -fragment_tolerance_unit Da` (ion_trap runs only), `483f4869496c8894ed7f012dfa485c83ae935150a2f5299a7562521d74895667` |
| CFG-CT-cand-it05 | CFG-CT-cand + the same, `85edd0b3d23b3215e6cb34facb71d171407406f8328c8343dac19684a440b475` |
| Truth engine | Sage v0.14.7, binary sha256 `d3820543a31bfa2a556e04f91719204ce0ac6f34dcca6670314a13df87064625` (the #2 truths, reused unchanged; below) |
| Scorer | `acceptance/1.12/scorers/score_item02.py` `5704b8634c5a98f8993a4dccc4c331e6d84405dbf0b5dbaa42b523d68677e395`, `acceptance/1.12/scorers/acclib.py` `fe387a3455a52678f78c20c3156b63c251e08daa5b92da2f3e205d1d9ab2b1c1`, `bench/fastag-bench/src/fastag_bench/score.py` `e2b8788a78f1176169f617c01b2e17f21578b8909f7c79b33d23ae1b71075f79`, `parsers.py` `01e27548bcae489d3f205960730c8bc36624e16935ea5df0bec5a6a04ea51f49` (all unchanged from acceptance/1.12) |

param_hash = sha256 of `<binary sha256>\t<options column of frozen-configs.tsv>`.

## Runs

`manifests/compltol-H1.tsv` (sha256 `b8cd4ca62d554fa94465a5bd6057a975bd96613c5ddecf5312c2f41917573991`): the 13 runs
of `acceptance/1.12/manifests/item02-H1-r2.tsv` without PXD074582 (astral) and PXD001473 (ion_trap). Their #2 truths
have 0 target rank-1 PSMs at spectrum_q <= 0.01 (rule 4b of #2 amendment 2: no truth). This was read from the truth
files alone, before any FASTag run of this item (the 1.12 audit's pre-scoring truth check). 11 runs:

- astral 2: PXD066944, PXD070049.
- ion_trap 5: PXD000806, PXD001540, PXD001739, PXD002429, PXD003397 (0.5 Da twins).
- qe 1: PXD069528.
- timstof 3: PXD033741, PXD050504, PXD076520.

Set of a run as #2: the stratum, except that a run whose `ms2_analyser` is ion_trap is in ion_trap. Unlike #2
amendment 2, the ion_trap set is scored: the item's purpose is a run-specific window, and low-resolution MS2 is
where the fixed 0.02 Da window is most wrong. This was decided now, before any run.

Disjoint from DEV (PXD003531, PXD001819; `disjointness/compltol-H1.tsv`: 11/11 PASS by PXD and sha256). **Prior
use, stated:** these files were the #2 held-out set. #2 scored CFG-02-base/cand on them (complement *rule*, not
the window), and #6, #14 and #15B used some of them. compltol was developed on DEV only: no output of this item has
been computed on them, and the measured windows on them are unknown. The #2 per-cell results, which the developer
has seen, compare `-complement_rule both` with `same_charge` at the fixed 0.02 Da window. They say nothing about a
measured window.

## FASTag runs (cells)

Per run and arm: 6 runs, the arm's options plus `-tag_length 3/4/5` (`L*_default`) or `-tag_length 3/4/5
-no_deisotope` (`L*_nodeiso`), `-threads 16`. Ion_trap runs use the `-it05` configs. Command:
`FASTag -in <staged fastag_input> -out tags.tsv -threads 16 <cell options> <arm options>`. Run directories:
`runs/<CFG or CFG-it05>/compltol-H1/<run_rel>/<cell>/` with `FASTAG_RC=<rc>` appended to `run.log`.
Tasks: `compltol/jobs/mktasks.py` (132 tasks). Job: `compltol/jobs/fastag.slurm` on BinAC2. The binary is started
through `compltol/jobs/FASTag`: data's loader and glibc, as the 1.12 RC wrapper (BINAC2-RUNTIME.md). Every input
is re-hashed on its node against the manifest. Before the FASTag array, `compltol/jobs/gate.slurm` runs gate.sh vs
refs-1.12.0 with this binary on BinAC2. The held-out array is submitted only after that gate passes. As in 1.12,
`out_spectra_mzml` may differ only in the recorded input path and the index offsets.

## Truth per run

The #2 truths, unchanged (`PREREG-item02.md`, truth configs `scorers/truth/item02.tsv` `42920f3b...`; Sage 0.14.7;
spectrum_q <= 0.01, target, rank 1). On BinAC2 (root `/pfs/10/project/bw26g016/fastag-1.12/acc112-item02`) they are
linked into `truth/compltol-H1/<run_rel>/results.sage.tsv`:

| Run | Source | results.sage.tsv sha256 |
|---|---|---|
| PXD000806 S2-2 | truth/item02-H1-r2 | `0c2f6701a249b5793ffae02537761123e135ee55e712dabce6756ab615529d3a` |
| PXD001540 09JAN2014_HF_brain_new_45 | truth/item02-H1-r2 | `34dd3096254286150c9a044746967b0d99b04bf6f79bc7581ae80c138f7c8c94` |
| PXD001739 PY100_PHNL_1_B | truth/item02-H1-r2 | `f6d53d8762d6fdd67016b502b0253dcf2e460860e53a14711d106d03d580b1aa` |
| PXD002429 NR1510 | truth/item02-H1-r2 | `677e1146b51838c5cea0e9623307079c79fd9b35082e64769a0d9510d9e5ee75` |
| PXD003397 R142F | truth/item02-H1-r2 | `6e5c5f55c0423ed919ce401a5d32ebd033f381a77b492d6430d1062130142aac` |
| PXD033741 (derived mzML, amendment 2) | truth-r4/item02-H1-r2 | `792b4afe98f4b9e0d85e79a3a651eef0579d1b606b4114172157945f2f1becb1` |
| PXD050504 | truth-r4/item02-H1-r2 | `006a85b839a2399714a0d30cc49519bba435d85243afe31a6b31da529fe2a606` |
| PXD066944 | truth-r4/item02-H1-r2 | `5fd761af442b772e4278262e9f7e198f3b4c178161b352585125a8376676014f` |
| PXD070049 | truth-r4/item02-H1-r2 | `3044acb070e168393f7a5b068e5be82dd49362a1981f29bddba0beb6b178a7bc` |
| PXD076520 (derived mzML, amendment 2) | truth-r4/item02-H1-r2 | `ab6c0a287b3ffa5ad27e3ebb08b5981c121d01dcf41ef5129ba324021154c205` |
| PXD069528 | truth-r4/item02-H1-r2 | `e7530fa22523d55c4343c7be540fce451200743120865e96f472e51f316b59a6` |

Target rank-1 PSMs at q <= 0.01 (counted from the truth files only): 913, 4432, 619, 9183, 13065, 72363, 6829,
14641, 351, 23516, 29843.

## Correctness, denominator, cells, pooling, acceptance

As #2 (PREREG-item02.md and amendments 1, 2), unchanged:
- Correct: the rank-1 tag passes the flank rule against its truth peptide. Denominator: every truth spectrum of
  the run, the same in both arms; an untagged truth spectrum is not correct. Charge stratum: the Sage charge
  2, 3, 4+ (1+ reported apart). Spectra keyed by `acclib.native_key`.
- Cells: set x profile x length x charge = 4 x 2 x 3 x 3 = 72. Statistic: rank-1 correct, cand - base, in
  percentage points. Peptide-cluster bootstrap, 2,000 draws.
- **(i)** Every cell non-inferior: at least 200 clusters, point > -0.5, Holm bound > -1.0 (one-sided alpha 0.025).
  A cell whose baseline rate is below 1.8% is uninformative. An underpowered or uninformative cell is inconclusive
  and blocks a PASS.
- **(ii)** Pooled gain, length 3, CLI default profile, sets astral + ion_trap, charges >= 2: point >= +0.3 and the
  2.5th bootstrap percentile > 0.
- **(iii)** timsTOF 4+, CLI default profile, each length: point >= -0.5, point - 1.96 SE > -1.0, >= 200 clusters.
- **(iv)** Time: PXD003531 (DEV), 1 thread, 3 interleaved repeats of each arm on one exclusive BinAC2 node
  (`compltol/jobs/timing.slurm`): median cand / median base <= 1.03.
- Rule 5: any run with FASTAG_RC != 0 or without truth (0 PSMs) makes the verdict INCONCLUSIVE.
- Verdict: PASS only if (i)-(iv) all PASS. Any FAIL is FAIL. Otherwise INCONCLUSIVE.

## Scoring command (once)

    python acceptance/1.12/scorers/score_item02.py acceptance/1.13 compltol-H1 <W>/runs <W>/truth <W>/out \
        --timing <W>/timing/timing.tsv --base CFG-CT-base --cand CFG-CT-cand

From a git archive of the commit that adds this file, with the 1.12 scorer venv on BinAC2
(`acc112-item02/scorevenv`, Python 3.12.15, numpy 2.4.6, pandas 3.1.0). No `--sets`: all four sets are scored.
The output (`result.json`, `cells_i.tsv`, `runs.tsv`) goes to `results/compltol/` with a registry row.

## DEV (development data only; before this file)

Binary as frozen. The #2 DEV runs, frozen #2 scorer, base vs cand, 6 cells (node data,
`data:/scratch/kohlbach/b113/compltol/dev2`):
- PXD003531 (QE, 20 ppm): measured windows 0.019-0.036 Da; powered cells -0.20 to +0.27 points; 4+ underpowered
  (169 clusters).
- PXD001819 (ion trap, 0.5 Da twins): measured windows 0.177-0.208 Da; powered cells +2.2 to +7.6 points; 4+
  uninformative.
- Indicative timing on the shared node data (not the (iv) measurement; build 2d9c292, before the review fixes), 1 thread, 3 interleaved repeats: base
  23.56/23.10/21.95 s, cand 23.16/23.67/21.96 s.
