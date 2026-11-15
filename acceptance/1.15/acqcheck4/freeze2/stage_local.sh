#!/bin/bash
# acqcheck4 staging restart: pride_get archive on node-local scratch (persistent Ceph copies skipped: abi quota full)
export PRIDE_ARCHIVE=/scratch/kohlbach/acc115/acqcheck4/pride-archive
exec bash /scratch/kohlbach/acc115/acqcheck4/heldout/stage.sh "$@"
