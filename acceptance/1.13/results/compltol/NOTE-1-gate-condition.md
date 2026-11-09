# compltol (#15) note 1: the BinAC2 gate condition before the held-out run (2026-11-09, post hoc)

Written after the result (28a9a63) in answer to a review point. Nothing is re-run or re-scored; the verdict
(FAIL) is unchanged.

## What the PREREG said

`PREREG-compltol.md` (205ba00): before the FASTag array, `compltol/jobs/gate.slurm` runs gate.sh vs refs-1.12.0 on
BinAC2, and "the held-out array is submitted only after that gate passes. As in 1.12, `out_spectra_mzml` may
differ only in the recorded input path and the index offsets."

## What happened

Slurm 6509902 (log `fastag-1.13/compltol/logs/gate-6509902.out` on BinAC2): 8/9 PASS, `out_spectra_mzml` FAIL on
its masked hash (`340f942b...` reference vs `cae90c92...`). The run-start row (326145c) records a raw diff of that
mzML against data's r4 gate output: the recorded input path, the completion time and the index offsets differ;
`tags.tsv` is identical. The array (6509959) was submitted after that check, and the row was committed before
the score job (6510178) and before the result commit (28a9a63).

## Assessment

- The completion time is not part of the gate condition. gate.sh hashes the mzML after masking the
  `completion time` value and the data-processing software version (gate.sh line 78; the BinAC2 copy
  `fastag-1.12/gate/gate.sh` has the same mask, checked 2026-11-09). A raw diff of two runs made at different
  times always shows it. The masked hashes therefore differ only through the input path and the index offsets,
  which is the difference the PREREG allows. This is consistent with the 1.12 runtime check
  (`output/features-1.12/BINAC2-RUNTIME.md`, job 6464797: identical when the recorded path matches).
- The run-start row's wording was imprecise in two ways: it listed the completion time among the differences
  without saying that gate.sh masks it, and it cited BINAC2-RUNTIME.md for that difference, which lists only
  the path and the offsets (because it compared masked files).
- The judgement that the gate condition held was made before scoring. None of these differences can reach the
  scored outputs: `tags.tsv` was identical, and the held-out runs write no `-out_spectra`.
- No path-masked re-hash of the BinAC2 mzML was made before the array, so the claim "differs only in the path and
  offsets" rests on the raw diff plus gate.sh's mask, not on a second hash. This is recorded as a deviation in
  procedure, not in substance.

## For later 1.13 PREREGs

State the allowed difference against what gate.sh compares: "after gate.sh's own mask (completion time,
data-processing software version), `out_spectra_mzml` may differ only in the recorded input path and the index
offsets", and check it with a path-masked re-hash before the array.
