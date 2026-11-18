#!/bin/bash
# Follow-up after bench.sh: PXD028735 with FASTag 1.14.0 (a) the original command (no -acquisition_check;
# default refuse) x3, (b) -acquisition_check off x3 (warm-up first). Same harness function as bench.sh.
set -u
W=/scratch/kohlbach/site-why-1.14.0
eval "$(sed -n '/^W=/,/^}/p' $W/bench.sh)"     # reuse variables and run() of bench.sh unchanged
while [ ! -f $W/DONE ]; do sleep 30; done   # start only after the first script has finished
mkdir -p $W/runs $W/acc
echo "followup start $(date -u +%FT%TZ)" >> $W/STATUS
sha256sum $D28 > $W/inputs_PXD028735.sha256    # verifies the input, warms the page cache
for rep in 1 2 3; do run fastag PXD028735default $D28 $rep; done
run fastag PXD028735off $D28 0 -acquisition_check off
for rep in 1 2 3; do run fastag PXD028735off $D28 $rep -acquisition_check off; done
echo "followup DONE $(date -u +%FT%TZ)" >> $W/STATUS
touch $W/DONE2
