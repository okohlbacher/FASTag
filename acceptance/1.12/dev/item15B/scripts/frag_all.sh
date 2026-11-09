#!/bin/bash
cd /scratch/kohlbach/fastag-15b-dev
for f in PXD060724/*.mzML; do s=$(basename $f .mzML); echo "cz $s"; echo "hybrid $s"; done | xargs -P 3 -L 1 bash scripts/frag.sh
echo DONE $(date -Is) > truth/FRAGGER_DONE
