#!/usr/bin/env bash
# The held-out run: every run of <list> (TSV: run_id <tab> mzML path), sequentially, once; then scored once.
# After acceptance/1.13/msfragger2/scripts/run_all.sh; changed: the secondary arm g is scored by the same scorer and
# verdict script into runs_gapped.tsv / verdict_gapped.tsv (secondary, enters no criterion of the primary verdict).
# usage: run_all.sh <list.tsv> <runs dir> <results dir>      (results dir must not exist)
set -u
S=$(dirname "$(readlink -f "$0")")
list=$1; runs=$2; res=$3
[ -e "$res" ] && { echo "$res exists; scored once only" >&2; exit 9; }
mkdir -p "$runs"
while IFS=$'\t' read -r run mz; do
  [ -n "$run" ] || continue
  "$S/run_one.sh" "$run" "$mz" "$runs/$run" < /dev/null
done < "$list"
mkdir -p "$res"
n=$(grep -c . "$list")
for v in primary gapped; do
  t=$res/runs.tsv; [ $v = gapped ] && t=$res/runs_gapped.tsv
  python3 "$S/../scorers/score_msfragger.py" --header > "$t"
  while IFS=$'\t' read -r run mz; do
    [ -n "$run" ] || continue
    d=$runs/$run; [ $v = gapped ] && d=$runs/$run/g
    python3 "$S/../scorers/score_msfragger.py" "$run" "$d" >> "$t"
  done < "$list"
  python3 "$S/../scorers/verdict_msfragger.py" "$t" "$n" > "${t/runs/verdict}"
done
echo "== primary (-shortlist_exact_only)"; cat "$res/verdict.tsv"
echo "== secondary (gapped default)"; cat "$res/verdict_gapped.tsv"
