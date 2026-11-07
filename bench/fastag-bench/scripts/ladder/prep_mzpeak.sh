#!/bin/bash
# mzML -> point and chunked mzPeak with mzpeak-convert 0.18.0 (untimed preparation)
set -u
C=/ceph/ibmi/abi/oliver/opt/mzpeak-convert/0.18.0/mzpeak-convert
cd /scratch/kohlbach/ladder/in
for m in "$@"; do
  b=${m%.mzML}
  for L in point chunked; do
    [ -s $b.$L.mzpeak ] && continue
    s=$(date +%s); $C --layout $L -o $b.$L.mzpeak $m > $b.$L.convert.log 2>&1; rc=$?
    echo -e "$m\t$L\t$rc\t$(( $(date +%s)-s ))s\t$($C --version)" >> convert.tsv
  done
done
