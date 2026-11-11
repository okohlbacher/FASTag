#!/bin/bash
# compltol held-out 2: truth configs, then stage.sh for every candidate, all in parallel. No FASTag run.
#   stage_all.sh <heldout2 dir of the acceptance tree> <acceptance/1.12/scorers dir>
set -u
D=$(cd "$1" && pwd); SC=$(cd "$2" && pwd); H=${CT_H2:-/scratch/kohlbach/b113/compltol/heldout2}
PY=/ceph/ibmi/abi/oliver/jpr-bench/envs/py/bin/python
P=/ceph/ibmi/abi/oliver/prose-auto-20261029/panel
$PY -I "$SC/truth_config.py" "$D/truth/compltol-H2-candidates.tsv" "$H/staged" "$P" "$H/truth" --manifest compltol-H2 > "$H/truth_config.log" 2>&1
(cd $P && sha256sum *.fasta) > "$H/fasta.sha256"
while IFS=$'\t' read -r st rank acc file rest; do
  bash "$D/scripts/stage.sh" "$D/select/candidates.tsv" "$acc" "$file" > "$H/stage.$acc.${file%.*}.log" 2>&1 &
done < <(tail -n +2 "$D/select/candidates.tsv")
wait
head -1 "$(ls $H/qual/*.tsv | head -1)" > "$H/qualification.tsv"; for q in $H/qual/*.tsv; do tail -n +2 "$q"; done | sort >> "$H/qualification.tsv"
echo STAGE_ALL_DONE > "$H/stage_all.done"
