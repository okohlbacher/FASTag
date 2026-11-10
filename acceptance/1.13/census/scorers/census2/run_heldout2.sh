#!/bin/bash
# FASTag 1.13 item 7 (#11 triage), second held-out test: the held-out runs of CFG-census-triage2-113.
#   run_heldout2.sh <staged manifest> <H = work dir>     (node data; up to 4 runs at a time, 8 threads each)
# Per manifest row with use = run: run_census_triage.sh <H>/raw/<fastag_input> <H>/runs/<run> 8.
# PREREG rule for a technical failure: a run whose log does not end with RUN_DONE is moved to
# <H>/runs/<run>.failed1 and started once more from scratch with the same command; a second failure leaves
# <H>/runs/<run>.FAILED (the run is then excluded and counts as not evaluable).
set -u
M=$1; H=$2; S=$(cd "$(dirname "$0")" && pwd)
export CENSUS_ROOT=$H
mkdir -p "$H/runs"
one() {
  run=$1; mz=$2; out=$H/runs/$run
  echo "RUN $run $(date -Is)"
  bash "$S/run_census_triage.sh" "$H/raw/$mz" "$out" 8 > "$H/runs/$run.log" 2>&1
  if [ "$(tail -n 1 "$H/runs/$run.log")" != RUN_DONE ]; then
    echo "RETRY $run $(date -Is): $(grep -m1 '^FAIL' "$H/runs/$run.log")"
    mv "$out" "$out.failed1"; mv "$H/runs/$run.log" "$H/runs/$run.failed1.log"
    bash "$S/run_census_triage.sh" "$H/raw/$mz" "$out" 8 > "$H/runs/$run.log" 2>&1
    if [ "$(tail -n 1 "$H/runs/$run.log")" != RUN_DONE ]; then
      echo "FAILED_TWICE $run $(date -Is): $(grep -m1 '^FAIL' "$H/runs/$run.log")"; touch "$out.FAILED"; return
    fi
  fi
  echo "RUN_DONE $run $(date -Is)"
}
c() { head -2 "$M" | tail -1 | tr '\t' '\n' | grep -n -x "$1" | cut -d: -f1; }
CR=$(c run); CU=$(c use); CF=$(c fastag_input)
n=0
while IFS=$'\t' read -r -a f; do
  [ "${f[$((CU-1))]}" = run ] || continue
  one "${f[$((CR-1))]}" "${f[$((CF-1))]}" &
  n=$((n+1)); [ $((n % 4)) -ne 0 ] || wait
done < <(tail -n +3 "$M")
wait
echo HELDOUT_RUNS_DONE
