#!/bin/bash
# job V190: tag-accuracy family (Figure 3) re-run with FASTag 1.9.0 on ibminode05.
# Same protocol as jobA/B/C2/F (1.8.0); only the FASTag binary changes. Comparator outputs
# (Sage, Comet, DirecTag) are copied from the 1.8.0 work dir and not re-run.
B=/ceph/ibmi/abi/oliver/jpr-bench; A=$B/accuracy; H=$A/fastag-bench-v190
PY=$B/envs/py/bin/python; export PYTHONPATH=$H/src
FB="$PY -m fastag_bench.cli"
C="-c $H/config/accuracy-ibminode05-v190.yaml -d $H/datasets.yaml"
export OPENMS_TMPDIR=/dev/shm/kohlbach-tmp; mkdir -p $OPENMS_TMPDIR
OLD=/scratch/kohlbach/jpr-acc/work; W=/scratch/kohlbach/jpr-acc-v190; NEW=$W/work
echo "start $(date -Is) host $(hostname) load $(cut -d' ' -f1-3 /proc/loadavg)"
/ceph/ibmi/abi/oliver/opt/fastag-1.9.0/FASTag/FASTag --help 2>&1 | grep -m1 Version
sha256sum /ceph/ibmi/abi/oliver/opt/fastag-1.9.0/FASTag/FASTag
mkdir -p $NEW/runs $A/results-v190
if [ ! -e $NEW/.seeded ]; then
  for d in $OLD/runs/*; do
    ds=$(basename $d); mkdir -p $NEW/runs/$ds
    for t in sage comet directag; do [ -d $d/$t ] && cp -a $d/$t $NEW/runs/$ds/; done
  done
  cp -a $OLD/directag_cache $NEW/
  # comparator rows of the 1.8.0 timing log (out_dir still names the 1.8.0 dirs they were run in)
  awk -F'\t' 'NR==1 || $3!="fastag"' $OLD/timing.tsv > $NEW/timing.tsv
  touch $NEW/.seeded
fi
cd $W
sha256sum /scratch/kohlbach/jpr-acc/data/PXD000001/*.mzML /scratch/kohlbach/jpr-acc/data/PXD003531/*.mzML
FT=""; for L in 4 5 6 7 8; do FT="$FT,fastag_matched_tl$L"; done; FT=${FT#,}
ALL="fastag_default,fastag_matched,directag_default,directag_matched,$FT,directag_matched_tl4,directag_matched_tl5,directag_matched_tl6"
for d in PXD000001 PXD003531 PXD001819 PXD076528 PXD054073; do
  $FB accuracy $C --dataset $d --steps run --profiles fastag_default,fastag_matched,$FT
  $FB accuracy $C --dataset $d --steps score --profiles $ALL
done
for d in PXD003531 PXD001819; do $FB accuracy $C --dataset $d --steps overlap; done
$FB accuracy $C --dataset PXD003531 --steps collect
echo "ACCURACY_DONE $(date -Is) load $(cut -d' ' -f1-3 /proc/loadavg)"
# timing gate for the sweeps: 1-min load below 0.25 x 128 logical CPUs
until awk '{exit !($1 < 32)}' /proc/loadavg; do sleep 30; done
echo "sweeps start $(date -Is) load $(cut -d' ' -f1-3 /proc/loadavg)"
$FB accuracy $C --dataset PXD000001 --steps gap_penalty,peak_budget
$FB accuracy $C --dataset PXD003531 --steps collect
echo "JOB_V190_DONE $(date -Is) load $(cut -d' ' -f1-3 /proc/loadavg)"
