#!/bin/bash
# hdrcharge second held-out round on node data (PREREG-item14r.md). The frozen binary only; every input, truth file
# and perturbed copy checked against the manifest sha256; FASTag under CFG-14r-warn on each input as given and on its
# perturbed copy; then the scorer, the chimera split and the verdict, once.
# Usage: run_heldout_r.sh <acceptance/1.13 dir> <round root>      (round root: /scratch/kohlbach/b113/hdrcharge/heldout/r2)
# A FASTag arm that has written a FASTAG_RC line is never run again by this script (technical-failure rule of the
# PREREG: an infrastructure failure is rerun by moving its arm directory aside, by hand, and is logged).
set -uo pipefail
A=$(cd "$1" && pwd); R=$2; W=$R/run
M=$A/manifests/item14r-hdrcharge.tsv; H=$A/hdrcharge
FROZEN=/scratch/kohlbach/b113/hdrcharge/frozen-r/FASTag
PY=/ceph/ibmi/abi/oliver/jpr-bench/envs/py/bin/python
source /scratch/kohlbach/b113/hdrcharge/env.sh
export TMPDIR=/scratch/kohlbach/b113/hdrcharge/tmp OPENMS_TMPDIR=/scratch/kohlbach/b113/hdrcharge/tmp; mkdir -p $TMPDIR
export OPENBLAS_NUM_THREADS=1
row=$(awk -F'\t' '$1 == "CFG-14r-warn"' $A/frozen-configs.tsv | tail -1)
want_bin=$(cut -f4 <<< "$row"); opts=$(cut -f6 <<< "$row"); status=$(cut -f9 <<< "$row")
[ "$status" = frozen ] || { echo "CFG-14r-warn is not frozen ($status)"; exit 2; }
[ "$(sha256sum $FROZEN | cut -c1-64)" = "$want_bin" ] || { echo "frozen binary sha256 mismatch"; exit 2; }
(cd $H && sha256sum -c --quiet SHA256SUMS-r) || { echo "script sha256 mismatch"; exit 2; }
[ -e $W/score ] && { echo "$W/score exists: scored once already"; exit 3; }
mkdir -p $W
ck() { [ "$(sha256sum "$1" | cut -c1-64)" = "$2" ] || { echo "sha256 mismatch: $1"; exit 4; }; }
specs_a=(); specs_p=(); specs_c=(); failed=""
while IFS=$'\t' read -r item split cls pxd run instr input isha rawsha truth tsha chim csha pert psha ptsv ptsha ntruth url sel; do
  [ "$item" = "#14r" ] || continue
  ck $R/$input $isha; ck $R/$truth $tsha; ck $R/$chim $csha; ck $R/$pert $psha; ck $R/$ptsv $ptsha
  d=$W/$pxd
  for arm in asgiven perturbed; do
    in=$R/$input; [ $arm = perturbed ] && in=$R/$pert
    mkdir -p $d/$arm
    if ! grep -q '^FASTAG_RC=' $d/$arm/log 2>/dev/null; then
      # shellcheck disable=SC2086
      ( cd $d/$arm && $FROZEN -in $in -out tags.tsv $opts > log 2>&1; echo FASTAG_RC=$? >> log; rm -f tags.tsv ) &
    fi
  done
  wait
  if ! grep -q '^FASTAG_RC=0' $d/asgiven/log || [ ! -s $d/asgiven/hc.tsv ]; then failed="$failed,$pxd"; fi
  specs_a+=("$pxd:$cls=$d/asgiven/hc.tsv,$R/$truth")
  specs_p+=("$pxd:$cls=$d/perturbed/hc.tsv,$R/$truth,$R/$ptsv")
  specs_c+=("$pxd=$d/asgiven/hc.tsv,$R/$truth,$R/$chim")
done < <(grep -v '^# ' $M | tail -n +2)
mkdir -p $W/score
(cd $H && sha256sum scorers/score_item14r.py scorers/verdict_item14r.py scorers/hc_chimera.py) > $W/score/scorer.sha256
$PY -I $H/scorers/score_item14r.py $W/score/asgiven.tsv "${specs_a[@]}" > $W/score/asgiven.log 2>&1; echo SCORE_RC=$? >> $W/score/asgiven.log
$PY -I $H/scorers/score_item14r.py $W/score/perturbed.tsv "${specs_p[@]}" > $W/score/perturbed.log 2>&1; echo SCORE_RC=$? >> $W/score/perturbed.log
$PY -I $H/scorers/hc_chimera.py "${specs_c[@]}" > $W/score/chimera.tsv 2> $W/score/chimera.log; echo SCORE_RC=$? >> $W/score/chimera.log
$PY -I $H/scorers/verdict_item14r.py $W/score/asgiven.tsv --failed "${failed#,}" --runs 5 > $W/score/verdict.json 2> $W/score/verdict.log
$PY -I $H/scorers/verdict_item14r.py $W/score/perturbed.tsv --runs 5 > $W/score/perturbed.summary.json 2>> $W/score/verdict.log
echo HELDOUT_DONE > $W/heldout.done
