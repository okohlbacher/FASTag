#!/bin/bash
# FASTag 1.13 item 7 (#11 triage), second held-out test: score the held-out runs ONCE (PREREG-census-2.md).
#   score_census.sh <staged manifest census-triage-2.staged.tsv> <run outdir root> <result dir>
# Run outdir per run: <root>/<run>/ as written by run_census_triage.sh. Checks the scorers' sha256 first.
# Drawn runs = every manifest row. Scored runs = rows with use = run that are not named in
# <result dir>/excluded_runs.tsv (run<TAB>reason; written under the PREREG's technical-failure rule before scoring).
# A run to be scored whose outputs are missing stops the script before anything is scored.
# Refuses to run when <result dir>/verdict.txt exists (scored once).
set -eu
export LC_ALL=C LANG=C
M=$1; R=$2; O=$3; H=$(cd "$(dirname "$0")" && pwd)
( cd "$H" && sha256sum -c SHA256SUMS ) || { echo "scorer hash mismatch"; exit 1; }
mkdir -p "$O"
[ ! -e "$O/verdict.txt" ] || { echo "already scored: $O/verdict.txt exists"; exit 1; }
X="$O/excluded_runs.tsv"
for arm in semi open; do printf 'run\tcensus\tsecond\tmzml\n' > "$O/runs_$arm.tsv"; done
: > "$O/drawn.txt"
c() { head -2 "$M" | tail -1 | tr '\t' '\n' | grep -n -x "$1" | cut -d: -f1; }
CR=$(c run); CU=$(c use); CF=$(c fastag_input)
[ -n "$CR" ] && [ -n "$CU" ] && [ -n "$CF" ] || { echo "manifest columns missing"; exit 1; }
while IFS=$'\t' read -r -a f; do
  run=${f[$((CR-1))]}; use=${f[$((CU-1))]}; mz=$(basename "${f[$((CF-1))]}")
  echo "$run" >> "$O/drawn.txt"
  if [ "$use" != run ]; then echo "not scored (manifest): $run $use"; continue; fi
  if [ -s "$X" ] && cut -f1 "$X" | grep -q -x -F "$run"; then echo "not scored (excluded_runs.tsv): $run"; continue; fi
  for p in "$R/$run/fastag/tags.census.tsv" "$R/$run/semi/results.sage.tsv" "$R/$run/open/results.sage.tsv"; do
    [ -s "$p" ] || { echo "missing $p: exclude $run under the PREREG rule first"; exit 1; }
  done
  for arm in semi open; do
    printf '%s\t%s\t%s\t%s\n' "$run" "$R/$run/fastag/tags.census.tsv" "$R/$run/$arm/results.sage.tsv" "$mz" >> "$O/runs_$arm.tsv"
  done
done < <(tail -n +3 "$M")
drawn=$(paste -sd, "$O/drawn.txt")
scored=$(tail -n +2 "$O/runs_semi.tsv" | cut -f1 | paste -sd, -)
if [ -z "$scored" ]; then
  { echo "E0 evaluable 0 of $(wc -l < "$O/drawn.txt") drawn; no run scored"; echo "VERDICT INCONCLUSIVE"; } | tee "$O/verdict.txt"
  exit 0
fi
B="--baseline n_peaks --baseline n_edges --baseline n_peaks_kept --boot 10000 --seed 20261109 --q 0.01"
python3 "$H/census_triage_eval.py" "$O/runs_semi.tsv" --fdr subset $B --out "$O/primary_semi_subset.tsv"
python3 "$H/verdict_census2.py" "$O/primary_semi_subset.tsv" "$scored" "$drawn" 6 > "$O/verdict.tmp"
mv "$O/verdict.tmp" "$O/verdict.txt"; cat "$O/verdict.txt"
# reported without a verdict; a failure here does not change the verdict
python3 "$H/census_triage_eval.py" "$O/runs_semi.tsv" --fdr global $B --out "$O/secondary_semi_global.tsv" || echo "SECONDARY_FAILED semi global"
python3 "$H/census_triage_eval.py" "$O/runs_open.tsv" --fdr subset $B --out "$O/secondary_open_subset.tsv" || echo "SECONDARY_FAILED open subset"
python3 "$H/census_triage_eval.py" "$O/runs_open.tsv" --fdr global $B --out "$O/secondary_open_global.tsv" || echo "SECONDARY_FAILED open global"
echo SCORE_DONE
