# PREREG-msfcalib: `calibrate_mass 2` in the MSFragger export, held-out test (post-1.15)

Status: **DRAFT 2026-11-13, not frozen.** Nothing of this test has been drawn or downloaded. Before the freeze the
user confirms the open points at the end; the freeze then follows the pattern of the earlier MSFragger tests: one
commit with protocol, draw script, drawn manifest, scorer, verdict script and thresholds, pushed before any file of
the drawn projects is downloaded; a second commit adds the staged manifest (sha256 of raw and mzML) and nothing else,
pushed before the candidate binary or MSFragger reads any held-out file. The split `msfragger-calib` is run once and
scored once. Nothing is tuned on it, no run is repeated with changed settings, nothing is re-scored, no criterion is
changed. Deviations are recorded, not repaired. FAIL and INCONCLUSIVE are valid results. The code is not changed.

Pattern: `acceptance/1.13/PREREG-msfragger2.md` on branch `post1131/msfragger-heldout2` (second test, PASS) and
`acceptance/1.14/PREREG-exactonly.md` on `acc114/exactonly` (third test). Criteria C1, C2, G1, G2 and their thresholds
are those of these tests, applied to the candidate arm; the paired criteria P1 to P3 are new and come from the
development decision rule (`output/backlog-1.15/msfragger-calib/PLAN.md`).

## Question

Under the msfragger shortlist defaults (`-search_engine msfragger -search_config_out`, tryptic shortlist), does the
export with `calibrate_mass 2` (arm 2, candidate) still meet the criteria of the earlier MSFragger held-out tests, and
does it keep more of a full MSFragger search's identified spectra than the same export with `calibrate_mass 0`
(arm 0, the export of FASTag 1.15), without raising the entrapment FDP over the limits and without losing the speed-up?

## Development result (no criterion; these runs chose the change)

27 development runs (all spent), node data, 12 threads (`output/backlog-1.15/msfragger-calib/RESULT.md`, `pair.tsv`):
lowest kept share 0.530 -> 0.800 (EX04), median 0.934 -> 0.946, higher in 25 of 27 runs, lower in one (MG04
0.976 -> 0.956); entrapment FDP 1.07 % -> 1.10 % pooled, one run above 2.0 % with both arms (2.12 % / 2.04 %);
speed-up lowest 2.02 -> 1.03, median 2.59 -> 1.49; MSFragger exit 0 in every run. The speed-up is the weak point:
three development runs kept only 1.03 to 1.10 under arm 2. The development runs include the two runs on which the
third held-out test of the msfragger defaults failed (EX04 = PXD003252, kept share 0.530; EX03 = PXD045654, FDP 2.12 %);
the change was chosen with them in view, so this test is what decides whether the defaults plus calibration hold.

## Frozen software and inputs (to be filled at the freeze)

| What | Value |
|---|---|
| Candidate | branch `post115/msfragger-calib` at the pushed head that carries this file (on origin/main a3079ee: 404d0d52 code, 64e9203d tests, b90844c7 log wording; later commits docs, help text, GUI manifest and tests only); built on node data from `git archive`, sha256 of the binary recorded, run through a wrapper as in the second test (OPENMS_DATA_PATH, FASTAG_DIGEST_DIR, LD_LIBRARY_PATH, OPENBLAS_NUM_THREADS=1) |
| Arm 0 export | the candidate's exported `fragger.params` with the one line `calibrate_mass = 2` replaced by `calibrate_mass = 0` (and nothing else; the header comment is a comment). Check before the freeze on the development run D1 (PXD003531): this file equals main's (a3079ee) export except the header comment, and `red.fasta` is byte-identical (verified in the development measurement) |
| MSFragger | 4.4.1, `/ceph/ibmi/abi/oliver/spextract/tools/MSFragger-4.4.1.jar`, sha256 `56b15a35060e1aa3b38508eed5e1b21ce697918bad75b450307160c86c652112`; OpenJDK 21, `-Xmx64g` |
| Database | UP000005640 reviewed, the file of the second and third tests (20,414 entries), sha256 recorded at the freeze |
| Arm b parameters | `closed_b.params` of the second test (MSFragger's closed defaults, `num_threads = 32`), `database_name` set per run |
| Conversion | ThermoRawFileParser 2.0.0 `-f 2`, `stage_msfragger.sh` |
| Scorer | `score_msfragger.py` of the second test, unchanged functions; the paired table by `score_pair.py` of the development measurement (`/scratch/kohlbach/b115/msfcalib/`), copied with SHA256SUMS |
| Threads | 32 for FASTag and every MSFragger search (as the second test); runs and arms strictly one after another |

## Runs (draw to be made at the freeze; nothing drawn yet)

10 runs from 10 new PRIDE projects, one run per project, fresh draw:

- Pool: the `qe` projects with result `OK_not_needed` in `h2r_pride_candidates.tsv` (Q Exactive only, DDA, trypsin,
  label-free, no enrichment, lysate, one organism), as in the second test. Seed `fastag-post-1.15:msfcalib:qe`.
- Excluded: every PXD named in any file of any `origin/*` branch (after `git fetch` on the freeze day) or under
  `output/backlog-1.13`, `output/backlog-1.14`, `output/backlog-1.15`; this covers PXD003531, PXD014764 and the
  projects of the three earlier MSFragger tests (MF, MG, EX), which are spent. Not counted as use, as before: the pool
  file, exclusion lists, `not_needed` rows of draw tables. The folder `output/backlog-1.15/msfragger-calib` holds no
  project of this test.
- Organism Homo sapiens only. File rule: `.raw`, 0.2 to 4 GB, name without blank/QC/wash/standard/DIA/PRM/HeLa/test/
  library; shuffled with seed `<seed>:<PXD>`; first = chosen, second = backup. The first 10 projects with an eligible
  file in the shuffled order are taken.
- Disjointness sweep on node data (`/scratch/kohlbach`, `/ceph/ibmi/abi/oliver`, five levels) before the freeze.
- Staging check: every MS2 FTMS HCD, at least 5,000 MS2 with a charge.
- Replacement rules as in the second test: the backup file of the same project if the chosen one fails; else the
  project is dropped (no redraw, no third file).

## Exact commands per run

1. FASTag (candidate; msfragger defaults applied by FASTag, no recipe options given):
   `FASTag -in <mzML> -out tags.tsv -recon_fasta human.fasta -tag_length 4 -extension 6 -fixed_modifications "Carbamidomethyl (C)" -variable_modifications "Oxidation (M)" -shortlist_out sl.tsv -fasta_out red.fasta -shortlist_min_spectra 1 -shortlist_parsimony none -shortlist_top 0 -search_config_out fragger.params -search_engine msfragger -threads 32`
   (the command of the third test; the log must contain `MSFragger export (development runs only, no held-out test): calibrate_mass 2`).
2. Arm **a2**: MSFragger on the unedited export; arm **a0**: MSFragger on the same `red.fasta` with the arm 0 file.
   Order per run a0 a2 a2 a0 (interleaved and mirrored); identifications from the first a0 and first a2 (their
   outputs are identical by construction of the repetition check below), wall clock = median of the two repetitions.
   sha256 of `fragger.params` and `red.fasta` before and after.
3. Arms **aE0**, **aE2**: each arm's parameters with `database_name` alone replaced: targets of `red.fasta` + one
   shuffled entrapment copy of each (`ENTRAP_`) + reversed decoys of both (`mkdb.py --entrap`).
4. Arm **b** (reference): `closed_b.params`, `human.fasta` + reversed decoys.
5. Informational, no criterion: the calibration's MS2 offset and the optimized fragment tolerance from arm a2's log.

## Scoring (unchanged rules of the earlier tests)

From MSFragger's `.pin`, one PSM per scan (rank 1), sorted by hyperscore descending (ties: decoys first); q =
decoys / non-decoys above the position, monotone; identified = non-decoy PSM with q <= 0.01; peptides without flanks,
modifications and charge, I = L. No rescoring.

- kept share (per run and arm) = scans identified in b that the arm identifies with the same peptide / scans identified in b.
- speed-up (per run and arm) = wall(b) / (wall(FASTag) + wall(arm)).
- entrapment FDP of aE = 2 E / (T + E) over its identified PSMs.

## Criteria

A run is **evaluable** when arm b returned 0 and identified at least 1,000 spectra. At least 6 evaluable runs, else
the affected criteria are INCONCLUSIVE.

Absolute criteria on arm 2 (unchanged thresholds of the earlier MSFragger tests):

| | Criterion | Threshold |
|---|---|---|
| C1 (primary) | every staged run: FASTag returns 0 and writes both files; MSFragger returns 0 on the unedited export (a2) and on the arm 0 file (a0); the files are unchanged afterwards; a2 identifies at least one target PSM | all runs |
| C2 (primary) | kept share of a2 in every evaluable run (a missing or failed a2 counts as 0) | >= 0.80 |
| G1 (guard) | median speed-up of a2 over the evaluable runs | > 1.0 |
| G2 (guard) | entrapment FDP of aE2, pooled over the evaluable runs and in each evaluable run | pooled <= 0.015; each <= 0.020 |

Paired criteria, arm 2 against arm 0 (from the development decision rule):

| | Criterion | Threshold |
|---|---|---|
| P1 (primary) | kept share of a2 minus a0, median over the evaluable runs | > 0 |
| P2 (guard) | G2 not worse: no evaluable run with FDP <= 2.0 % under aE0 exceeds 2.0 % under aE2 | none |
| P3 (guard) | G1 not worse: speed-up of a2 in every evaluable run | > 1.0 |

**Verdict:** C1 PASS or FAIL over all staged runs; with fewer than 6 evaluable runs C2, G1, G2, P1 to P3 are
INCONCLUSIVE; otherwise each is PASS or FAIL at its threshold (a value that cannot be computed fails). Overall FAIL if
any criterion fails, else INCONCLUSIVE if any is inconclusive, else PASS. **PASS: `calibrate_mass 2` stays the
default and is documented as held-out tested. FAIL or INCONCLUSIVE: the export goes back to `calibrate_mass 0`.**
Arm 0's own C2/G2 values are reported (they are a fourth look at the 1.15 export), with no verdict.

Technical failures, interruptions and the timing caveat: as in the second test (a non-zero return code is a result,
not rerun; only an outside interruption allows one restart of that run, listed as a deviation).

## Expectation (development runs; no criterion)

On the 27 development runs arm 2 meets C2 in every evaluable run (lowest 0.800, EX04, at the threshold), G2 except the
one run above 2.0 % already under arm 0, P1 (median +0.012), and P3 only narrowly (three runs at 1.03 to 1.10 at 12
threads). At 32 threads both sides of the speed-up change; P3 is the criterion most likely to fail.

## Open points before the freeze (for the user)

1. P3 (every run > 1.0) versus the earlier tests' G1 (median only): P3 is the development rule; keep it as a guard?
2. P1 as the median paired difference > 0, or the development form "strictly higher on the lowest runs"? The lowest
   runs of a fresh draw are not known in advance, so the draft uses the median.
3. Pool size: the `qe` pool had 135 projects; after the MF, MG, EX and other draws fewer remain. If fewer than 10
   eligible projects are left, take what is left (minimum 6 evaluable) or widen the pool (another instrument class)?
4. Threads 32 (earlier tests) or 12 (development measurement)?
