#!/usr/bin/env bash
# The held-out run: every run of <list> (TSV: run_id <tab> mzML path), sequentially, once; then scored once.
# After acceptance/1.13/msfragger2/scripts/run_all.sh; scorer and verdict of this test (score_msfcalib.py,
# verdict_msfcalib.py). usage: run_all.sh <list.tsv> <runs dir> <results dir>   (results dir must not exist)
set -u
S=$(dirname "$(readlink -f "$0")")
list=$1; runs=$2; res=$3
[ -e "$res" ] && { echo "$res exists; scored once only" >&2; exit 9; }
mkdir -p "$runs"
while IFS=$'\t' read -r run mz; do
  [ -n "$run" ] || continue
  "$S/run_one.sh" "$run" "$mz" "$runs/$run" < /dev/null
  echo "$run $(date -u +%FT%TZ)" >> "$runs/progress"
done < "$list"
mkdir -p "$res"
python3 "$S/../scorers/score_msfcalib.py" --header > "$res/runs.tsv"
while IFS=$'\t' read -r run mz; do
  [ -n "$run" ] || continue
  python3 "$S/../scorers/score_msfcalib.py" "$run" "$runs/$run" >> "$res/runs.tsv"
done < "$list"
python3 "$S/../scorers/verdict_msfcalib.py" "$res/runs.tsv" "$(grep -c . "$list")" > "$res/verdict.tsv"
cat "$res/verdict.tsv"
