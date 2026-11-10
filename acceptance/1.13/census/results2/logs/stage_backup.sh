#!/bin/bash
# PREREG rule: the chosen file of these projects failed staging; stage the backup once
H=/scratch/kohlbach/b113/census/heldout/census2
export CENSUS_HELDOUT=$H/raw
for p in PXD067571 PXD068740; do
  bash $H/acc/scripts/stage_census.sh $H/acc/inputs2/stage.tsv $H/staged/staged_backup.$p.tsv backup $p > $H/staged/stage_backup.$p.log 2>&1 &
done
wait
touch $H/staged/STAGE_BACKUP_DONE
