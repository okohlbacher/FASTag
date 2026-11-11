#!/bin/bash
# finish the two Astral downloads: accel.sh again for the parts that gave up (complete parts are kept)
cd /scratch/kohlbach/b113/compltol/heldout2
one() {
  while pgrep -u kohlbach -f "accel.sh PXD069807 $1" > /dev/null; do sleep 5; done
  for t in 1 2 3 4 5 6; do
    [ -e "qual/PXD069807__${1%.raw}.done" ] && return 0
    NPAR=8 bash accel.sh PXD069807 "$1" >> "accel.retry.${1%.raw}.log" 2>&1
  done
}
one 20250622_DDA_400ng_Tube80_ISS_WT83_Plate1_RowF_Column7.raw &
one 20250622_DDA_400ng_Tube27_Ground_QX_Plate2_RowE_Column9.raw &
wait
echo RETRY_DONE > accel_retry.done
