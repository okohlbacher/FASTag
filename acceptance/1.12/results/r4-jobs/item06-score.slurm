#!/bin/bash
# The single scoring of #6 on the high-resolution H2/H2r runs (PREREG-item06.md amendment 2). Refuses if output exists.
#SBATCH --partition=compute
#SBATCH --job-name=r4-i06score
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=16
#SBATCH --mem=480gb
#SBATCH --time=06:00:00
#SBATCH --output=/pfs/10/project/bw26g016/fastag-1.12/r4/logs/%x-%j.out
set -uo pipefail
. /pfs/10/project/bw26g016/fastag-1.12/r4/jobs/common.sh
check_scorers
O=$FT/r4/results/item06/item06-H2-H2r-hr
[ -e $O ] && { echo "RESULT_EXISTS $O (not re-scored)"; exit 4; }
mkdir -p $O; cd $S
sha256sum scorers/acclib.py scorers/score_item02.py scorers/score_item06.py manifests/item06-H2.tsv manifests/item06-H2r.tsv ../../bench/fastag-bench/src/fastag_bench/score.py ../../bench/fastag-bench/src/fastag_bench/parsers.py > $O/scorer.sha256
# no 'python -I' (amendment 2 erratum: under -I 'import acclib' fails)
$PY scorers/score_item06.py $S item06-H2,item06-H2r $FT/runs $FT/truth $O --sets astral,qe --exclude-pxd PXD035981 > $O/score.txt 2>&1
rc=$?; echo "SCORE_RC=$rc" >> $O/score.txt; cat $O/score.txt
