#!/bin/bash
H=/scratch/kohlbach/b113/nontryptic/heldout
cd $H/stage2
ls R*.list.tsv | sed "s/.list.tsv//" | xargs -P 9 -I{} bash -c "bash $H/frozen/nontryptic/scripts/stage.sh $H/stage2/{}.list.tsv $H/stage2/{}.out.tsv > $H/stage2/{}.log 2>&1"
touch $H/STAGE2_DONE
