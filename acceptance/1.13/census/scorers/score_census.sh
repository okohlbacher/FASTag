#!/bin/bash
# FASTag 1.13 item 7 (#11 triage): score the held-out runs ONCE (PREREG-census.md).
#   score_census.sh <manifest census-triage.tsv> <run outdir root> <result dir>
# Run outdir per run: <root>/<PXD>/ as written by run_census_triage.sh. Checks the scorer's sha256 first.
set -eu
M=$1; R=$2; O=$3; H=$(cd "$(dirname "$0")" && pwd)
( cd "$H" && sha256sum -c SHA256SUMS ) || { echo "scorer hash mismatch"; exit 1; }
mkdir -p "$O"
labels=""
for arm in semi open; do
  printf 'run\tcensus\tsecond\tmzml\n' > "$O/runs_$arm.tsv"
done
tail -n +3 "$M" | while IFS=$'\t' read -r item split run pxd file rest; do
  for arm in semi open; do
    printf '%s\t%s\t%s\t%s\n' "$run" "$R/$run/fastag/tags.census.tsv" "$R/$run/$arm/results.sage.tsv" "${file%.*}.mzML" >> "$O/runs_$arm.tsv"
  done
done
labels=$(tail -n +2 "$O/runs_semi.tsv" | cut -f1 | paste -sd, -)
B="--baseline n_peaks --baseline n_edges --baseline n_peaks_kept --boot 10000 --seed 20261109 --q 0.01"
python3 "$H/census_triage_eval.py" "$O/runs_semi.tsv" --fdr subset $B --out "$O/primary_semi_subset.tsv"
python3 "$H/census_triage_eval.py" "$O/runs_semi.tsv" --fdr global $B --out "$O/secondary_semi_global.tsv"
python3 "$H/census_triage_eval.py" "$O/runs_open.tsv" --fdr subset $B --out "$O/secondary_open_subset.tsv"
python3 "$H/census_triage_eval.py" "$O/runs_open.tsv" --fdr global $B --out "$O/secondary_open_global.tsv"
python3 "$H/verdict_census.py" "$O/primary_semi_subset.tsv" "$labels" | tee "$O/verdict.txt"
