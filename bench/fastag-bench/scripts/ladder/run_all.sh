#!/bin/bash
# Run every plan in plans/ in order; results in res/, copied to Ceph after each plan.
cd /scratch/kohlbach/ladder
export GATE=${GATE:-0.05}
CEPH=/ceph/ibmi/abi/oliver/jpr-bench/ladder
mkdir -p res "$CEPH"
for p in ${PLANS:-plans}/*.plan; do
  echo "start $p $(date -u +%FT%TZ) load $(cat /proc/loadavg)" >> res/progress.log
  bash ladder_run.sh "$p" res
  cp res/raw.tsv "$CEPH/raw.tsv"; cp -r res/logs "$CEPH/" 2>/dev/null
  echo "end $p $(date -u +%FT%TZ) load $(cat /proc/loadavg)" >> res/progress.log
done
cp res/progress.log "$CEPH/"
