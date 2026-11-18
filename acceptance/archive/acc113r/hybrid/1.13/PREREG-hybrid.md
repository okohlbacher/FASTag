# PREREG hybrid: `-ion_series_hybrid both` on held-out EThcD/ETciD runs

Status: **FROZEN**, 2026-11-10. This file, the manifest, the disjointness table, the frozen config, the scorers and
the scripts were committed and pushed (branch `acc113r/hybrid`) before the candidate binary read any file of
`manifests/hybrid-heldout.tsv`. Before the freeze these files were only downloaded, converted
(ThermoRawFileParser), classified by activation and searched with Sage (qualification, below). No FASTag binary
read them.

Files of this arm:

- `hybrid/scripts/`, `hybrid/scorers/`, `hybrid/truth-config/`, `hybrid/inputs/`, `hybrid/dev/`, `hybrid/SHA256SUMS`;
- `manifests/hybrid-heldout.tsv`, `disjointness/hybrid-heldout.tsv`;
- the `CFG-hybrid-*` rows of `frozen-configs.tsv`;
- the `HO-hybrid-*` and `DEV-hybrid` rows of `validation-registry.tsv`.

## What is evaluated

The experimental option `-ion_series_hybrid both` of `origin/integration/1.13` at
9365ff15429a78b96d3d2b9da2bc3386fcd8d991 (`doc/HYBRID-IONS.md`). Under `-ion_series auto` it tags every hybrid
spectrum (EThcD, ETciD) twice, as b/y and as c/z, and merges the tags by E-value under one cap. Without it a hybrid
spectrum is read as b/y only.

Binary: built on node `data` from that commit (`/scratch/kohlbach/b113/hybrid/cand`), copied to
`data:/scratch/kohlbach/b113/hybrid/frozen/FASTag`, sha256
`e22e7a2d32802e1d4b97e4dc3364ebaf2bf8dfc8835f1a8b213557bca2eb5255`. Both arms use this binary.

Frozen configs (param_hash = sha256 of the options string); every other option is at its default:

| config | arm | options |
|---|---|---|
| `CFG-hybrid-by` | `by` (baseline) | `-ion_series auto -threads 8` |
| `CFG-hybrid-both` | `both` (candidate) | `-ion_series auto -ion_series_hybrid both -threads 8` |

On a hybrid spectrum `-ion_series auto` gives the same reading as the program default `-ion_series by`. Every MS2
spectrum of the held-out runs is a hybrid spectrum, so the baseline arm equals the default.

## Data

Public PRIDE data only. The PRIDE search for EThcD and ETciD gave 315 projects. Excluded before any download:

- every PXD of `hybrid/inputs/excl_pxd.txt` (14,290 PXDs: `alknodb/prereg-exclude-pxd.txt`, the lists reserved by
  the arms shifts, census and species, and every PXD named anywhere on `origin/acceptance/1.13` and the
  `origin/acc113r/*` branches). PXD010595, foreseen as DEV, is in this list and was not used at all;
- projects that are not a bottom-up proteome sample with a database of one organism: antibody and single-protein
  samples, synthetic peptides, peptidome and HLA, glycopeptide, cross-link and top-down projects, PRM, TMT, ion-trap
  MS2, projects without raw files, projects whose record does not state organism and protease.

Eight projects remained, each with two files fixed in `hybrid/inputs/candidates.tsv` before staging. The files were
chosen from file names and PRIDE records only.

Qualification rule (fixed before staging; `hybrid/scripts/build_manifest.py`): a run qualifies with a verified
download, a Sage run that ends with return code 0, at least 1,000 hybrid Orbitrap MS2 spectra and at least 200
truth spectra (below). Every qualifying run enters the test. A project counts with at least one qualifying run.

Result (`hybrid/inputs/qualification.tsv`): 9 runs of 5 projects qualify.

| PXD | sample (from the PRIDE record) | truth search | qualifying runs | hybrid MS2 | truth spectra |
|---|---|---|---|---|---|
| PXD065289 | human Expi293 cells (file name; the record lists three organisms), trypsin, ETciD, fractions | trypsin, C+57 fixed | 2 | 41,365; 40,726 | 7,624; 6,675 |
| PXD007058 | human U2OS, TiO2 phosphopeptides, EThcD | trypsin, C+57 fixed, phospho STY | 2 | 22,812; 22,096 | 3,663; 3,512 |
| PXD066033 | human, ADP-ribosylated peptides, EThcD | Lys-C, ADP-ribose S | 2 | 12,647; 11,934 | 3,128; 3,077 |
| PXD070310 | human A549, ADP-ribosylated peptides, EThcD | Lys-C, C+57 fixed, ADP-ribose S | 2 | 3,741; 4,095 | 640; 512 |
| PXD027504 | human, ADP-ribosylated peptides, EThcD | trypsin, C+57 fixed, ADP-ribose S | 1 | 3,857 | 200 |

Not qualified:

- PXD053508 (2 files): the hybrid MS2 spectra are ion-trap spectra (0 hybrid Orbitrap MS2).
- PXD008083 (2 files), PXD022156 (2 files): the chosen files hold HCD spectra only (0 hybrid MS2). Sage stopped on
  them with a missing-precursor error, which does not matter for a file without hybrid spectra.
- PXD027504, file `..._F0`: 11,384 hybrid MS2, 0 truth spectra at 1 % FDR.

Limits of this set, known before the freeze:

- Five projects is close to what public data offers under the rule above; no backup project exists.
- PXD066033, PXD070310 and PXD027504 come from the same laboratory and are ADP-ribosylation samples. The record of
  PXD070310 does not state the protease; Lys-C was assumed from the laboratory's protocol, and the run qualified.
- PXD027504 has one run with exactly 200 truth spectra, the lower limit of the rule. Its project difference has a
  wide interval, and it has the same weight as every other project in the macro mean.
- The truth search allows ADP-ribose on serine only.

The held-out runs are disjoint from DEV and from every excluded project by PXD, and from the DEV files by sha256
(`disjointness/hybrid-heldout.tsv`).

## Truth

Sage 0.14.7 (`/ceph/ibmi/abi/oliver/opt/sage-0.14.7`) on the mzML as staged; `hybrid/scripts/truth.sh` writes the
configuration from `hybrid/truth-config/<name>.json`:

- enzyme, fixed and variable modifications (max 2) per project as in the table; M+15.994915 variable everywhere;
  2 missed cleavages, length 7-50;
- fragment ions b, y, c and z; precursor 10 ppm, fragment 20 ppm, precursor charge 2-6, isotope errors -1..3;
- FASTA `/scratch/kohlbach/b113/hybrid/fasta/UP000005640_9606.fasta` (sha256 `1f028a9a...70df4bc`), Sage's `rev_`
  decoys.

A truth spectrum (`hybrid/scorers/hybtruth.py`) is a hybrid Orbitrap MS2 spectrum with a target, rank 1 PSM that
passes 1 % FDR twice: target-decoy q <= 0.01 within the hybrid Orbitrap subset (on `sage_discriminant_score`) and
Sage's `spectrum_q` <= 0.01. Its peptide cluster is the unmodified sequence with I and L folded.

The truth search ran before the freeze as the qualification. The Sage result files and scan tables are frozen by
sha256 (manifest columns `sage_sha256`, `scans_sha256`), and the run script refuses other files. Only the numbers
of spectra were read from them.

## Correctness of a tag

The rule of the existing tag-accuracy arms: `fastag_bench.score._mark(tags, psms, "flank")` of
`bench/fastag-bench`, which checks the tag sequence and its flanking masses against the truth peptide with the ion
offset of the row's `ion_series`. A truth spectrum an arm leaves without a tag has no correct tag.

## Criteria

Unit: the project, all its valid runs pooled. A run is valid when both arms end with return code 0.

| | Criterion | Threshold | DEV (PXD060724, in-sample) |
|---|---|---|---|
| P (primary) | share of truth spectra with at least one correct tag, `both` minus `by`, in percentage points; macro mean over the projects; 95 % interval from 2,000 bootstrap draws of the peptide clusters within each project (seed 113) | lower bound > +1.0 pp, and no project below -1.0 pp | +4.57 pp [+1.66, +7.46]; 92.2 % to 96.8 % |
| G1 (guard) | precision = correct tag rows / tag rows on the truth spectra, `both` minus `by`, macro mean over the projects | >= -1.0 pp | +4.57 pp (10.7 % to 15.3 %) |
| G2 (guard) | CPU seconds (user + system, `/usr/bin/time -v`) of `both`, summed over the valid runs, divided by the same sum of `by` | <= 2.0 | 1.49 (1.24 to 1.61 per run) |

CPU time and not wall time is the guard measure because four other arms share the node; wall time and peak memory
are reported.

Reported without a criterion, per project: correct tags per truth spectrum, rank-1 tag correct, spectra gained and
lost, and the split of the `both` rows by `ion_series` (b/y rows and c/z rows: number, correct).

Verdict rule:

- **PASS**: P, G1 and G2 are met.
- **FAIL**: at least one of P, G1, G2 is not met. The result names each one.
- **INCONCLUSIVE**: fewer than 4 projects have a valid run. Then no criterion is judged.

Technical failures (rule fixed here, before the run):

- An arm that ends with a non-zero return code makes its run invalid; the run is left out of both arms. No backup
  run or project exists.
- An infrastructure failure (node or file system failure, a job killed from outside) is rerun once by moving the
  arm directory aside by hand; the move is logged in the result.
- A sha256 mismatch of an input stops the run script before any scoring.
- No setting is changed after the freeze, and the scorer runs once (the run script refuses a second scoring).

## DEV

PXD060724 (rabbit, EThcD, six runs; in the exclusion list, DEV only), frozen binary, same scripts
(`hybrid/dev/`). The sample is of low complexity: only two runs have truth spectra at 1 % FDR (264 and 108).

| run | truth | `by` spectra with a correct tag | `both` | `by` correct rows / rows | `both` | CPU factor |
|---|---|---|---|---|---|---|
| Trypsin_1 | 264 | 241 (91.3 %) | 258 (97.7 %) | 1,135 / 12,451 | 2,008 / 12,923 | 1.48 |
| Trypsin_3 | 108 | 102 (94.4 %) | 102 (94.4 %) | 731 / 4,980 | 735 / 5,038 | 1.61 |
| four runs without truth | 0 | | | | | 1.24 to 1.57 |

A Sage search with b, y and c ions gave 309 truth spectra on Trypsin_1, with b, y, c and z 264, with b and y 258.
The truth search keeps b, y, c and z as scripted.

The thresholds were set from these numbers: the margin of P at about a quarter of the pooled DEV gain, the guard
G1 at one point below no change (DEV shows a gain), the guard G2 above the largest DEV factor.

## Commands

On node `data`, acceptance tree copied to `/scratch/kohlbach/b113/hybrid/acc`:

    # before the freeze (no FASTag): staging and qualification, one job per project
    bash hybrid/scripts/stage.sh hybrid/inputs/candidates.tsv <PXD>
    python -I hybrid/scripts/build_manifest.py hybrid/inputs/candidates.tsv /scratch/kohlbach/b113/hybrid/heldout \
        hybrid/inputs/qualification.tsv manifests/hybrid-heldout.tsv
    # after the freeze, once
    bash hybrid/scripts/run_heldout.sh /scratch/kohlbach/b113/hybrid/acc/acceptance/1.13

`run_heldout.sh` checks the binary, `hybrid/SHA256SUMS` and every input, runs `hybrid/scripts/fastag_arms.sh`
(`by`, then `both`) run after run, then `hybrid/scorers/score_hybrid.py` and `hybrid/scorers/verdict_hybrid.py`.
Self-tests: `hybrid_scans.py --selftest`, `verdict_hybrid.py --selftest` (synthetic PASS, FAIL per criterion and
INCONCLUSIVE cases).
