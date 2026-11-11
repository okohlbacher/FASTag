#!/bin/bash
# acqcheck2 held-out staging: download each manifest file from PRIDE (https), check PRIDE's SHA-1 (or, where PRIDE
# lists none, the listed size), convert with ThermoRawFileParser 2.0.0 -f 2. No FASTag binary and no truth
# script is run here.
# usage: stage.sh <manifest.tsv> <stage.tsv> [parallel]
# out: id, fetch (sha1_ok | size_ok | sha1_FAIL | size_FAIL | fetch_FAIL), raw sha256, conv rc, mzML path
H=/scratch/kohlbach/b113/acqcheck2/heldout
TRFP=/ceph/ibmi/abi/oliver/prose-auto-20261029/env/bin/thermorawfileparser
ok() { [ -s "$1" ] || return 1
  if [ "$2" = - ]; then [ "$(stat -c %s "$1")" = "$3" ]; else [ "$(sha1sum "$1" | cut -c1-40)" = "$2" ]; fi; }
one() { IFS=$'\t' read -r id file size sha1 ftp <<< "$1"
  local R=$H/files/$id; mkdir -p $R/raw $R/conv; local n="$R/raw/$file" u=${ftp/ftp:\/\//https:\/\/} st
  for a in 1 2 3; do ok "$n" "$sha1" "$size" && break
    curl -sS -f -L --retry 3 -C - -o "$n" "$u" 2>>$R/curl.log || { [ $a -ge 2 ] && rm -f "$n"; }
  done
  if [ ! -s "$n" ]; then st=fetch_FAIL
  elif ok "$n" "$sha1" "$size"; then [ "$sha1" = - ] && st=size_ok || st=sha1_ok
  else [ "$sha1" = - ] && st=size_FAIL || st=sha1_FAIL; fi
  local stem=${file%.*} out rc=NA; out=$R/conv/$stem.mzML
  if [ $st = sha1_ok ] || [ $st = size_ok ]; then
    if [ ! -s "$out" ]; then rm -rf $R/conv/tmp; mkdir -p $R/conv/tmp
      timeout 7200 $TRFP -i "$n" -o $R/conv/tmp -f 2 > $R/conv/trfp.log 2>&1; rc=$?
      [ $rc = 0 ] && [ -s "$R/conv/tmp/$stem.mzML" ] && mv "$R/conv/tmp/$stem.mzML" "$out"; rm -rf $R/conv/tmp
    else rc=0; fi
  fi
  printf "%s\t%s\t%s\t%s\t%s\n" "$id" "$st" "$(sha256sum "$n" 2>/dev/null | cut -d" " -f1)" "$rc" "$out"; }
export -f one ok; export H TRFP
awk -F'\t' -v OFS='\t' 'NR>1 { if ($8 == "") $8 = "-"; print $1, $6, $7, $8, $9 }' "$1" |
  xargs -d "\n" -P "${3:-14}" -I{} bash -c 'one "{}"' > "$2.part"
sort "$2.part" > "$2"; touch "$2.done"
