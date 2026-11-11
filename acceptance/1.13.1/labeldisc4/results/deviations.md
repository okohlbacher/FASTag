# Held-out test 4: deviations and notes after the run (no score changed)

- Count error in the freeze-2 addendum of PREREG-labeldisc4.md: "140 of 160 projects included" should read 144 (the
  class table of the addendum sums to 144; `manifests/audited.tsv` has 144 rows with include = yes). The run and the
  scores use the manifest; nothing else depends on the number.
- Run: `scripts/run_all.sh` once, all three binaries 144 of 144 runs, exit code 0 for every run, no input checksum
  differed (`score-*/inputs_verified.tsv`). Scoring and verdict once.
- The 864 FASTag report files (ld.tsv, rc.txt of m0, b2, f2; 23 MB as a tgz) are kept on node data under
  /scratch/kohlbach/post1131/labeldisc/heldout4/res/ld_tsv.tgz, not in the repository.
