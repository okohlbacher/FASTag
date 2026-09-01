# F4 q_db calibration validation — FASTag entrapment calibration audit

Date: 2026-09-01. Binary: frozen `$W/FASTag` (FASTag 3.6.0-pre, Revision bd4b895,
built Jul 23 2026; `$W` = this directory). Every number below comes from a run
executed for this report; raw TSVs, logs, and scripts are all in `$W`.

## Executive summary (10 lines)

1. **q_db is calibrated only at the tight end of the curve and only approximately elsewhere: arm A PASSes at x ≤ 0.02 (zero B-only events) but FAILs decisively at x = 0.05 (measured FDP 0.083, 95% CI [0.056, 0.118]) and x = 0.1 (0.161 [0.142, 0.181]) — a ~1.6× underestimate.**
2. Arm B (roles swapped: pseudo-target = archaeon, entrapment = E. coli + 3 archaea) is nearly calibrated: PASS at 0.005/0.01/0.05/0.1 (x=0.1: FDP 0.100 [0.082, 0.122]), one FAIL at x=0.02 (FDP 0.090 [0.024, 0.229], on 4 events).
3. Co-primary arm C (composition-matched shuffled-human entrapment) is the WORST: FAIL across the curve, FDP 0.123 [0.102, 0.146] at x=0.05 and 0.251 [0.234, 0.270] at x=0.1 — ~2.5× underestimate.
4. Entrapment-choice sensitivity is therefore material: at identical audit reference (arms A vs C differ only in the calibration DB), measured FDP at nominal 0.1 moves from 0.161 to 0.251 (CIs disjoint).
5. The per-protein residue shuffle preserves composition but destroys real 7-mer structure (repeats/low-complexity motifs that misread tags disproportionately hit), and that costs more calibration accuracy than the archaea's composition mismatch — the composition-bias hypothesis is bounded the "wrong" way: real foreign proteomes beat a composition-matched structureless null.
6. Aggregate cross-check: over ALL fwd/rev rows, the B-only audit extrapolates 58.7% false (arm A/C reference) vs the binary's own calibration estimate of 44.2% (arm A) / 29.3% (arm C); arm B's audit (43.2%) vs calibration (44.4%) agree closely.
7. Cost of `-entrapment_fasta` (arm D): +0.6 s wall on 12.1 s (~+5%, reproduced twice), peak RSS reproducibly ~75–83 MB LOWER with entrapment (786/793 MB vs 868/868 MB); target fwd/rev output rows are byte-identical with and without it, and repeat runs are fully deterministic.
8. **Ground-truth gap (arm E, PXD000001): q_db does NOT measure correct-read probability — in the 0.05 < q_db ≤ 0.2 bin, only 52.9% [51.2, 54.5] of tags are correct reads of the 1%-FDR-identified peptide (47.1% wrong) even though q_db bounds DB-match spuriousness at ≤ 0.2; the 0.01–0.05 bin still has 6.4% wrong reads.**
9. Verdicts: arm A FAIL (whole curve), arm B PASS-with-one-marginal-FAIL, arm C FAIL — q_db under-reports the false-match rate at moderate thresholds, by an amount that depends strongly on how sequence-realistic the entrapment DB is.
10. Practical reading: trust q_db ≤ ~0.02 acceptance sets; treat larger q_db values as optimistic by up to ~1.6× (real foreign-proteome entrapment) and never read q_db as P(tag correctly reads the spectrum's peptide).

## Protocol and provenance

- Frozen binary: `$W/FASTag` (never `build-rel`); `OPENMS_DATA_PATH=/Users/kohlbach/Claude/OpenMS-mzpeak-build/share/OpenMS` on every run. No OMP Error #15 occurred; no `DYLD_LIBRARY_PATH` needed for the binary (the arm-E Python driver sets it for its own subprocess machinery inherited from the truth script).
- Common flags, all runs: `-tag_length 7 -min_filter_length 7 -fragment_tolerance 20 -fragment_tolerance_unit ppm -isobaric_tolerance 0 -threads 8`.
- With tag_length 7, no extension, no gaps, and **collapse disabled, every reported tag is exactly 7 residues, so the offline 7-mer set-membership checks used below are exact substring semantics** (a length-7 tag is a substring of a protein iff it is one of its 7-mer keys).
- Sample: `/Users/kohlbach/Claude/bench_astral_lf.mzML` (human label-free Astral DDA; 100,245 MS2 spectra tagged of 102,236 input spectra), full file, arms A–D.
- Databases (`P` = `/Users/kohlbach/Claude/FasTag-speciesdb/proteomes`): `$W/target_hs_mtb.fasta` = P/9606 + P/83332 (22,775 proteins); `$W/target_hs_arch243232.fasta` = P/9606 + P/243232 (22,217); `$W/archaea4.fasta` = P/243232+273057+186497+64091 (9,195; verified byte-identical to that concatenation by SHA-1); `$W/entrap_ecoli_3arch.fasta` = P/83333+273057+186497+64091 (11,940); `$W/shuf9606.fasta` = per-protein residue shuffle of P/9606, `random.seed(20260901)` (`$W/make_shuf9606.py`, 20,431 proteins).
- `min_filter_length 7` is below the binary's derived floor of 8 (its warning: ~15.2% of random 7-mer tags hit this target DB by chance); enrichment of matched tags over chance is only 1.4× — this is a deliberately hard, high-false-rate regime for the calibrator.

### Offline analysis machinery, validated against the binary

`$W/analyze_audit.py` builds 7-mer key sets: I→L and J→L folded, forward
orientation, restricted to the 19-letter post-fold standard alphabet
(keys containing B/O/U/X/Z are dropped). `$W/keytest.py` shows this reproduces
the binary's own logged counts EXACTLY: target 10,408,254 keys; archaea4
2,344,130 keys; 389,796 shared with target (orientation-closed); r = 0.187768.
`$W/sanity_membership.py` then re-derives every row's membership offline:
across all three audit TSVs (265,662 rows) there are **0 disagreements** with
the binary's `fasta_hit` column (fwd/rev ⇒ in target closed; efwd/erev ⇒ in
entrapment and not target).

### Estimator and PASS rule

For target = A + B (B = pseudo-entrapment inside the target) a fwd/rev row is
**B-only** iff its tag (bracketed annotations stripped, I/J→L folded) matches
B's keys forward or reversed and matches A's keys in neither orientation.

    r_B = |keys7(B) exclusive of A, orientation-closed| / |keys7(A+B)|
    estimated_FDP(x) = ( B(x) / r_B ) / D(x)
      B(x) = B-only fwd/rev rows with q_db <= x
      D(x) = all fwd/rev rows with q_db <= x

95% CI: exact Clopper–Pearson on the proportion p = B(x)/D(x)
(lower = BetaInv(0.025; B, D−B+1), upper = BetaInv(0.975; B+1, D−B)), scaled by
1/r_B to the FDP scale (`clopper_pearson()` in `$W/analyze_audit.py`, pure
stdlib incomplete-beta). **PASS at x iff the FDP CI reaches x or below
(CI_lo ≤ x); the point verdict (FDP ≤ x) is shown alongside.** Entrapment rows
(efwd/erev, empty q_db) are excluded from both counts.

## Arm A — primary audit (target = human 9606 + M. tuberculosis 83332; calibration entrapment = archaea4)

Command (see `$W/run_all.sh` for all five, verbatim):

    /usr/bin/time -l $W/FASTag -in /Users/kohlbach/Claude/bench_astral_lf.mzML -out $W/audit1.tsv \
      -fasta $W/target_hs_mtb.fasta -entrapment_fasta $W/archaea4.fasta \
      -tag_length 7 -min_filter_length 7 -fragment_tolerance 20 -fragment_tolerance_unit ppm \
      -isobaric_tolerance 0 -threads 8

Run log: 100,245 MS2 spectra, 518,605 tags → 117,651 rows = 108,631 fwd/rev +
9,020 efwd/erev; binary r = 0.187768; q_db resolution floor ~4.90e-05.
Audit reference: keys(9606) = 9,708,739; keys(83332) = 767,626;
keys(target) = 10,408,254; B-exclusive-of-A (closed) = 652,541 →
**r_B = 652,541 / 10,408,254 = 0.062695**. B-only rows total: 3,999.

| x | D(x) | B(x) | est. FDP = (B/r_B)/D | 95% CI (FDP) | point | CI verdict |
|---|---|---|---|---|---|---|
| 0.005 | 10 | 0 | 0.0000 | [0.0000, 4.9206] | PASS | PASS |
| 0.01 | 10 | 0 | 0.0000 | [0.0000, 4.9206] | PASS | PASS |
| 0.02 | 10 | 0 | 0.0000 | [0.0000, 4.9206] | PASS | PASS |
| 0.05 | 5,777 | 30 | 0.08283 | [0.05593, 0.11811] | FAIL | **FAIL** |
| 0.1 | 26,868 | 271 | 0.16088 | [0.14238, 0.18110] | FAIL | **FAIL** |

CI arithmetic at x=0.05: p̂ = 30/5777 = 0.005193, Clopper–Pearson 95%
[0.003506, 0.007405]; ÷ r_B = 0.062695 → [0.05593, 0.11811]; lower bound
0.05593 > 0.05 ⇒ calibration rejected at 95%. At x=0.1: p̂ = 271/26868 =
0.010086 [0.008927, 0.011354] ÷ r_B → [0.14238, 0.18110]; 0.14238 > 0.1 ⇒
rejected. (Only 10 rows sit at q_db ≤ 0.02 — the tight-threshold PASSes are
consistent-with-calibration, not powerful confirmations: with D=10 and B=0 the
CI upper bound is 0.30845/r_B = 4.92.)

**Arm A verdict: FAIL across the whole curve** (calibrated region limited to
x ≤ 0.02; q_db underestimates the false-match rate ~1.6× at x = 0.05–0.1).

## Arm B — entrapment-choice sensitivity (target = 9606 + archaeon 243232; calibration entrapment = E. coli 83333 + archaea 273057/186497/64091)

Run log: same spectra; 118,911 rows = 106,434 fwd/rev + 12,477 efwd/erev;
binary r = 0.263948; floor ~3.56e-05. Audit reference: keys(243232) = 480,740;
keys(target) = 10,138,819; B-exclusive (closed) = 397,843 →
**r_B = 0.039240**. B-only rows total: 1,802.

| x | D(x) | B(x) | est. FDP | 95% CI (FDP) | point | CI verdict |
|---|---|---|---|---|---|---|
| 0.005 | 10 | 0 | 0.0000 | [0.0000, 7.8619] | PASS | PASS |
| 0.01 | 10 | 0 | 0.0000 | [0.0000, 7.8619] | PASS | PASS |
| 0.02 | 1,137 | 4 | 0.08966 | [0.02445, 0.22892] | FAIL | **FAIL** |
| 0.05 | 7,246 | 12 | 0.04220 | [0.02181, 0.07368] | PASS | PASS |
| 0.1 | 25,945 | 102 | 0.10019 | [0.08172, 0.12157] | FAIL (by 0.0002) | PASS |

CI arithmetic at x=0.02: p̂ = 4/1137 = 0.003518 [0.000959, 0.008983] ÷ r_B =
0.039240 → [0.02445, 0.22892]; 0.02445 > 0.02 ⇒ FAIL, though on 4 events the
interval is wide and the failure is marginal. At x=0.1 the point estimate
(0.10019) exceeds x by 0.0002 with CI straddling x ⇒ PASS within CI.

**Arm B verdict: consistent with calibration at 4 of 5 thresholds (one
marginal, low-count FAIL at x=0.02).** Compared with arm A: arm A is rejected
at x=0.05 and 0.1 where arm B passes, and at x=0.1 the two arms' measured FDP
CIs ([0.142, 0.181] vs [0.082, 0.122]) are disjoint ⇒ **the calibration is NOT
robust to entrapment choice**; it is close to nominal when the calibration DB
is phylogenetically similar to the audited pseudo-target (archaea calibrating
an archaeon) and ~1.6× optimistic when it is not (archaea calibrating
M. tuberculosis-exclusive false matches).

## Arm C — co-primary composition-matched null (target = 9606 + 83332; calibration entrapment = shuf9606)

Run log: same spectra; 138,110 rows = 108,631 fwd/rev + 29,479 efwd/erev;
binary r = 0.925437 (10,874,817 entrapment keys, 1,242,636 shared-closed);
floor ~9.95e-06. The fwd/rev rows and the audit reference (B = 83332,
r_B = 0.062695, 3,999 B-only rows) are IDENTICAL to arm A — only the q_db
column differs. This isolates the calibration DB as the sole variable.

| x | D(x) | B(x) | est. FDP | 95% CI (FDP) | point | CI verdict |
|---|---|---|---|---|---|---|
| 0.005 | 38 | 1 | 0.41975 | [0.01062, 2.20273] | FAIL | FAIL |
| 0.01 | 38 | 1 | 0.41975 | [0.01062, 2.20273] | FAIL | FAIL (marginal: CI_lo 0.0106) |
| 0.02 | 631 | 3 | 0.07583 | [0.01566, 0.22061] | FAIL | PASS |
| 0.05 | 16,654 | 128 | 0.12259 | [0.10234, 0.14566] | FAIL | **FAIL** |
| 0.1 | 49,428 | 779 | 0.25138 | [0.23416, 0.26952] | FAIL | **FAIL** |

**Arm C verdict: FAIL across the curve.** Side by side with arm A (same rows,
same audit reference):

| x | arm A: D(x) | arm A FDP [CI] | arm C: D(x) | arm C FDP [CI] |
|---|---|---|---|---|
| 0.005 | 10 | 0.000 [0.000, 4.921] | 38 | 0.420 [0.011, 2.203] |
| 0.01 | 10 | 0.000 [0.000, 4.921] | 38 | 0.420 [0.011, 2.203] |
| 0.02 | 10 | 0.000 [0.000, 4.921] | 631 | 0.076 [0.016, 0.221] |
| 0.05 | 5,777 | 0.083 [0.056, 0.118] | 16,654 | 0.123 [0.102, 0.146] |
| 0.1 | 26,868 | 0.161 [0.142, 0.181] | 49,428 | 0.251 [0.234, 0.270] |

The shuffled-human entrapment accepts ~2–3× more rows at every nominal x and
its measured FDP is higher everywhere (CIs disjoint at 0.05 and 0.1). So the
divergence that bounds q_db's composition sensitivity runs OPPOSITE to the
naive expectation: a composition-matched but structureless null
under-detects false matches (aggregate calibration estimate 29.3% false vs the
audit's 58.7%), while phylogenetically distant real proteomes get closer
(44.2%). Interpretation (hypothesis, not measured here): misread tags
preferentially hit realistic sequence structure — repeats and low-complexity
motifs shared by all real proteomes — which a per-protein shuffle destroys;
that structure matters more than residue composition. Both effects leave q_db
optimistic; the sequence-realism effect (A vs C: 0.161 vs 0.251 at x=0.1) is
about as large as the phylogeny effect (A fail vs B pass).

## Arm D — scale and performance (full 1.87 GB file, 102,236 spectra, 8 threads)

From `/usr/bin/time -l` (run 1 + an independent repeat; outputs byte-identical
across repeats — the tool is deterministic):

| run | wall (s) | user (s) | peak RSS (MB) |
|---|---|---|---|
| A with entrapment (audit1) | 12.66 | 47.34 | 785.8 |
| A with entrapment, repeat | 12.50 | 46.74 | 793.1 |
| no entrapment (noentrap) | 12.09 | 47.17 | 868.4 |
| no entrapment, repeat | 11.92 | 46.28 | 868.1 |

- Entrapment cost: **+0.57/+0.58 s wall (~+5%)**; peak RSS is reproducibly
  **~75–83 MB LOWER with entrapment** (786/793 vs 868/868 MB) — not noise
  (consistent across repeats and with the tool's internal peak report,
  749 vs 828 MB); presumably a heap-layout effect of allocating the 2.3M-key
  entrapment index before spectrum processing. Reported as measured.
- Per-length effective ratios (this configuration has a single tag length, 7):
  arm A r = 0.187768 (2,344,130 keys, 389,796 shared-closed); arm B
  r = 0.263948; arm C r = 0.925437; arm E r = 1.6491.
- Entrapment event counts: arm A 9,020 (over 108,631 target matches;
  resolution floor 4.90e-05), arm B 12,477, arm C 29,479, arm E 2,213.
- The fwd/rev (spectrum, tag, evalue, hit) set is IDENTICAL with and without
  `-entrapment_fasta` (108,631 rows compared) — the flag only appends q_db and
  the 9,020 efwd/erev rows.

## Arm E — ground-truth gap on PXD000001 (what q_db is NOT)

Command:

    /usr/bin/time -l $W/FASTag -in .../TMT_Erwinia_1uLSike_Top10HCD_isol2_45stepped_60min_01-20141210.mzML \
      -out $W/pxd1.tsv -fasta P/218491.fasta -entrapment_fasta $W/archaea4.fasta \
      -fixed_modifications 'TMT6plex (N-term)' 'TMT6plex (K)' 'Methylthio (C)' \
      -tag_length 7 -min_filter_length 7 -fragment_tolerance 20 -fragment_tolerance_unit ppm \
      -isobaric_tolerance 0 -threads 8

(2.23 s, 312.5 MB; 6,103 MS2 spectra, 55,152 tags → 13,048 rows, 10,835
fwd/rev, 10.2× enrichment over chance. The binary confirmed the terminal mod
is absorbed into flank masses.)

Ground truth: `tools/pxd000001_truth.py` machinery imported directly
(`$W/armE_gap.py`); its documented invariants reproduced exactly in this run:
6,103 queries, FDR ≤ 1% at Mascot score ≥ 16.85, 2,254 accepted target PSMs.
A tag is a CORRECT read iff its I/L-folded sequence occurs in the identified
peptide with one flank mass in agreement within 0.05 Da (fixed mods folded
in), per the proven scorer. Among the 8,645 fwd/rev rows on accepted-PSM
spectra, binned by q_db:

| q_db bin | rows | correct reads | fraction correct [95% CI] | bin's nominal q_db range |
|---|---|---|---|---|
| ≤ 0.01 | 6 | 6 | 1.0000 [0.5407, 1.0000] | ≤ 1% spurious DB match |
| 0.01–0.05 | 4,975 | 4,656 | 0.9359 [0.9287, 0.9425] | ≤ 5% |
| 0.05–0.2 | 3,664 | 1,937 | 0.5287 [0.5123, 0.5449] | ≤ 20% |
| > 0.2 | 0 | — | — (max q_db in this run is 0.124) | — |

**The two columns diverge, as they must: q_db calibrates DB-match
spuriousness — the chance that a tag at this evalue matches the database at
all by luck — NOT the probability that the tag correctly reads this spectrum's
peptide.** In the 0.05–0.2 bin, 47.1% of tags are wrong reads of the
identified peptide although at most ~12–20% of them are spurious database
matchers; a tag can be a perfectly genuine Erwinia substring while being the
wrong explanation of the spectrum (different peptide, or right sequence with
wrong flank placement). Even at q_db ≤ 0.05, 6.4% of tags are incorrect
reads. q_db must never be quoted as a per-tag correctness probability.

## Caveats

- The audit assumes B-only matches are false (no genuine M. tuberculosis /
  M. acetivorans content in a human sample). Supporting evidence: 0 B-only
  rows among the q_db ≤ 0.02 acceptance sets of arms A and B. Any real
  contamination would inflate measured FDP.
- The B-only extrapolation assumes false tags hit B-exclusive keys at rate
  r_B; arms A vs B give different aggregate extrapolations (58.7% vs 43.2%),
  so the reference itself carries DB-composition sensitivity of the same kind
  it measures. The FAIL verdicts at x ≥ 0.05 are far outside what that
  uncertainty spans in the conservative direction.
- D(x) at tight thresholds is tiny (10–38 rows) because `min_filter_length 7`
  sits below the derived floor; the PASS verdicts there are weak evidence.
- Tagging is a sensitive prefilter by design; nothing here tunes it — this
  report only measures what the q_db column means.

## Files

All under `$W` (= `/private/tmp/claude-501/-Users-kohlbach-Claude-OpenMS---DirecTag/df88f9b0-cc80-48db-8780-e2bc44da5d34/scratchpad/f4val`):
`run_all.sh` (exact commands, all five runs), `rerun_perf.sh` (perf repeats),
`make_shuf9606.py`, `keytest.py` (key-semantics validation),
`analyze_audit.py` (+ `audit_results.json`, `audit_analysis.out`),
`sanity_membership.py` (+ `sanity.out`), `armE_gap.py` (+ `armE_results.json`,
`armE.out`), TSVs `audit1/audit2/audit3/noentrap/pxd1.tsv`, run logs
`*.log` and stdout `run_all.out`.
