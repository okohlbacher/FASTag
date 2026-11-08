#!/bin/bash
#SBATCH --partition=compute
#SBATCH --job-name=r4-i06strip
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=4
#SBATCH --mem=16gb
#SBATCH --time=02:00:00
#SBATCH --output=/pfs/10/project/bw26g016/fastag-1.12/r4/logs/%x-%A_%a.out
set -uo pipefail
. /pfs/10/project/bw26g016/fastag-1.12/r4/jobs/common.sh
check_scorers
E=${I6[$((SLURM_ARRAY_TASK_ID-1))]}; MAN=${E%%	*}
R=$(row6 "$E"); REL=$(cut -f10 <<<"$R"); SHA=$(cut -f11 <<<"$R"); RD=${REL%.*}; T=$FT/truth/$MAN/$RD
[ -e $T/input.nocharge.mzML ] && { echo "EXISTS $T"; exit 4; }
mkdir -p $T
got=$(sha256sum < $FT/heldout/$REL | cut -d' ' -f1)
[ "$got" = "$SHA" ] || { echo "INPUT_SHA_MISMATCH $REL $got"; exit 3; }
echo "input $got  $REL" > $T/strip.log
$PY -I $S/scorers/strip_charge.py $FT/heldout/$REL $T/input.nocharge.mzML >> $T/strip.log 2>&1; rc=$?
echo "STRIP_RC=$rc" >> $T/strip.log; cat $T/strip.log; exit $rc
