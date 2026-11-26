# RESULT-silac-v2: held-out test of `-label_format 2` — **FAIL** (E2 and E3 fail; no default changes)

Run once and scored once on 2026-11-26 under `PREREG-silac-v2.md` (frozen 17:15 UTC, branch commit c5c2d2af;
truth record 706000b2 committed before the run). Frozen binary `silac-v2-e1557be6` (CI run 45831304804,
`FASTag.bin` sha256 fa96966c…577e), frozen command, 132 runs of 22 PXDs; 132/132 tasks exit 0 on kim (bench
harness backend `node-kim`). Scorer `score_silac_v2.py` sha256 5b0e9d47…5266, truth table sha256 5f970090…8b6f.
Outputs: `heldout/results/` (endpoints.tsv, per_label.tsv, **per_run.tsv** = the per-run table, verdict.txt);
copies in `acceptance/1.17/silac-v2/` of PR #136 and on Ceph `/ceph/ibmi/abi/oliver/fastag-bench/silac-heldout-v2/`.

## Verdict per class (both classes conclusive: ≥ 15 truth-present pairs and ≥ 15 light-only runs)

| Scope | E1 recall | E2 false-present | E3 vs 1.16 | Verdict |
|---|---|---|---|---|
| Orbitrap HCD (74 scored runs) | PASS | **FAIL** | **FAIL** | FAIL |
| timsTOF (41 scored runs) | **FAIL** | PASS | **FAIL** | FAIL |
| Pooled | PASS | **FAIL** | **FAIL** | FAIL |

Decision rule (section 5): E2 fails → **format 2 stays experimental and opt-in; no default changes.** The
false-present cases are listed below.

## Endpoints (Wilson 95% intervals)

| Scope | E1 recall (present called / truth present) | E2 false-present (present called / truth absent) |
|---|---|---|
| Orbitrap | 106/120 = **0.883** (0.814–0.929) — pass needs ≥ 0.70 | 21/147 = **0.143** (0.095–0.209) — pass needs ≤ 0.08 |
| timsTOF | 12/24 = **0.500** (0.314–0.686) — pass needs ≥ 0.70 | 7/129 = **0.054** (0.027–0.108) — pass needs ≤ 0.08 |
| Pooled | 118/144 = **0.819** (0.749–0.874) — needs ≥ 0.80, low ≥ 0.70 | 28/276 = **0.101** (0.071–0.143) — needs ≤ 0.05, high ≤ 0.10 |

| Scope | E3 labelled runs correct, v2 vs v1 | v2 − v1 (needs ≥ 0.20) | Light-only false SILAC, v2 vs v1 | v2 − v1 (needs ≤ 0.02) |
|---|---|---|---|---|
| Orbitrap | 37/49 = 0.755 (0.619–0.854) vs 23/49 = 0.469 (0.337–0.606) | +0.286 | 7/20 = 0.35 (0.18–0.57) vs 0/20 | **+0.35** |
| timsTOF | 6/13 = 0.462 (0.232–0.709) vs 0/13 (0–0.228) | +0.462 | 7/22 = 0.32 (0.16–0.53) vs 0/22 | **+0.32** |
| Pooled | 43/62 = 0.694 (0.570–0.794) vs 23/62 = 0.371 (0.262–0.495) | +0.323 | 14/42 = 0.33 (0.21–0.48) vs 0/42 | **+0.33** |

E3 fails on its light-only half only; on labelled runs format 2 beats the 1.16 call (discordant runs 22 v2-only
vs 2 v1-only, exact sign test p = 3.6e-05; Orbitrap 16 vs 2, p = 0.0013; timsTOF 6 vs 0, p = 0.031; descriptive).

## Secondary (descriptive, decide nothing)

Per label (present called / truth present; false-present / truth absent):

| Label | Orbitrap recall | Orbitrap false | timsTOF recall | timsTOF false |
|---|---|---|---|---|
| Lys4 | 22/26 | 2/40 | 2/2 | 0/38 |
| Arg6 | 26/28 | 0/42 | 4/8 | 0/33 |
| Lys8 | 28/36 | 5/30 | 4/7 | 0/29 |
| Arg10 | 30/30 | **14/35** | 2/7 (5 `alias_AL`) | **7/29** |

- **Arg10 is 21 of the 28 false-present pairs.** The A+L alias reaches 0.2 on the y route: label-free Orbitrap
  PXD087065 (all 6 runs, Arg10 share 0.26–0.39), label-free timsTOF PXD079678 (all 6 runs, 0.57–0.59; the y gate is
  closed for K but ≥ 50 y-route R ends make Arg10 assessable), light-only PXD056725 (0.98) and PXD061384 (0.36),
  and PXD042191 (0.21–0.22 where light R is depleted). The known limit of the freeze (0.071 on the development
  control) is not a bound: on other label-free runs it is 4–8 times higher.
- **Pairwise shares inflate when the light form is depleted.** heavy / (heavy + light) is high with few heavy
  ends when light is rare: PXD061306 runs 01/09 (fully Lys4/Arg6-labelled) give Lys8 0.67–0.70 and Arg10 0.95
  against truth shares ≤ 0.002; PXD054505 runs 01/06/10 give Lys4/Lys8/Arg10 0.30–0.67 against truth 0.000.
  (For PXD054505 the truth takes the labels of the search's first parameter group; a truth error for those three
  runs cannot be excluded and was not corrected after the run.)
- Missed present pairs (26): mostly low heavy shares (truth 0.05–0.13, format-2 share below 0.2: pulse designs
  PXD047063, PXD065290, PXD046238) and Arg10 `not_assessable alias_AL` on timsTOF (5); Arg6 on timsTOF PXD039806
  read 0.05–0.18 against truth 0.12–0.32.
- Light-only runs: timsTOF 15 `no_call no_y1_ends`, 7 false Arg10; Orbitrap 6 `call none`, 7 `no_call no_y1_ends`
  (y gate closed on 12 of 84 Orbitrap runs), 7 false Arg10. The 1.16 call made no false SILAC call on any of them.
- y gate open on 72/84 Orbitrap runs and 1/48 timsTOF runs (the PXD067551 finding holds on held-out timsTOF data).
- Leave-one-PXD-out: Orbitrap E1 0.854–0.930, E2 0.094–0.171; timsTOF E1 0.312–0.688, E2 0.010–0.067; pooled E1
  0.783–0.860, E2 0.075–0.111. No single PXD carries the E2 failure in the pooled set or on Orbitrap.
- Strata (truth): Orbitrap mixed 38, light-only 20, single-label 7, heavy-only 4, unresolved 9 (pairs ambiguous),
  other-label 6 (PXD066863, Lys6, not scored); timsTOF light-only 22, mixed 7, single-label 6, unresolved 13
  (PXD079824's 6 runs have no per-run search). No timsTOF heavy-only run; Lys4 on timsTOF only 2 present pairs.

## Deviations from the preregistration (with reasons)

- D0 PXD042191: per-run truth taken from `others.tar` (MaxQuant txt); the frozen `search.tar` holds only
  MaxQuant's internal index. Fetched in addition, before the run.
- D1 Orbitrap input: `.raw` read directly by the frozen binary instead of the pinned FileConverter mzML, because
  `pxd convert` refuses that converter (its deployment tree sha256 changed: e36e496b… ≠ pinned eb7c3b8b…). On the
  development control the `.raw` path gives the mzML path's label.tsv and tags.tsv byte for byte (input row
  aside). `make_harness.py` was regenerated for this (sha256 6f769394…, recorded in TRUTH-RECORD.md before the run).
- D2 Fetch over HTTPS, not Globus (11 MB/s); not a protocol change.
- D3 timsTOF has 4 scored SILAC PXDs (target 8): PXD046777 left out at the freeze (plain `.zip` deposit),
  PXD079824 without per-run truth after fetching (its runs ran and are listed, not scored); per the frozen rule no
  replacement after the freeze.
- Truth implementation details fixed after reading the search files and before the run (TRUTH-RECORD.md):
  renamed-deposit maps (PXD064721, PXD066221 by replicate number, PXD065290), labels of PXD065290 from its protocol
  text, PEAKS pepXML/mzIdentML acceptance, FragPipe peptide-level truth for PXD039806, UTF-8 BOM handling.
- Not a deviation but a fact: the GitHub push of the truth-record commit was delayed by a network outage; the
  commit (706000b2) and its Ceph copy predate the first held-out task (18:48 UTC).

## What this means

Format 2 finds labels the 1.16 call misses (labelled runs 0.69 vs 0.37 correct; Orbitrap recall 0.88), but it
calls SILAC on a third of the label-free runs, almost always Arg10 through the A+L alias, and calls heavy labels
in fully labelled medium runs through the pairwise share. Both are design faults found on held-out data; fixing
them (Arg10 against an A+L background, shares against the whole residue family) is new development and needs a
new preregistered test on new data. This set is now spent for format 2.
