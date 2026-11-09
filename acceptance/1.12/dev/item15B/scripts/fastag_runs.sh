#!/bin/bash
# E15B-04 DEV: FASTag RC a117801 on the PXD060724 DEV mzMLs, arms base (RC defaults), cand (-ion_series auto),
# DEV-cz (-ion_series cz). DEV only.
set -u
B=/scratch/kohlbach/fastag-15b-dev; RC=/scratch/kohlbach/fastag-heldout-1.12/rc-a117801/opt/FASTag; M=dev15B-PXD060724
mkdir -p $B/staged/dev/PXD060724
for f in $B/PXD060724/*.mzML; do ln -sf $f $B/staged/dev/PXD060724/; done
run() { local cfg=$1 stem=$2; shift 2
  local d=$B/runs/$cfg/$M/dev/PXD060724/$stem/RC; mkdir -p $d
  [ -f $d/run.log ] && grep -q '^FASTAG_RC=0' $d/run.log && return 0
  ( cd $d && $RC -in $B/staged/dev/PXD060724/$stem.mzML -out tags.tsv -threads 12 "$@" > run.log 2>&1; echo "FASTAG_RC=$?" >> run.log ) }
export -f run; export B RC M
for f in $B/PXD060724/*.mzML; do s=$(basename $f .mzML)
  echo "CFG-15B-base $s"; echo "CFG-15B-cand $s -ion_series auto"; echo "DEV-15B-cz $s -ion_series cz"; done |
  xargs -P 4 -L 1 bash -c 'run "$@"' _
echo DONE > $B/runs/FASTAG_DONE
