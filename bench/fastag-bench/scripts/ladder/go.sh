#!/bin/bash
cd /scratch/kohlbach/ladder; echo $$ > OWNER.lock/pid
PLANS=plans_resume GATE=0.25 GATE_MAX_WAIT=86400 bash run_all.sh
echo LADDER_DONE $(date -u +%FT%TZ) >> res/progress.log
