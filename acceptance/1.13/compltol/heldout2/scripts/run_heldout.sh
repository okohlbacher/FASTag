#!/bin/bash
# compltol held-out 2, the run on node data (PREREG-compltol-heldout2.md). The frozen binary only; every mzML and
# Sage result is checked against the manifest sha256; 12 FASTag runs per file (2 arms x 6 cells), then the timing on
# the DEV run, then the scorer and the verdict, once.
# Usage: run_heldout.sh <acceptance/1.13 dir of a git archive of the freeze commit>
# A cell that has written a FASTAG_RC line is never run again by this script (technical-failure rule of the PREREG).
set -uo pipefail
A=$(cd "$1" && pwd); D=$A/compltol/heldout2; M=$A/manifests/compltol-H2.tsv
H=/scratch/kohlbach/b113/compltol/heldout2; W=$H/run; FROZEN=$H/frozen/FASTag
PY=/ceph/ibmi/abi/oliver/jpr-bench/envs/py/bin/python
DEV=/scratch/kohlbach/gate-in/PXD003531/20130611_QE3_UPLC10_CFR_SA_OC_T_NO_03_01_01.mzML
THREADS=16; PAR=4
row=$(awk -F'\t' '$1 == "CFG-CT2-cand"' $A/frozen-configs.tsv | tail -1)
[ "$(cut -f9 <<< "$row")" = frozen ] || { echo "CFG-CT2-cand is not frozen"; exit 2; }
[ "$(sha256sum $H/frozen/FASTag.bin | cut -c1-64)" = "$(cut -f4 <<< "$row")" ] || { echo "frozen binary sha256 mismatch"; exit 2; }
(cd $D && sha256sum -c --quiet SHA256SUMS) || { echo "script sha256 mismatch"; exit 2; }
[ -e $W/score ] && { echo "$W/score exists: scored once already"; exit 3; }
echo "2b1da22229a9d8e8d4cde05d889c3a74dedd68bb9f00f3bdd9d78d2a8d9ace4a  $DEV" | sha256sum -c --quiet - || { echo "DEV input sha256 mismatch"; exit 4; }
mkdir -p $W/runs $W/timing
c() { awk -F'\t' -v n="$1" 'NR == 1 {for (i = 1; i <= NF; i++) if ($i == n) print i}' <(grep -v '^# ' $M); }
ci=$(c fastag_input); cs=$(c fastag_input_sha256); ca=$(c ms2_analyser); ct=$(c truth_sha256)
one() {   # <fastag_input> <mzML sha256> <ms2_analyser> <truth sha256>
  local rel=${1%.mzML} suf="" it=""
  [ "$(sha256sum "$H/staged/$1" | cut -c1-64)" = "$2" ] || { echo "sha256 mismatch: $1"; return 4; }
  [ "$(sha256sum "$H/truth/compltol-H2/$rel/results.sage.tsv" | cut -c1-64)" = "$4" ] || { echo "truth sha256 mismatch: $1"; return 4; }
  [ "$3" = ion_trap ] && { suf=-it05; it="-fragment_tolerance 0.5 -fragment_tolerance_unit Da"; }
  for cell in L3_default L4_default L5_default L3_nodeiso L4_nodeiso L5_nodeiso; do
    local L=${cell:1:1} nd=""; [ "${cell#*_}" = nodeiso ] && nd="-no_deisotope"
    for arm in base cand; do
      local d=$W/runs/CFG-CT2-$arm$suf/compltol-H2/$rel/$cell ao=""
      [ $arm = cand ] && ao="-complement_tolerance_unit auto"
      mkdir -p "$d"; grep -q '^FASTAG_RC=' "$d/run.log" 2>/dev/null && continue
      ( cd "$d" && $FROZEN -in "$H/staged/$1" -out tags.tsv -threads $THREADS -tag_length $L $nd $ao $it > run.log 2>&1; echo FASTAG_RC=$? >> run.log )
    done
  done
}
export -f one; export H W FROZEN THREADS
grep -v '^# ' $M | tail -n +2 | cut -f$ci,$cs,$ca,$ct | tr '\t' ' ' | xargs -P $PAR -L 1 bash -c 'one "$@"' _ > $W/arms.log 2>&1
echo ARMS_RC=$? >> $W/arms.log
# (iv) timing: DEV PXD003531, 1 thread, 7 interleaved repeats, after the arms (nothing else of this test running)
printf 'arm\trepeat\tseconds\trc\thost\n' > $W/timing/timing.tsv
cd $W/timing
for rep in 1 2 3 4 5 6 7; do
  for arm in CFG-CT2-base CFG-CT2-cand; do
    OPTS=""; [ $arm = CFG-CT2-cand ] && OPTS="-complement_tolerance_unit auto"
    t0=$(date +%s.%N)
    $FROZEN -in $DEV -out tags_${arm}_$rep.tsv -threads 1 $OPTS > run_${arm}_$rep.log 2>&1; rc=$?
    t1=$(date +%s.%N)
    printf '%s\t%s\t%s\t%s\t%s\n' $arm $rep $(awk -v a=$t0 -v b=$t1 'BEGIN{printf "%.3f", b-a}') $rc $(hostname) >> timing.tsv
    sha256sum tags_${arm}_$rep.tsv >> tags.sha256; rm -f tags_${arm}_$rep.tsv
  done
done
uptime > $W/timing/uptime.txt
mkdir -p $W/score
(cd $A/.. && sha256sum 1.12/scorers/score_item02.py 1.12/scorers/acclib.py 1.13/compltol/heldout2/scorers/verdict_heldout2.py) > $W/score/scorer.sha256
cd $W
$PY -I $A/../1.12/scorers/score_item02.py $A compltol-H2 $W/runs $H/truth $W/score --timing $W/timing/timing.tsv \
  --base CFG-CT2-base --cand CFG-CT2-cand > $W/score/score.log 2>&1; echo SCORE_RC=$? >> $W/score/score.log
$PY -I $A/../1.12/scorers/score_item02.py $A compltol-H2 $W/runs $H/truth $W/score_ii --timing $W/timing/timing.tsv \
  --base CFG-CT2-base --cand CFG-CT2-cand --sets ion_trap > $W/score/score_ii.log 2>&1; echo SCORE_RC=$? >> $W/score/score_ii.log
$PY -I $D/scorers/verdict_heldout2.py $W/score $W/score_ii $W/runs $M $W/timing/timing.tsv > $W/score/verdict.log 2>&1; echo VERDICT_RC=$? >> $W/score/verdict.log
echo HELDOUT_DONE > $W/heldout.done
