#!/usr/bin/env bash
# FASTag 1.13 #17r: the single held-out run, node data. 4 runs x 16 threads. Scripts = copy of acceptance/1.13 at the
# freeze commit under /scratch/kohlbach/b113/shifts/heldout/acc. Scoring runs once, after all four runs ended.
cd /scratch/kohlbach/b113/shifts/heldout
S=acc/item17r/scripts
mkdir -p ho
for P in PXD049248 PXD065251 PXD037999 PXD073763; do
  ( bash $S/run_item17r.sh $P "$PWD/ho" 16 > ho/$P.log 2>&1; echo "exit $?" >> ho/$P.log ) &
done
wait
if [ "$(cat ho/PXD*.log | grep -c '^exit 0$')" = 4 ]; then
  python3 -I $S/score_item17r.py ho/score acc/item17r/sage_expressible.tsv ho/PXD049248/searches.tsv \
    ho/PXD065251/searches.tsv ho/PXD037999/searches.tsv ho/PXD073763/searches.tsv > ho/score.log 2>&1
  echo "score exit $?" >> ho/score.log
fi
echo "DRIVER_DONE $(date -Is)" > ho/DONE
