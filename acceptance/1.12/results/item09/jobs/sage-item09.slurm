#!/bin/bash
# item09-H1 truth searches (PREREG-item09.md): Sage 0.14.7 on the centroided corpus mzML, one task per evaluable run (3).
#SBATCH --partition=compute
#SBATCH --job-name=i09truth
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=32
#SBATCH --mem=128gb
#SBATCH --time=06:00:00
#SBATCH --output=/pfs/10/project/bw26g016/fastag-1.12/ho/item09/logs/%x-%A_%a.out
set -uo pipefail
FT=/pfs/10/project/bw26g016/fastag-1.12
W=$FT/ho/item09
. $FT/bin/fastag-env.sh
D=$(sed -n "${SLURM_ARRAY_TASK_ID}p" $W/truth-dirs.txt)
[ -n "$D" ] || exit 2
[ -e "$D/results.sage.tsv" ] && { echo "REFUSE: $D/results.sage.tsv exists"; exit 3; }
sha256sum $FASTAG_SAGE_BIN | grep -q '^d3820543a31bfa2a556e04f91719204ce0ac6f34dcca6670314a13df87064625 ' || { echo SAGE_MISMATCH; exit 4; }
MZ=$(python3 -c "import json,sys;c=json.load(open(sys.argv[1]));print(c['mzml_paths'][0]);print(c['database']['fasta'])" $D/sage.json)
sha256sum $(echo "$MZ") > $D/inputs.sha256
export RAYON_NUM_THREADS=$((SLURM_CPUS_PER_TASK/2))
cd $D
/usr/bin/time -v -o time.txt $FASTAG_SAGE_BIN -o $D $D/sage.json > sage.log 2>&1
echo "SAGE_RC=$?" | tee -a sage.log
