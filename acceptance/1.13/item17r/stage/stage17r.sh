#!/bin/bash
# FASTag 1.13 #17r held-out staging from PRIDE (download + conversion only; no FASTag, no search engine).
# list: pxd, file, bytes, pride_sha1 (- none), url. PRIDE SHA-1 checked where given, else PRIDE size + a second
# download with the same sha256. Conversion: ThermoRawFileParser 2.0.0 -f 2 (centroided mzML).
# Usage: stage17r.sh <list.tsv> <out.tsv>
set -u
ROOT=/scratch/kohlbach/b113/shifts/heldout/stage
TRFP=/ceph/ibmi/abi/oliver/prose-auto-20261029/env/bin/thermorawfileparser
one() {
  IFS=$'\t' read -r pxd file bytes sha1 url <<< "$1"
  D=$ROOT/$pxd; mkdir -p "$D"; cd "$D" || return; f=$D/$file; ok=0; st=DOWNLOAD_FAILED
  for a in 1 2 3 4; do
    if [ -s "$f" ]; then
      if [ "$sha1" != - ]; then [ "$(sha1sum "$f" | cut -c1-40)" = "$sha1" ] && { ok=1; break; }
      else [ "$(stat -c %s "$f")" = "$bytes" ] && { ok=1; break; }; fi
      rm -f "$f"
    fi
    curl -sS -f -L --retry 3 -o "$f.part" "$url" 2>>curl.log && mv "$f.part" "$f"
  done
  if [ $ok = 1 ] && [ "$sha1" != - ]; then st=sha1_ok
  elif [ $ok = 1 ]; then
    curl -sS -f -L --retry 3 -o "$f.check" "$url" 2>>curl.log
    if [ "$(sha256sum "$f" | cut -c1-64)" = "$(sha256sum "$f.check" 2>/dev/null | cut -c1-64)" ]; then st=no_pride_sha1,size_ok,second_download_same; else st=SECOND_DOWNLOAD_DIFFERS; fi
    rm -f "$f.check"
  fi
  sha=$( [ -s "$f" ] && sha256sum "$f" | cut -c1-64)
  stem=${file%.*}; out=$D/$stem.mzML; rc=0
  if [ ! -s "$out" ]; then rm -rf tmp; mkdir tmp
    timeout 14400 $TRFP -i "$f" -o "$D/tmp" -f 2 > "$stem.trfp.log" 2>&1; rc=$?
    [ $rc = 0 ] && [ -s "tmp/$stem.mzML" ] && mv "tmp/$stem.mzML" "$out"; rm -rf tmp; fi
  osha=""; ob=""; [ -s "$out" ] && [ $rc = 0 ] && { osha=$(sha256sum "$out" | cut -c1-64); ob=$(stat -c %s "$out"); }
  printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n" "$pxd" "$f" "$st" "$sha" "$rc" "$out" "$ob" "$osha"
}
export -f one; export ROOT TRFP
xargs -d "\n" -P 4 -I{} bash -c "one \"{}\"" < "$1" > "$2"
echo "STAGE_DONE $(date -Is)" > "$2.done"
