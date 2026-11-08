#!/bin/bash
# The single scoring of #2 (item02-H1-r2, high-resolution sets astral, qe, timstof; PREREG-item02.md amendment 2).
# Refuses to run if the output exists. Truth root truth-r4: the two amended timsTOF truths plus links to the five
# round-3 high-resolution truths (job 6472365, unchanged).
#SBATCH --partition=compute
#SBATCH --job-name=r4-i02score
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=16
#SBATCH --mem=128gb
#SBATCH --time=04:00:00
#SBATCH --output=/pfs/10/project/bw26g016/fastag-1.12/r4/logs/%x-%j.out
set -uo pipefail
. /pfs/10/project/bw26g016/fastag-1.12/r4/jobs/common.sh
check_scorers
O=$FT/r4/results/item02/item02-H1-r2-hr
[ -e $O ] && { echo "RESULT_EXISTS $O (not re-scored)"; exit 4; }
mkdir -p $O; cd $S
sha256sum scorers/acclib.py scorers/score_item02.py manifests/item02-H1-r2.tsv ../../bench/fastag-bench/src/fastag_bench/score.py ../../bench/fastag-bench/src/fastag_bench/parsers.py $R2/timing/timing.tsv > $O/scorer.sha256
ls -l $R2/truth-r4/item02-H1-r2/item02/*/* > $O/truth-links.txt
# no 'python -I': under -I the script directory is not on sys.path and 'import acclib' fails (amendment 2 erratum)
$PY scorers/score_item02.py $S item02-H1-r2 $R2/runs $R2/truth-r4 $O --timing $R2/timing/timing.tsv --sets astral,qe,timstof > $O/score.txt 2>&1
rc=$?; echo "SCORE_RC=$rc" >> $O/score.txt; cat $O/score.txt
