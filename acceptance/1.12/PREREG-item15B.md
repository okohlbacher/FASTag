# PREREG-item15B: #15 phase B c/z ion series (CFG-15B-cand against CFG-15B-base)

Status 2026-11-08: **protocol fixed except the truth engine's version and its z check; not run, not scored.**
Status of CFG-15B-base and CFG-15B-cand: **`pending_dev`**, not `frozen`. Two things the plan requires before any
held-out run are not done, and neither can be done in this round:

1. **MSFragger is not installed** on data or BinAC2 (only the OpenMS MSFraggerAdapter is). Installing it means
   accepting its academic licence, which only the user can do. Its version and the sha256 of its jar are therefore
   still open (`TO FILL` below).
2. **The z definition check on the DEV set PXD060724** (registry E15B-03: "with the z definition (z+1, OpenMS Zp1)
   verified on the dev set") has not run; it needs MSFragger.

When both are done (a DEV step, recorded with its numbers), this file is amended with the version, the jar sha256,
the parameter files and the check's result, and that commit sets the configs `frozen`. Everything else below is
fixed now. Each config is scored once; an H1 failure is final for 1.12 unless a variant is confirmed on H2 only.
Source: PLAN-data-types.md #15 phase B (Validation, Acceptance for auto as default), registry E15B-01..03, HO-15B-sets.

## Frozen software and configs

| What | Value |
|---|---|
| RC | a117801; FASTag.bin `c4c2ad67fcd9106e474f552267f7cdfefe107f394b268bbc236308b773e4d7f3`; bundle SHA256SUMS `93a1ad6d1184b156febb15b9f564e36a0a974f989fe9e5e7d8cf4849927cc051` |
| CFG-15B-base | `RC defaults (-ion_series by)`, param_hash `3121296f353f76c9ccc630049cfd5f2b2d7309439a9c8e97445fda648aca39e3` |
| CFG-15B-cand | `-ion_series auto`, param_hash `5a5fe0c000a3c0db678e80ffee980a9fdad42b89036ac2f3a2799e3fb0e8fae5` |
| Truth engine | MSFragger, version **TO FILL** (jar sha256 **TO FILL**), standalone, output_format tsv |
| Scorer | `scorers/score_item15B.py` `0e8534dba9f513008d53f69d988157fa3fecdda8a8f0de59324427744777cc62`, `scorers/acclib.py` `d2342eb4c15e5801d9c13f2edcd1e56cec70349c941df0db2d061bb6630eeedf`, fastag_bench `score.py` `e2b8788a78f1176169f617c01b2e17f21578b8909f7c79b33d23ae1b71075f79` (REVERSED_OFFSET per ion series), `parsers.py` `01e27548bcae489d3f205960730c8bc36624e16935ea5df0bec5a6a04ea51f49` |
| Per-run truth settings | `scorers/truth/item15B.tsv` `da7d966057171fd37ba2f3d188b52d31db7da4004f5bca6b2b2595e3b95ef56e` |

The frozen option strings use the RC's 20 ppm fragment tolerance in both arms, also on the ion-trap MS2 of
PXD071331 and PXD014719; this protocol adds no tolerance.

## Runs

`manifests/item15B-sets.tsv` (sha256 `335a5212de1664c4050f309321ac072918cca934b5345bce06b079eea2c91919`, HO-15B-sets),
chosen with the split before any c/z run:

| Split | Set | PXD | Files | Activation (manifest; MS2 analyser from the file headers) |
|---|---|---|---|---|
| H1 | set6 | PXD071331 | 2 | EThcD only (ETD + supplemental beam-type CID), ion-trap MS2 |
| H1 | set7 | PXD024621 | 3 | HCD / ETD decision tree, both FTMS |
| H2 | set8 | PXD014719 | 3 | HCD / ETD decision tree, ion-trap MS2 |

Under `auto` the RC reads ETD/ECD spectra as c/z and every hybrid (EThcD/ETciD) spectrum as b/y with a warning
(registry E15B-01, the etd_auto gate case). **Consequence, stated before any run:** set6 is all hybrid, so the
candidate reads it exactly as the baseline; the electron-activated endpoint rests on the ETD spectra of set7 (about
45% of its MS2) alone.

## FASTag runs

One run per file and arm at the frozen options (cell `RC`): `FASTag -in <staged mzML> -out tags.tsv -threads <n>
<arm options>` in `runs/<CFG>/item15B-sets/<run dir>/RC/`, `FASTAG_RC=<rc>` appended to run.log.

## Truth search per run (MSFragger; version open, see Status)

Per run three searches on the staged mzML, restricted by MSFragger's `activation_types` (a search is run only when
the run has such spectra; `truth/item15B.tsv` column `searches`):

| Search | Spectra | fragment_ion_series | Output |
|---|---|---|---|
| by | HCD and CID | b,y | `msfragger_by.tsv` |
| cz | ETD (ECD) | c,z (z-dot: the definition the DEV check fixes) | `msfragger_cz.tsv` |
| hybrid | EThcD | b,y,c,z | `msfragger_hybrid.tsv` |

Common settings: database = the PRIDE project organism's panel proteome (PXD071331 Escherichia coli, PXD024621 Mus
musculus, PXD014719 Homo sapiens; paths and sha256 in `truth/item15B.tsv`) plus reversed decoys with prefix `rev_`;
strict trypsin, 2 missed cleavages, length 7-50; Carbamidomethyl C fixed; variable Oxidation M, protein N-term
Acetyl, plus Phospho S/T/Y (PXD024621, PXD014719) or AMPylation +329.0525 on H/K/S/T/Y (PXD071331), as each
project's PRIDE data-processing protocol states; at most 3 variable mods; precursor 20 ppm; fragment 20 ppm on FTMS
MS2, 0.5 Da on ITMS MS2; one hit per spectrum reported.
FDR: per search file, rank 1, target-decoy q-value on `expectscore` (q = min over thresholds of decoys / targets),
targets with q <= 0.01 (`score_item15B.fragger_psms`).

**DEV z check (to run before the freeze, PXD060724):** the cz search on PXD060724 (EThcD and ETD, chymotrypsin) must
show that MSFragger's z ions are z-dot (z+1): the median mass error of matched z ions under the z-dot definition
within 0.01 Da, and FASTag's c/z rank-1 tags (`-ion_series cz`) on its PSMs placed by the flank rule with
REVERSED_OFFSET cz. If not, the z setting is changed on DEV and the check repeated, before any held-out run.

## Denominator, cells and pooling

- Activation class per spectrum from the staged mzML's `<activation>` cvParams (the RC's phase-A classes): electron
  (ETD/ECD without supplemental collisional energy), hybrid (EThcD/ETciD), collisional (CID/HCD), unknown (not scored).
- Correct: paper flank rule on the rank-1 tag with the tag's ion series offsets (`ion_series` column; b/y otherwise).
  Denominator: every truth spectrum of the split's runs, both arms; untagged = not correct.
- E1 cell: electron spectra of the split, all charges pooled. E2 cells: hybrid and collisional x MSFragger charge 2, 3,
  4+ (an activation class without spectra has no cells), spectra pooled over the split's runs. Peptide-cluster
  bootstrap (2,000 draws) and Holm as PREREG-item02.md.

## Acceptance for `auto` as default (all must hold)

- (E1) Electron-activated spectra: cand - base >= +5.0 points and the 2.5th bootstrap percentile > 0.
- (E2) Non-inferior elsewhere (hybrid, collisional) with the #2 margins (>= 200 clusters, point > -0.5,
  Holm-adjusted bound > -1.0; underpowered cells block).
- (E3) Identical on collisional spectra: every baseline row of a collisional spectrum equals the candidate's row on
  the baseline's columns. The byte identity on collisional runs is the gate's (E15B-01: 7 collisional cases identical
  under auto); the PXD004732 robustness run is a DEV check outside this scorer.
- Any run with FASTAG_RC != 0 makes the verdict INCONCLUSIVE.

## Scoring command

    python3 -I scorers/score_item15B.py acceptance/1.12 H1 <staged root> <root>/runs <root>/truth <out>

## DEV test of the scorer (DEV outputs only)

No MSFragger output exists yet. `scorers/tests/run_dev_tests.sh` runs both arms on the collisional DEV runs PXD003531
and PXD001819 and writes the paper harness's Sage truths in MSFragger's tsv columns (`tests/sage_as_fragger.py`), which
tests the reader, the q-value, the activation classes and E2/E3 (expected: no electron spectra, so E1 FAIL with 0
clusters; collisional cells identical, E3 PASS). The c/z flank offsets are fastag-bench's own (tested there). Result:
`scorers/tests/dev_results/item15B.txt`. The MSFragger reader is checked again on the PXD060724 DEV search.
