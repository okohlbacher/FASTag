#!/bin/bash
cd /scratch/kohlbach/ladder/memv190
echo "start $(date -u +%FT%TZ) load $(cat /proc/loadavg)" >> progress.log
SMAPS=1 bash mem_run.sh xcheck.plan res_xcheck
echo "xcheck done $(date -u +%FT%TZ)" >> progress.log
bash mem_run.sh main.plan res_main
echo "MAIN_DONE $(date -u +%FT%TZ) load $(cat /proc/loadavg)" >> progress.log
