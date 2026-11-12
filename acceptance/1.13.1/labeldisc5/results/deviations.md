# Held-out test 5: deviations from PREREG-labeldisc5.md

1. Harness: `manifests/manual_exclusions.tsv` (frozen, sha256 97e859fd...) was missing from the work directory on
   `data`. The first `audit_heldout5.py` call stopped on the missing file before writing any output; the file was copied
   unchanged and the audit was run once. All frozen scripts, scorers and both binaries were checked against the
   freeze-1 sha256 values on `data` before the audit and before the run.
2. Freeze 2 is two commits: eff9874 (PREREG addendum) and 3e68f2f (`manifests/audited.tsv`, `manifests/stage/*.tsv`,
   force-added past the `*.tsv` rule of `.gitignore`). Both were pushed before the first FASTag run. Freeze 2 = 3e68f2f.
3. No other deviation: 147 of 147 rank-0 files staged, no reruns or backups; `run_all.sh` ran once (t2 and t0 rc=0,
   141 of 141 runs each, 0 technical failures); scored once; verdict once. No criterion, threshold, script or binary
   changed after freeze 1. Wrong-call causes were looked up after scoring and change no score.
