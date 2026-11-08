#!/bin/sh
# P5b taxonomy benchmark: FASTag 1.11.0 (= CLI on main), 48 paper runs x 4 arms, per index.
S=/scratch/kohlbach/fastag-taxred/setB; R=/scratch/kohlbach/fastag-p5b
E=/ceph/ibmi/abi/oliver/jpr-bench/envs/species/bin
F=/ceph/ibmi/abi/oliver/opt/fastag-1.11.0/FASTag/FASTag
export OPENMS_TMPDIR=/dev/shm/kohlbach-tmp-p5b; mkdir -p $OPENMS_TMPDIR
cd $S/fastag-bench
for cfg in SHIP B Bnw S50; do
  unset FASTAG_TAXONOMY_DIR
  [ "$cfg" != SHIP ] && export FASTAG_TAXONOMY_DIR=$S/idx/$cfg/share-FASTag-taxonomy
  echo "cfg=$cfg FASTAG_TAXONOMY_DIR=[$FASTAG_TAXONOMY_DIR] start $(date -Is) load $(cut -d" " -f1-3 /proc/loadavg)"
  PYTHONPATH=src $E/python -m fastag_bench.cli species-run --work $R/runs_$cfg --fastag $F --steps fastag \
    --arms default,deconv,gapped,all --threads 48 --jobs 2 --scratch $S/in > $R/logs/run_$cfg.log 2>&1
  echo "cfg=$cfg rc=$? done $(date -Is) load $(cut -d" " -f1-3 /proc/loadavg)"
done
echo ALL_DONE
