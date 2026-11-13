#!/bin/bash
# score_once.sh <manifest.tsv> <out dir> <results dir> : score once; refuses if a verdict exists or the scorers changed.
set -eu
S=$(cd "$(dirname "$0")" && pwd); PY=${PY:-python3}
( cd "$S" && sha256sum -c SHA256SUMS > /dev/null ) || { echo "REFUSED: scorer differs from SHA256SUMS"; exit 3; }
[ -e "$3/verdict.tsv" ] && { echo "REFUSED: $3/verdict.tsv exists (score once)"; exit 3; }
for r in $(awk -F'\t' '$10 ~ /^in_test/ {print $1}' "$1"); do [ -e "$2/$r/RUN_DONE" ] || { echo "REFUSED: run $r not finished"; exit 3; }; done
mkdir -p "$3"
$PY "$S/score.py" "$1" "$2" > "$3/scores.tsv"
$PY "$S/verdict.py" "$3/scores.tsv" > "$3/verdict.tsv"
cat "$3/verdict.tsv"
