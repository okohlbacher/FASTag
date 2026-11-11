#!/bin/bash
cd /scratch/kohlbach/b113/compltol/heldout2
kill 401545 401546 401553 401555 401558
sleep 1
kill 401597 402455 402449 402453 402447
sleep 2
NPAR=10 bash accel.sh PXD069807 20250622_DDA_400ng_Tube80_ISS_WT83_Plate1_RowF_Column7.raw > accel.a1.log 2>&1 &
NPAR=10 bash accel.sh PXD069807 20250622_DDA_400ng_Tube27_Ground_QX_Plate2_RowE_Column9.raw > accel.a2.log 2>&1 &
NPAR=4 bash accel.sh PXD076370 MS221730-KS.raw > accel.q2.log 2>&1 &
NPAR=4 bash accel.sh PXD075574 CB-6644_3.raw > accel.q4.log 2>&1 &
NPAR=4 bash accel.sh PXD078303 NW_N1.raw > accel.q5.log 2>&1 &
wait
echo ACCEL_DONE > accel_all.done
