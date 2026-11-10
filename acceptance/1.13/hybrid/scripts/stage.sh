#!/bin/bash
# Hybrid arm: stage and qualify the candidate runs of one project. No FASTag run.
#   stage.sh <candidates.tsv> <project>
# https download from the PRIDE FTP mirror (resumed tries; size checked, PRIDE SHA-1 checked where PRIDE gives one),
# ThermoRawFileParser -f 2, then scripts/truth.sh (activation table, Sage truth, qualification.tsv).
# Writes $ROOT/<project>/<stem>/stage.tsv and $ROOT/<project>/stage.done.
set -u
ROOT=${HYB_HELDOUT:-/scratch/kohlbach/b113/hybrid/heldout}; H=$(cd "$(dirname "$0")/.." && pwd)
TRFP=/ceph/ibmi/abi/oliver/prose-auto-20261029/env/bin/thermorawfileparser
tail -n +2 "$1" | while IFS=$'\t' read -r acc file bytes sha1 url cfg; do
  [ "$acc" = "$2" ] || continue
  D=$ROOT/$acc; mkdir -p "$D"; f=$D/$file; stem=${file%.*}; mz=$D/$stem.mzML; st=DOWNLOAD_FAILED
  for a in $(seq 1 30); do
    if [ -s "$f" ] && [ "$(stat -c %s "$f")" = "$bytes" ]; then
      if [ "$sha1" = - ]; then st=size_ok; elif [ "$(sha1sum "$f" | cut -c1-40)" = "$sha1" ]; then st=sha1_ok; else st=SHA1_DIFFERS; fi
      break
    fi
    curl -sS -f -L -C - --retry 3 --connect-timeout 30 --speed-time 120 --speed-limit 10000 -o "$f" "$url" 2>>"$D/curl.log" || sleep 30
  done
  if [ "$st" != DOWNLOAD_FAILED ] && [ "$st" != SHA1_DIFFERS ] && [ ! -s "$mz" ]; then
    rm -rf "$D/tmp.$stem"; mkdir -p "$D/tmp.$stem"
    timeout 14400 "$TRFP" -i "$f" -o "$D/tmp.$stem" -f 2 > "$D/$stem.trfp.log" 2>&1 \
      && [ -s "$D/tmp.$stem/$stem.mzML" ] && mv "$D/tmp.$stem/$stem.mzML" "$mz"
    rm -rf "$D/tmp.$stem"
  fi
  mkdir -p "$D/$stem"
  [ -s "$mz" ] && bash "$H/scripts/truth.sh" "$mz" "$D/$stem" "$H/truth-config/$cfg.json"
  printf 'project\tfile\tstatus\traw_sha256\tmzml\tmzml_sha256\ttruth_config\n%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$acc" "$file" "$st" \
    "$([ -s "$f" ] && sha256sum "$f" | cut -c1-64)" "$mz" "$([ -s "$mz" ] && sha256sum "$mz" | cut -c1-64)" "$cfg" > "$D/$stem/stage.tsv"
done
echo STAGE_DONE > "$ROOT/$2/stage.done"
