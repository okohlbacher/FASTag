#!/bin/bash
#SBATCH --partition=compute
#SBATCH --job-name=i06-strip
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=16
#SBATCH --mem=16gb
#SBATCH --time=01:00:00
#SBATCH --output=logs/%x-%A_%a.out
set -uo pipefail
. /pfs/10/project/bw26g016/fastag-1.12/jobs/item06/common.sh
R=$(row $SLURM_ARRAY_TASK_ID); REL=$(cut -f10 <<<"$R"); SHA=$(cut -f11 <<<"$R")
RD=${REL%.*}; T=$FT/truth/$MAN/$RD
got=$(sha256sum < $FT/heldout/$REL | cut -d' ' -f1)
[ "$got" = "$SHA" ] || { echo "INPUT_SHA_MISMATCH $REL $got"; exit 3; }
echo "input $got  $REL" > $T/strip.log
$PY -I $S/scorers/strip_charge.py $FT/heldout/$REL $T/input.nocharge.mzML >> $T/strip.log 2>&1; rc=$?
echo "STRIP_RC=$rc" >> $T/strip.log; cat $T/strip.log; exit $rc
