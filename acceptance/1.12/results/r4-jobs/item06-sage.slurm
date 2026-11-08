#!/bin/bash
# #6 truth (mode charge_truth on the stripped copy), truth_config.py unchanged, rows item06-H2 / item06-H2r
#SBATCH --partition=compute
#SBATCH --job-name=r4-i06sage
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=32
#SBATCH --mem=200gb
#SBATCH --time=12:00:00
#SBATCH --output=/pfs/10/project/bw26g016/fastag-1.12/r4/logs/%x-%A_%a.out
set -uo pipefail
. /pfs/10/project/bw26g016/fastag-1.12/r4/jobs/common.sh
check_scorers
E=${I6[$((SLURM_ARRAY_TASK_ID-1))]}; MAN=${E%%	*}
R=$(row6 "$E"); REL=$(cut -f10 <<<"$R"); RD=${REL%.*}; T=$FT/truth/$MAN/$RD
[ -e $T/results.sage.tsv ] && { echo "EXISTS $T"; exit 4; }
python3 -I $S/scorers/truth_config.py $S/scorers/truth/item02.tsv $FT/heldout $FT/ceph/prose-auto-20261029/panel $T/cfg --manifest $MAN --mode charge_truth > $T/config.log 2>&1
python3 -I - $T/cfg/$MAN/$RD/sage.json $T/input.nocharge.mzML $T/sage.json <<'PY' >> $T/config.log 2>&1
import json, sys   # truth_config's charge_truth path is <out>/<manifest>/<run>/input.nocharge.mzML; point it at $T
c = json.load(open(sys.argv[1])); c["mzml_paths"] = [sys.argv[2]]; open(sys.argv[3], "w").write(json.dumps(c, indent=2) + "\n")
PY
rm -rf $T/cfg; cd $T
F=$(python3 -I -c "import json;print(json.load(open('sage.json'))['database']['fasta'])")
FS=$(awk -F'\t' -v m=$MAN -v r=$RD '$1==m && $3==r {print $7}' $S/scorers/truth/item02.tsv)
echo "$FS  $F" | sha256sum -c - >> config.log || { echo FASTA_SHA_MISMATCH; exit 3; }
sha256sum $FASTAG_SAGE_BIN sage.json input.nocharge.mzML > sage.sha256
export RAYON_NUM_THREADS=$SLURM_CPUS_PER_TASK
/usr/bin/time -v $FASTAG_SAGE_BIN --disable-telemetry-i-dont-want-to-improve-sage -o $T $T/sage.json > sage.log 2>&1
rc=$?; echo "SAGE_RC=$rc" >> sage.log; echo "SAGE_RC=$rc $RD"; exit $rc
