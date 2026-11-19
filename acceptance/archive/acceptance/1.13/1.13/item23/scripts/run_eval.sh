#!/usr/bin/env bash
# digqual (backlog 23) runs on node data: the frozen config CFG-23-digqual on
# every manifest row of one split, one run at a time.
#
#   run_eval.sh <manifest.tsv> <split> <FASTag binary> <digest dir> <runs dir>
#
# Refuses when the binary's sha256 is not the frozen one (FROZEN_SHA256, set by
# the caller from frozen-config.tsv) or when <runs dir>/<run_id> exists.
# Verifies each mzML's sha256 against the manifest before its run.
set -u
MAN=$1 SPLIT=$2 BIN=$3 DIGEST=$4 RUNS=$5
[ -n "${FROZEN_SHA256:-}" ] || { echo "FROZEN_SHA256 not set" >&2; exit 2; }
got=$(sha256sum "$BIN" | cut -d' ' -f1)
[ "$got" = "$FROZEN_SHA256" ] || { echo "binary sha256 $got is not the frozen $FROZEN_SHA256" >&2; exit 2; }
export FASTAG_DIGEST_DIR=$DIGEST
mkdir -p "$RUNS"
while IFS=$'\t' read -r run pxd mzml msha an split rest; do
  [ "$split" = "$SPLIT" ] || continue
  d=$RUNS/$run
  [ -e "$d" ] && { echo "refusing: $d exists" >&2; exit 2; }
  mkdir -p "$d"
  s=$(sha256sum "$mzml" | cut -d' ' -f1)
  [ "$s" = "$msha" ] || { echo "$run: mzML sha256 mismatch" | tee "$d/ERROR"; continue; }
  start=$(date -u +%FT%TZ)
  "$BIN" -in "$mzml" -tag_length 4 -threads 8 -subsample_fraction 0.25 \
    -fragment_tolerance 20.0 -fragment_tolerance_unit ppm \
    -out "$d/tags.tsv" -digest_out "$d/digest.tsv" -digest_quality Trypsin > "$d/run.log" 2>&1
  rc=$?
  echo -e "$run\t$rc\t$start\t$(date -u +%FT%TZ)" >> "$RUNS/times.tsv"
  rm -f "$d/tags.tsv"   # not needed by the scorer; keeps /scratch small
done < <(tail -n +2 "$MAN")
echo RUN_EVAL_DONE
