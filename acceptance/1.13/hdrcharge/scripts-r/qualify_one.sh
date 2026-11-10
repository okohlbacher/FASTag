#!/bin/bash
# stage (chosen file; the backup file when the chosen one fails download or conversion) and qualify one project.
#   qualify_one.sh <stage.tsv> <accession>
set -u; H=$(cd "$(dirname "$0")/.." && pwd); L=$1; A=$2
ROOT=${HDR_HELDOUT:-/scratch/kohlbach/b113/hdrcharge/heldout/r2}; OD=$ROOT/staged; mkdir -p $OD
bash $H/scripts-r/stage_r.sh $L $OD chosen $A
row=$(tail -1 $OD/staged_chosen.$A.tsv); role=chosen
if [ "$(cut -f8 <<<"$row")" = "" ] || [ "$(cut -f10 <<<"$row")" = "-" ]; then   # no mzML: download or conversion failed
  bash $H/scripts-r/stage_r.sh $L $OD backup $A; row=$(tail -1 $OD/staged_backup.$A.tsv); role=backup
fi
if [ "$(cut -f16 <<<"$row")" = ok ]; then bash $H/scripts-r/truth_r.sh "$ROOT/$(cut -f8 <<<"$row")" $ROOT/$A/work; fi
echo "$role" > $ROOT/$A.qualify.done
