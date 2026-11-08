#!/bin/bash
# Run every plan in plans/ in order; results in res_v190/, copied to Ceph after each plan.
cd /scratch/kohlbach/ladder
export GATE=${GATE:-0.05}
CEPH=/ceph/ibmi/abi/oliver/jpr-bench/ladder-v190
mkdir -p res_v190 "$CEPH"
for p in ${PLANS:-plans}/*.plan; do
  echo "start $p $(date -u +%FT%TZ) load $(cat /proc/loadavg)" >> res_v190/progress.log
  bash ladder_run.sh "$p" res_v190
  cp res_v190/raw.tsv "$CEPH/raw.tsv"; cp -r res_v190/logs "$CEPH/" 2>/dev/null
  echo "end $p $(date -u +%FT%TZ) load $(cat /proc/loadavg)" >> res_v190/progress.log
done
cp res_v190/progress.log "$CEPH/"
