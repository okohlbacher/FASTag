#!/bin/bash
# Hybrid arm, held-out run on node data (PREREG-hybrid.md). The frozen binary only; every mzML, Sage result and scan
# table checked against the manifest sha256; the two FASTag arms of every run, one run after the other; then the
# scorer and the verdict, once.
# Usage: run_heldout.sh <acceptance/1.13 dir>
# An arm that has written a FASTAG_RC line is never run again by this script (technical-failure rule of the PREREG).
set -uo pipefail
A=$(cd "$1" && pwd); H=$A/hybrid; M=$A/manifests/hybrid-heldout.tsv
R=/scratch/kohlbach/b113/hybrid/heldout; W=$R/run
FROZEN=/scratch/kohlbach/b113/hybrid/frozen/FASTag
PY=/ceph/ibmi/abi/oliver/jpr-bench/envs/py/bin/python
mkdir -p /scratch/kohlbach/b113/hybrid/tmp
row=$(awk -F'\t' '$1 == "CFG-hybrid-both"' $A/frozen-configs.tsv | tail -1)
[ "$(cut -f9 <<< "$row")" = frozen ] || { echo "CFG-hybrid-both is not frozen"; exit 2; }
[ "$(sha256sum $FROZEN | cut -c1-64)" = "$(cut -f4 <<< "$row")" ] || { echo "frozen binary sha256 mismatch"; exit 2; }
(cd $H && sha256sum -c --quiet SHA256SUMS) || { echo "script sha256 mismatch"; exit 2; }
[ -e $W/score ] && { echo "$W/score exists: scored once already"; exit 3; }
mkdir -p $W
ck() { [ "$(sha256sum "$1" | cut -c1-64)" = "$2" ] || { echo "sha256 mismatch: $1"; exit 4; }; }
printf 'project\trun\trun_dir\tsage\tscans\n' > $W/runs.tsv
while IFS=$'\t' read -r item prj run mz mzsha sage sagesha scans scanssha rest; do
  [ "$item" = "#hybrid" ] || continue
  ck $R/$mz $mzsha; ck $R/$sage $sagesha; ck $R/$scans $scanssha
  bash $H/scripts/fastag_arms.sh $FROZEN $R/$mz $W/$prj/$run
  printf '%s\t%s\t%s\t%s\t%s\n' $prj $run $W/$prj/$run $R/$sage $R/$scans >> $W/runs.tsv
done < <(grep -v '^# ' $M | tail -n +2)
mkdir -p $W/score
(cd $H && sha256sum scorers/*.py) > $W/score/scorer.sha256
$PY -I $H/scorers/score_hybrid.py $W/runs.tsv $W/score > $W/score/score.log 2>&1; echo SCORE_RC=$? >> $W/score/score.log
$PY -I $H/scorers/verdict_hybrid.py $W/score > $W/score/verdict.log 2>&1; echo VERDICT_RC=$? >> $W/score/verdict.log
echo HELDOUT_DONE > $W/heldout.done
