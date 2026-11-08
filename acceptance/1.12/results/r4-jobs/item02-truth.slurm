#!/bin/bash
# #2 truth amendment 2: Sage 0.14.7 with the round-3 configuration unchanged except mzml_paths, on a derived mzML
# without the MS2 spectra that carry no precursor m/z (scorers/drop_noprecursor_ms2.py). Array 1 = PXD033741,
# 2 = PXD076520. The dropped count and dropped-ID list must equal the PREREG values, else the task stops before Sage.
#SBATCH --partition=compute
#SBATCH --job-name=r4-i02truth
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=32
#SBATCH --mem=200gb
#SBATCH --time=08:00:00
#SBATCH --output=/pfs/10/project/bw26g016/fastag-1.12/r4/logs/%x-%A_%a.out
set -uo pipefail
. /pfs/10/project/bw26g016/fastag-1.12/r4/jobs/common.sh
check_scorers
case $SLURM_ARRAY_TASK_ID in
  1) P=PXD033741; N=3412; IDS=2b6f29ff0752ea001af515928b00539fca9dde95429a1db64263b32a796d366e ;;
  2) P=PXD076520; N=3513; IDS=0bfd393060e555bc0056d712681f2167691e11efc345414f5125a5835c703cef ;;
esac
ROW=$(awk -F'\t' -v p=$P '$1=="#2" && $4==p' $S/manifests/item02-H1-r2.tsv)
REL=$(cut -f10 <<<"$ROW"); SHA=$(cut -f11 <<<"$ROW"); RD=${REL%.*}
T=$R2/truth-r4/item02-H1-r2/$RD
[ -e $T/results.sage.tsv ] && { echo "EXISTS $T (not re-run)"; exit 4; }
mkdir -p $T; cd $T
echo "host $(hostname) job ${SLURM_ARRAY_JOB_ID}_${SLURM_ARRAY_TASK_ID} $P" > prep.log
got=$(sha256sum < $FT/heldout/$REL | cut -d' ' -f1)
[ "$got" = "$SHA" ] || { echo "INPUT_SHA_MISMATCH $got" | tee -a prep.log; exit 3; }
python3 -I $S/scorers/drop_noprecursor_ms2.py $FT/heldout/$REL $T/input.noprec.mzML --ids $T/dropped_ids.txt >> prep.log 2>&1 || exit 3
grep -q "dropped_ms2_without_precursor_mz $N;" prep.log || { echo "DROP_COUNT_MISMATCH" | tee -a prep.log; exit 3; }
echo "$IDS  dropped_ids.txt" | sha256sum -c - >> prep.log 2>&1 || { echo "DROP_IDS_MISMATCH" | tee -a prep.log; exit 3; }
# configuration: truth_config.py (unchanged) for item02-H1-r2, then only mzml_paths -> the derived file
python3 -I $S/scorers/truth_config.py $S/scorers/truth/item02.tsv $FT/heldout $FT/ceph/prose-auto-20261029/panel $T/cfg --manifest item02-H1-r2 >> prep.log 2>&1
python3 -I - $T/cfg/item02-H1-r2/$RD/sage.json $T/input.noprec.mzML $T/sage.json <<'PY' >> prep.log 2>&1
import json, sys
c = json.load(open(sys.argv[1])); old = c["mzml_paths"]; c["mzml_paths"] = [sys.argv[2]]
open(sys.argv[3], "w").write(json.dumps(c, indent=2) + "\n"); print("mzml_paths", old, "->", c["mzml_paths"])
PY
rm -rf $T/cfg
F=$(python3 -I -c "import json;print(json.load(open('sage.json'))['database']['fasta'])")
FS=$(awk -F'\t' -v r=$RD '$1=="item02-H1-r2" && $3==r {print $7}' $S/scorers/truth/item02.tsv)
echo "$FS  $F" | sha256sum -c - >> prep.log || { echo FASTA_SHA_MISMATCH | tee -a prep.log; exit 3; }
cmp <(python3 -I -c "import json,sys;c=json.load(open(sys.argv[1]));c.pop('mzml_paths');print(json.dumps(c,sort_keys=True))" $R2/truth/item02-H1-r2/$RD/sage.json) \
    <(python3 -I -c "import json,sys;c=json.load(open(sys.argv[1]));c.pop('mzml_paths');print(json.dumps(c,sort_keys=True))" $T/sage.json) \
  && echo "CONFIG_EQUALS_ROUND3 (except mzml_paths)" >> prep.log || { echo "CONFIG_DIFFERS" | tee -a prep.log; exit 3; }
sha256sum $FASTAG_SAGE_BIN sage.json input.noprec.mzML dropped_ids.txt > sage.sha256
export RAYON_NUM_THREADS=$SLURM_CPUS_PER_TASK
/usr/bin/time -v $FASTAG_SAGE_BIN --disable-telemetry-i-dont-want-to-improve-sage -o $T $T/sage.json > sage.log 2>&1
rc=$?; echo "SAGE_RC=$rc" >> sage.log; echo "SAGE_RC=$rc $P"
exit $rc
