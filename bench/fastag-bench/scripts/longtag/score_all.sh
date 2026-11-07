#!/bin/bash
# score_all.sh: score every rerun of the tag-length-3 analysis against DirecTag (lt_score.py).
B=/ceph/ibmi/abi/oliver/jpr-bench; PY=$B/envs/py/bin/python; H=$B/accuracy/fastag-bench-v190/src
A=$B/accuracy/work/runs; F=$B/accuracy/work-v190/runs; R=/scratch/kohlbach/longtag/runs
for pair in PXD076528:PXD076528_Astral_7673 PXD001819:PXD001819_UPS1_yeast_LTQ_CID PXD003531:PXD003531_QE_NO_03 PXD000001:PXD000001_Erwinia_TMT6; do
  p=${pair%%:*}; ds=${pair##*:}; args=()
  for d in $R/$p/*/; do n=$(basename $d); case $n in *pvals*) continue;; esac; [ -s $d/tags.tsv ] && args+=("$n=$d/tags.tsv"); done
  $PY $B/longtag/scripts/lt_score.py $H $ds $A/$ds/sage/default/results.sage.tsv $(ls $A/$ds/directag/directag_matched/*.tags) \
     $F/$ds/fastag/fastag_matched/tags.tsv $B/longtag/out/reruns_$p.tsv "${args[@]}"
done
