#!/bin/bash
cd /scratch/kohlbach/ladder/memv190
echo "fix start $(date -u +%FT%TZ) load $(cat /proc/loadavg)" >> progress.log
bash mem_run.sh fix.plan res_fix
echo "fix done $(date -u +%FT%TZ)" >> progress.log
INTERVAL=0.005 bash mem_run.sh ivcheck.plan res_ivcheck
echo "FIX_ALL_DONE $(date -u +%FT%TZ) load $(cat /proc/loadavg)" >> progress.log
