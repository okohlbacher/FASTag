#!/bin/bash
H=/scratch/kohlbach/b113/nontryptic/heldout
awk -F"\t" "\$11 ~ /^in_test/ {print \$1}" $H/manifest.tsv | xargs -P 5 -I{} bash $H/frozen/nontryptic/scripts/run.sh $H/manifest.tsv {}
touch $H/RUN_ALL_DONE
