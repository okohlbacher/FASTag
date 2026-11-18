#!/bin/bash
# Accuracy of FASTag 1.15.0 (release linux-x64) on ibminode05.
#  1. PXD000001 against its deposited Mascot search (2,254 PSMs at 1% FDR), scored by
#     tools/pxd000001_truth.py: DirecTag-matched settings, FASTag defaults, and defaults with the
#     sample's fixed modifications.
#  2. PXD000001, PXD054073 (timsTOF Pro ddaPASEF) and PXD076528 (Orbitrap Astral) against Sage 0.14.7
#     at 1% PSM FDR with the fastag-bench accuracy harness (profiles fastag_default, fastag_matched).
# Usage: run.sh <repo checkout>   (outputs under /scratch/kohlbach/rsw-bench/acc)
set -eu
REPO=$1
W=/scratch/kohlbach/rsw-bench/acc
FT=/scratch/kohlbach/rsw-bench/opt/FASTag/FASTag
PY=/ceph/ibmi/abi/oliver/jpr-bench/envs/py/bin/python
D=/scratch/kohlbach/jpr-acc/data/PXD000001
MZML=$D/TMT_Erwinia_1uLSike_Top10HCD_isol2_45stepped_60min_01-20141210.mzML
DAT=$D/F063721.dat
export OPENMS_TMPDIR=/dev/shm/kohlbach-tmp OPENBLAS_NUM_THREADS=1 OPENMS_DISABLE_UPDATE_CHECK=ON LC_ALL=C
mkdir -p $W/pxd000001 $W/work/runs $W/results $OPENMS_TMPDIR
echo "start $(date -u +%FT%TZ) load $(cut -d' ' -f1-3 /proc/loadavg)" > $W/STATUS
"$FT" -help </dev/null 2>&1 | grep -m1 '^Version' > $W/fastag-version.txt || true
sha256sum $MZML $DAT > $W/pxd000001/inputs.sha256

# 1. PXD000001, repository scorer
MATCHED=(-tag_length 3 -max_tags 50 -max_peaks 100 -peaks_per_window 0 -gaps 0 -no_deisotope
         -fragment_tolerance 0.02 -fragment_tolerance_unit Da -fixed_modifications "")
SAMPLE=(-fixed_modifications "Methylthio (C)" "TMT6plex (K)" "TMT6plex (N-term)")
for prof in matched default default_samplemods; do
  case $prof in
    matched) A=("${MATCHED[@]}");;
    default) A=();;
    default_samplemods) A=("${SAMPLE[@]}");;
  esac
  o=$W/pxd000001/$prof; mkdir -p $o
  printf '%q ' "$FT" -in "$MZML" -out $o/tags.tsv -threads 32 "${A[@]}" > $o/command.txt; echo >> $o/command.txt
  "$FT" -in "$MZML" -out $o/tags.tsv -threads 32 "${A[@]}" > $o/run.log 2>&1
  echo -e "$(sha256sum $o/tags.tsv | cut -d' ' -f1)\t$(( $(grep -c . $o/tags.tsv) - 1 ))" > $o/tags.sha256_rows
  python3 -I $REPO/tools/pxd000001_truth.py --dat $DAT --tsv $o/tags.tsv --no-assert > $o/score.txt
done

# 2. Sage truth, fastag-bench harness (Sage runs copied, not re-run)
for ds in PXD000001_Erwinia_TMT6 PXD054073_HeLa_ddaPASEF_R02 PXD076528_Astral_7673; do
  mkdir -p $W/work/runs/$ds/sage
  [ -d $W/work/runs/$ds/sage/default ] || cp -a /scratch/kohlbach/jpr-acc-v190/work/runs/$ds/sage/default $W/work/runs/$ds/sage/
done
sha256sum $W/work/runs/*/sage/default/results.sage.tsv > $W/sage-truth.sha256
cd $W
for ds in PXD000001 PXD054073 PXD076528; do
  PYTHONPATH=$REPO/bench/fastag-bench/src $PY -m fastag_bench.cli accuracy \
    -c $REPO/bench/results/accuracy-1.15.0/accuracy-ibminode05-v1150.yaml \
    -d $REPO/bench/fastag-bench/datasets.yaml --dataset $ds --steps run,score
done
PYTHONPATH=$REPO/bench/fastag-bench/src $PY -m fastag_bench.cli accuracy \
  -c $REPO/bench/results/accuracy-1.15.0/accuracy-ibminode05-v1150.yaml \
  -d $REPO/bench/fastag-bench/datasets.yaml --dataset PXD000001 --steps collect || true
echo "DONE $(date -u +%FT%TZ)" >> $W/STATUS
touch $W/DONE
