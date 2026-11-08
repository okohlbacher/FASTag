#!/bin/bash
#SBATCH --partition=compute
#SBATCH --job-name=i06-sage
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=32
#SBATCH --mem=200gb
#SBATCH --time=12:00:00
#SBATCH --output=logs/%x-%A_%a.out
set -uo pipefail
. /pfs/10/project/bw26g016/fastag-1.12/jobs/item06/common.sh
R=$(row $SLURM_ARRAY_TASK_ID); REL=$(cut -f10 <<<"$R"); RD=${REL%.*}; T=$FT/truth/$MAN/$RD
cd $T
sha256sum $FASTAG_SAGE_BIN sage.json input.nocharge.mzML > sage.sha256
/usr/bin/time -v $FASTAG_SAGE_BIN --disable-telemetry-i-dont-want-to-improve-sage -o $T $T/sage.json > sage.log 2>&1
rc=$?; echo "SAGE_RC=$rc" >> sage.log; echo "SAGE_RC=$rc $RD"; exit $rc
