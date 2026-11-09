#!/usr/bin/env bash
cd /scratch/kohlbach/b113/shifts
S=acc/item17/scripts/run_item17.sh
( bash $S heldout PXD000001 ho 16 > ho/PXD000001.log 2>&1; echo "exit $?" >> ho/PXD000001.log ) &
( bash $S heldout PXD004541 ho 16 > ho/PXD004541.log 2>&1; echo "exit $?" >> ho/PXD004541.log ) &
wait
( bash $S heldout PXD014764 ho 16 > ho/PXD014764.log 2>&1; echo "exit $?" >> ho/PXD014764.log ) &
( bash $S heldout PXD063151 ho 16 > ho/PXD063151.log 2>&1; echo "exit $?" >> ho/PXD063151.log ) &
wait
echo "DRIVER_DONE $(date -Is)" > ho/DONE
