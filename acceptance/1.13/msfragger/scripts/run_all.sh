#!/usr/bin/env bash
# The held-out run: every run of <list> (TSV: run_id <tab> mzML path), sequentially, once; then scored once.
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
python3 "$S/../scorers/score_msfragger.py" --header > "$res/runs.tsv"
while IFS=$'\t' read -r run mz; do
  [ -n "$run" ] || continue
  python3 "$S/../scorers/score_msfragger.py" "$run" "$runs/$run" >> "$res/runs.tsv"
done < "$list"
python3 "$S/../scorers/verdict_msfragger.py" "$res/runs.tsv" "$(grep -c . "$list")" > "$res/verdict.tsv"
cat "$res/verdict.tsv"
