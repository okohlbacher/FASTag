# compltol held-out result (compltol-H1, scored once)

**Verdict: FAIL** ((i) FAIL; (ii) PASS; (iii) PASS; (iv) PASS; all 132 runs FASTAG_RC=0, all 11 truths present).
`-complement_tolerance_unit auto` stays experimental; the default stays `Da` (0.02 Da).

Scored once on BinAC2 (Slurm 6510178) from the git archive of 205ba00, with the PREREG command:
`score_item02.py acceptance/1.13 compltol-H1 runs truth out --timing timing/timing.tsv --base CFG-CT-base
--cand CFG-CT-cand`. FASTag array Slurm 6509959 (132/132 COMPLETED), timing Slurm 6509961 (node1-051, exclusive),
runtime check Slurm 6509902. result.json sha256 `4653bf15a44f2a5aa29065fa340fc8ca93339a00ea071ea5cde2224cecc412c5`.

| Endpoint | Result |
|---|---|
| (i) non-inferiority, 72 cells | **FAIL**: 3 astral cells fail. L5_default z2 has point -0.503 (< -0.5, Holm bound -0.83). L4_default z4+ has point -0.27 with Holm bound -1.12, L5_default z4+ point +0.27 with Holm bound -1.02 (346 clusters each). ion_trap L5 z4+ (default and nodeiso) is uninformative (baseline 1.33% and 0.78% < 1.8%). Every other cell passes |
| (ii) L3_default, astral + ion_trap, z >= 2 | **PASS**: +3.05 points, 2.5th percentile +2.77 |
| (iii) timsTOF 4+, default, L3/L4/L5 | **PASS**: 0.00 / +0.12 / +0.04 points (lower 95% bounds -0.28 / -0.24 / -0.25) |
| (iv) time, PXD003531, 1 thread | **PASS**: median ratio 1.027 (base 19.19 s, cand 19.71 s) |

Descriptive, not endpoints:
- ion_trap: +2.1 to +5.1 points in every powered 2+ and 3+ cell. 4+ cells: 0.0 or -0.16.
- qe, timstof: every cell within +-0.33 points.
- astral: -0.50 to +0.28 points. The losses are at length 5 (default profile) and in the 346-cluster 4+ cells.
- Measured windows (L3_default, `measured_windows.tsv`): high resolution 0.018-0.028 Da, with no measurement and
  the 0.02 Da fallback on PXD050504 and PXD070049 (signal 32 each); ion trap 0.210-0.267 Da (median pair error
  +0.07 to +0.13 Da).

Nothing was re-run or re-scored. Development data (DEV) were PXD003531 and PXD001819 only.
