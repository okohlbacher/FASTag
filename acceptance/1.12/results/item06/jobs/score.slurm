#!/bin/bash
# The single scoring of item06-H1-r2 (PREREG-item06.md amendment 1). Refuses to run if the output exists.
#SBATCH --partition=compute
#SBATCH --job-name=i06-score
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=16
#SBATCH --mem=64gb
#SBATCH --time=02:00:00
#SBATCH --output=logs/%x-%j.out
set -uo pipefail
. /pfs/10/project/bw26g016/fastag-1.12/jobs/item06/common.sh
O=$FT/results/item06/$MAN
[ -e $O ] && { echo "RESULT_EXISTS $O (not re-scored)"; exit 4; }
mkdir -p $O
cd $S
sha256sum scorers/acclib.py scorers/score_item02.py scorers/score_item06.py manifests/$MAN.tsv ../../bench/fastag-bench/src/fastag_bench/score.py ../../bench/fastag-bench/src/fastag_bench/parsers.py > $O/scorer.sha256
# python without -I: under -I the script directory is not on sys.path and 'import acclib' fails (as the DEV runs)
$PY scorers/score_item06.py $S $MAN $FT/runs $FT/truth $O > $O/score.txt 2>&1
rc=$?; echo "SCORE_RC=$rc" >> $O/score.txt; cat $O/score.txt
