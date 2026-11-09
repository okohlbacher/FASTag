#!/bin/bash
# The single scoring of CFG-15B-base / CFG-15B-cand on H1 (PREREG-item15B.md amendment 1). Refuses if the output exists
# or if any H1 search lacks FRAGGER_RC=0 or any run lacks a run.log.
set -u
. "$(dirname "$0")/common.sh"
O=$R/h1/score-H1
[ -e $O ] && { echo "RESULT_EXISTS $O (not re-scored)"; exit 4; }
for x in $RUNS; do rel=${x%%:*}; set=${x##*:}
  for s in $( [ $set = set7 ] && echo by cz || echo cz ); do
    grep -q '^FRAGGER_RC=0$' $R/truth/$M/$rel/fragger_$s.log 2>/dev/null || { echo "TRUTH_NOT_READY $rel $s"; exit 5; }; done
  for c in CFG-15B-base CFG-15B-cand; do [ -e $R/runs/$c/$M/$rel/RC/run.log ] || { echo "RUN_MISSING $c $rel"; exit 6; }; done
done
mkdir -p $O; cd $SRC/acceptance/1.12
sha256sum scorers/score_item15B.py scorers/acclib.py manifests/$M.tsv ../../bench/fastag-bench/src/fastag_bench/score.py ../../bench/fastag-bench/src/fastag_bench/parsers.py > $O/scorer.sha256
echo "SCORE_START $(date -u +%FT%TZ)" >> $R/h1/times.log
$PY scorers/score_item15B.py . H1 $S $R/runs $R/truth $O > $O/score.txt 2>&1; rc=$?
echo "SCORE_RC=$rc" >> $O/score.txt; echo "SCORE_END $(date -u +%FT%TZ) rc=$rc" >> $R/h1/times.log; cat $O/score.txt
