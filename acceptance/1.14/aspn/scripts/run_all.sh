#!/bin/bash
# run_all.sh <manifest.tsv> : every run in the test, one after the other (12 threads), then RUN_ALL_DONE.
H=${ASPN_HELDOUT:-/scratch/kohlbach/acc114/aspn/heldout}
for r in $(awk -F'\t' '$10 ~ /^in_test/ {print $1}' "$1"); do bash $H/frozen/aspn/scripts/run.sh "$1" "$r" >> $H/run_all.log 2>&1; done
touch $H/RUN_ALL_DONE
