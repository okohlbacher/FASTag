#!/bin/bash
# FASTag RC a117801, both frozen arms, on the 6 H1 runs of item15B-sets-r2. One run per file and arm (cell RC).
set -u
. "$(dirname "$0")/common.sh"; check_bins
run() { local cfg=$1 rel=$2; shift 2
  local d=$R/runs/$cfg/$M/$rel/RC
  [ -e $d/run.log ] && { echo "EXISTS $d (not re-run)"; return 0; }
  mkdir -p $d; cd $d
  echo "START $(date -u +%FT%TZ) $cfg $rel" >> $R/h1/times.log
  $RCBIN -in $S/$rel.mzML -out tags.tsv -threads 12 "$@" > run.log 2>&1; rc=$?
  echo "FASTAG_RC=$rc" >> run.log
  echo "END $(date -u +%FT%TZ) $cfg $rel FASTAG_RC=$rc" >> $R/h1/times.log; }
export -f run; export R S M RCBIN
for x in $RUNS; do rel=${x%%:*}; echo "CFG-15B-base $rel"; echo "CFG-15B-cand $rel -ion_series auto"; done |
  xargs -P 4 -L 1 bash -c 'run "$@"' _
echo "FASTAG_DONE $(date -u +%FT%TZ)" >> $R/h1/times.log
