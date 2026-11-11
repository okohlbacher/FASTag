#!/bin/bash
# stage the five additional ion_trap candidates (draw ranks 6-10) with the corrected stage.sh
H=/scratch/kohlbach/b113/compltol/heldout2; D=$H/pre2/acceptance/1.13/compltol/heldout2
PY=/ceph/ibmi/abi/oliver/jpr-bench/envs/py/bin/python
{ head -2 $D/truth/compltol-H2-candidates.tsv; grep -E "PXD056008|PXD060552|PXD019360|PXD060832|PXD052400" $D/truth/compltol-H2-candidates.tsv; } > $H/truth-more.tsv
$PY -I /scratch/kohlbach/fastag112-prereg/repo-r3/acceptance/1.12/scorers/truth_config.py $H/truth-more.tsv $H/staged /ceph/ibmi/abi/oliver/prose-auto-20261029/panel $H/truth --manifest compltol-H2 > $H/truth_config_more.log 2>&1
while IFS=$'\t' read -r st rank acc file rest; do
  [ "$st" = ion_trap ] && [ "$rank" -gt 5 ] || continue
  bash $D/scripts/stage.sh $D/select/candidates.tsv "$acc" "$file" > "$H/stage.$acc.${file%.*}.log" 2>&1 &
done < <(tail -n +2 $D/select/candidates.tsv)
wait
echo MORE_DONE > $H/stage_more.done
