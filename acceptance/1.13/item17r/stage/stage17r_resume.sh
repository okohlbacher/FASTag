#!/bin/bash
# FASTag 1.13 #17r staging, second pass for files whose PRIDE https transfer broke: same as stage17r.sh but
# downloads resume (curl -C -) until the PRIDE size is reached. No FASTag, no search engine.
# Usage: stage17r_resume.sh <list.tsv> <out.tsv>
set -u
ROOT=/scratch/kohlbach/b113/shifts/heldout/stage
TRFP=/ceph/ibmi/abi/oliver/prose-auto-20261029/env/bin/thermorawfileparser
get() { # url, target, bytes
  for a in $(seq 1 40); do
    [ -f "$2" ] && [ "$(stat -c %s "$2")" = "$3" ] && return 0
    [ -f "$2" ] && [ "$(stat -c %s "$2")" -gt "$3" ] && rm -f "$2"
    curl -sS -f -L -C - -o "$2" "$1" 2>>curl.log; sleep 5
  done; return 1
}
one() {
  IFS=$'\t' read -r pxd file bytes sha1 url <<< "$1"
  D=$ROOT/$pxd; mkdir -p "$D"; cd "$D" || return; f=$D/$file; st=DOWNLOAD_FAILED
  [ -s "$f" ] || { get "$url" "$f.part" "$bytes" && mv "$f.part" "$f"; }
  if [ -s "$f" ] && [ "$(stat -c %s "$f")" = "$bytes" ]; then
    if [ "$sha1" != - ]; then [ "$(sha1sum "$f" | cut -c1-40)" = "$sha1" ] && st=sha1_ok || st=SHA1_MISMATCH
    else get "$url" "$f.check" "$bytes"
      if [ "$(sha256sum "$f" | cut -c1-64)" = "$(sha256sum "$f.check" 2>/dev/null | cut -c1-64)" ]; then st=no_pride_sha1,size_ok,second_download_same; else st=SECOND_DOWNLOAD_DIFFERS; fi
      rm -f "$f.check"; fi
  fi
  sha=$( [ -s "$f" ] && sha256sum "$f" | cut -c1-64)
  stem=${file%.*}; out=$D/$stem.mzML; rc=0
  if [ ! -s "$out" ]; then rm -rf tmp; mkdir tmp
    timeout 14400 $TRFP -i "$f" -o "$D/tmp" -f 2 > "$stem.trfp.log" 2>&1; rc=$?
    [ $rc = 0 ] && [ -s "tmp/$stem.mzML" ] && mv "tmp/$stem.mzML" "$out"; rm -rf tmp; fi
  osha=""; ob=""; [ -s "$out" ] && [ $rc = 0 ] && { osha=$(sha256sum "$out" | cut -c1-64); ob=$(stat -c %s "$out"); }
  printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n" "$pxd" "$f" "$st" "$sha" "$rc" "$out" "$ob" "$osha"
}
export -f one get; export ROOT TRFP
xargs -d "\n" -P 4 -I{} bash -c "one \"{}\"" < "$1" > "$2"
echo "STAGE_DONE $(date -Is)" > "$2.done"
