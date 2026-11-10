#!/bin/bash
# stage the 8 chosen files, one process per project (no FASTag, no search)
H=/scratch/kohlbach/b113/census/heldout/census2
export CENSUS_HELDOUT=$H/raw
for p in $(awk -F'\t' '$1=="chosen"{print $2}' $H/acc/inputs2/stage.tsv); do
  bash $H/acc/scripts/stage_census.sh $H/acc/inputs2/stage.tsv $H/staged/staged_chosen.$p.tsv chosen $p > $H/staged/stage.$p.log 2>&1 &
done
wait
touch $H/staged/STAGE_CHOSEN_DONE
