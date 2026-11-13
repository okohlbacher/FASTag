#!/bin/bash
# acqcheck3 staging on node data (Thermo .raw and Bruker .d.zip rows; SCIEX rows are staged on flash by
# stage_sciex.ps1). Download only and conversion only: no FASTag binary and no truth script runs here.
#   stage.sh <manifest.tsv> <hard stop, "YYYY-MM-DD HH:MM" node time>
# Every manifest row of route thermo/bruker (main and backup rows alike) is staged; passes repeat (3 parallel
# jobs, so at most 3 downloads at once) until every row is staged, 4 passes are done, or the hard stop.
# Per file: curl over https from PRIDE, at most 3 attempts per pass; check PRIDE's SHA-1 (or, where PRIDE lists
# none, the listed size). Conversion, fixed:
#   thermo  ThermoRawFileParser 2.0.0 -f 2 (as acqcheck2)
#   bruker  unzip (python -I zipfile), diaweaver-7ed1169 FileConverter -in <.d> -out <mzML> -threads 3 (as E7-03);
#           the unpacked .d is removed afterwards, the archive is kept (truth.py reads analysis.tdf from it)
# Output stage.tsv: id, route, fetch (sha1_ok|size_ok|sha1_FAIL|size_FAIL|fetch_FAIL), raw sha256, conv rc,
# mzML path, mzML sha256. A row is staged when fetch is *_ok, conv rc 0 and the mzML exists.
set -u
H=/scratch/kohlbach/b114/acqcheck3/heldout
TRFP=/ceph/ibmi/abi/oliver/prose-auto-20261029/env/bin/thermorawfileparser
FC=/ceph/ibmi/abi/oliver/spextract/diaweaver-7ed1169/bin/FileConverter
route_of() { case "$1" in *.raw) echo thermo;; *.d.zip) echo bruker;; *.wiff|*.wiff2) echo sciex;; *) echo other;; esac; }
ok() { [ -s "$1" ] || return 1
  if [ "$2" = - ]; then [ "$(stat -c %s "$1")" = "$3" ]; else [ "$(sha1sum "$1" | cut -c1-40)" = "$2" ]; fi; }
one() { IFS=$'\t' read -r id file size sha1 ftp <<< "$1"
  local R=$H/files/$id route; route=$(route_of "$file"); mkdir -p $R/raw $R/conv
  local n="$R/raw/$file" u=${ftp/ftp:\/\//https:\/\/} st
  for a in 1 2 3; do ok "$n" "$sha1" "$size" && break
    curl -sS -f -L --retry 3 -C - -o "$n" "$u" 2>>$R/curl.log || { [ $a -ge 2 ] && rm -f "$n"; }
  done
  if [ ! -s "$n" ]; then st=fetch_FAIL
  elif ok "$n" "$sha1" "$size"; then [ "$sha1" = - ] && st=size_ok || st=sha1_ok
  else [ "$sha1" = - ] && st=size_FAIL || st=sha1_FAIL; fi
  local out="" rc=NA osha=""
  if [ $st = sha1_ok ] || [ $st = size_ok ]; then
    if [ $route = thermo ]; then
      local stem=${file%.*}; out=$R/conv/$stem.mzML
      if [ ! -s "$out" ]; then rm -rf $R/conv/tmp; mkdir -p $R/conv/tmp
        timeout 14400 $TRFP -i "$n" -o $R/conv/tmp -f 2 > $R/conv/trfp.log 2>&1; rc=$?
        [ $rc = 0 ] && [ -s "$R/conv/tmp/$stem.mzML" ] && mv "$R/conv/tmp/$stem.mzML" "$out"; rm -rf $R/conv/tmp
      else rc=0; fi
    elif [ $route = bruker ]; then
      local stem=${file%.zip}; stem=${stem%.d}; out=$R/conv/$stem.mzML
      if [ ! -s "$out" ]; then local T=$R/dtmp; rm -rf $T; mkdir -p $T
        python3 -I -m zipfile -e "$n" $T > $R/conv/unzip.log 2>&1
        local d; d=$(find $T -maxdepth 3 -type d -iname '*.d' | head -1)
        if [ -z "$d" ] && [ -f "$T/analysis.tdf" ]; then mkdir -p "$T/$stem.d"
          find $T -mindepth 1 -maxdepth 1 ! -name "$stem.d" -exec mv {} "$T/$stem.d/" \; ; d="$T/$stem.d"; fi
        if [ -z "$d" ] || [ ! -f "$d/analysis.tdf" ]; then rc=97
        else rm -rf $R/conv/tmp; mkdir -p $R/conv/tmp
          timeout 14400 $FC -in "$d" -out "$R/conv/tmp/$stem.mzML" -threads 3 > $R/conv/fileconverter.log 2>&1; rc=$?
          [ $rc = 0 ] && [ -s "$R/conv/tmp/$stem.mzML" ] && mv "$R/conv/tmp/$stem.mzML" "$out"; rm -rf $R/conv/tmp; fi
        rm -rf $T
      else rc=0; fi
    else rc=96; fi
    [ "$rc" = 0 ] && [ -s "$out" ] || { [ "$rc" = 0 ] && rc=95; }
    [ "$rc" = 0 ] && osha=$(sha256sum "$out" | cut -d" " -f1)
  fi
  printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\n" "$id" "$route" "$st" "$(sha256sum "$n" 2>/dev/null | cut -d" " -f1)" "$rc" "$out" "$osha"; }
export -f one ok route_of; export H TRFP FC
cd $H
M=$1; STOP=$(date -d "$2" +%s)
good() { awk -F'\t' '($3 == "sha1_ok" || $3 == "size_ok") && $5 == 0 { print $1 }' stage.all 2>/dev/null | sort -u; }
awk -F'\t' 'NR > 1 && ($6 ~ /\.raw$/ || $6 ~ /\.d\.zip$/) { s = ($8 == "") ? "-" : $8; print $1 "\t" $6 "\t" $7 "\t" s "\t" $9 }' "$M" > stage.todo
touch stage.all
for p in 1 2 3 4; do
  [ $(date +%s) -lt $STOP ] || break
  good > stage.good; awk -F'\t' 'NR == FNR { g[$1] = 1; next } !($1 in g)' stage.good stage.todo > stage.pass$p.list
  [ -s stage.pass$p.list ] || break
  timeout $(( STOP - $(date +%s) )) xargs -d "\n" -P 3 -I{} bash -c 'one "{}"' < stage.pass$p.list > stage.pass$p.tsv
  cat stage.pass$p.tsv >> stage.all; echo "pass $p rows $(wc -l < stage.pass$p.list) staged_total $(good | wc -l) $(date -Is)" >> stage.passes
done
awk -F'\t' '{ g = (($3 == "sha1_ok" || $3 == "size_ok") && $5 == 0); if (!($1 in r) || g) r[$1] = $0 } END { for (i in r) print r[i] }' stage.all | sort > stage.tsv
date -Is > stage.data.done
