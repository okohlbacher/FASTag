#!/bin/bash
# item09-H1: the single scoring of CFG-09-base/-cand/-base-it05/-cand-it05 (PREREG-item09.md + amendment 1).
#SBATCH --partition=compute
#SBATCH --job-name=i09score
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=8
#SBATCH --mem=64gb
#SBATCH --time=02:00:00
#SBATCH --output=/pfs/10/project/bw26g016/fastag-1.12/ho/item09/logs/%x-%j.out
set -uo pipefail
FT=/pfs/10/project/bw26g016/fastag-1.12
W=$FT/ho/item09
ACC=$FT/acc-ed0a7e0/acceptance/1.12
[ -e $W/results/item09/result.json ] && { echo "REFUSE: already scored"; exit 3; }
cd $ACC/scorers
sha256sum score_item09.py score_item02.py acclib.py
$FT/score-venv/bin/python score_item09.py $ACC $W/runs $W/truth $W/results/item09
echo "SCORE_RC=$?"
