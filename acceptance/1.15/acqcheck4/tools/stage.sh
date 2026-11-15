#!/bin/bash
# acqcheck4 staging on node data (Thermo .raw rows, main and backup alike). Download and conversion only: no FASTag
# binary and no truth script runs here.
#   stage.sh <manifest.tsv> <hard stop, "YYYY-MM-DD HH:MM" node time>
# Per row: pride_get.py meta <PXD> (counts only), pride_get.py get <PXD> --files <file> --split 4 (HTTPS, 4 byte ranges; PRIDE MD5 and size checked;
# persistent copy in the PRIDE archive /ceph/ibmi/abi/dont-backup/pride), then pride_get.py stage to
# files/<id>/raw/ (MD5 checked again), then ThermoRawFileParser 2.0.0 -f 2 (as acqcheck3).
# 3 rows (downloads) at once; at most 2 conversions at once (two flock slots), run with nice -n 10 (node data is
# shared with a timing benchmark); at most 2 passes (the second retries rows not staged in the first; pride_get resumes partials);
# hard stop. Output stage.tsv: id, route, fetch (md5_ok|fetch_FAIL), raw sha256, conv rc, mzML path, mzML sha256.
# A row is staged when fetch is md5_ok, conv rc 0 and the mzML exists.
set -u
H=/scratch/kohlbach/acc115/acqcheck4/heldout
PG="python3 -I /home/kohlbach/.claude/skills/pride/scripts/pride_get.py"
TRFP=/ceph/ibmi/abi/oliver/prose-auto-20261029/env/bin/thermorawfileparser
one() { IFS=$'\t' read -r id pxd file <<< "$1"
  local R=$H/files/$id; mkdir -p $R/raw $R/conv
  local n="$R/raw/$file" st=fetch_FAIL
  if [ -s "$n" ] && grep -q "^ok" $R/fetch.status 2>/dev/null; then st=md5_ok
  else
    $PG meta "$pxd" > $R/meta.log 2>&1 && $PG get "$pxd" --files "$file" --split 4 > $R/get.log 2>&1 && $PG stage "$pxd" --files "$file" --to $R/raw > $R/stagecp.log 2>&1 \
      && [ -s "$n" ] && { st=md5_ok; echo "ok $(date -Is)" > $R/fetch.status; }
  fi
  local out="" rc=NA osha=""
  if [ $st = md5_ok ]; then
    local stem=${file%.*}; out=$R/conv/$stem.mzML
    if [ ! -s "$out" ]; then rm -rf $R/conv/tmp; mkdir -p $R/conv/tmp
      local slot=$(( $(printf "%s" "$id" | cksum | cut -d" " -f1) % 2 ))
      flock $H/conv.slot$slot timeout 14400 nice -n 10 $TRFP -i "$n" -o $R/conv/tmp -f 2 > $R/conv/trfp.log 2>&1; rc=$?
      [ $rc = 0 ] && [ -s "$R/conv/tmp/$stem.mzML" ] && mv "$R/conv/tmp/$stem.mzML" "$out"; rm -rf $R/conv/tmp
    else rc=0; fi
    [ "$rc" = 0 ] && [ -s "$out" ] || { [ "$rc" = 0 ] && rc=95; }
    [ "$rc" = 0 ] && osha=$(sha256sum "$out" | cut -d" " -f1)
  fi
  printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\n" "$id" thermo "$st" "$(sha256sum "$n" 2>/dev/null | cut -d" " -f1)" "$rc" "$out" "$osha"; }
export -f one; export H PG TRFP
cd $H
M=$1; STOP=$(date -d "$2" +%s)
good() { awk -F'\t' '$3 == "md5_ok" && $5 == 0 { print $1 }' stage.all 2>/dev/null | sort -u; }
awk -F'\t' 'NR > 1 && $6 ~ /\.raw$/ { print $1 "\t" $4 "\t" $6 }' "$M" > stage.todo
touch stage.all
for p in 1 2; do
  [ $(date +%s) -lt $STOP ] || break
  good > stage.good; awk -F'\t' 'FILENAME == ARGV[1] { g[$1] = 1; next } !($1 in g)' stage.good stage.todo > stage.pass$p.list
  [ -s stage.pass$p.list ] || break
  timeout $(( STOP - $(date +%s) )) xargs -d "\n" -P 3 -I{} bash -c 'one "{}"' < stage.pass$p.list > stage.pass$p.tsv
  cat stage.pass$p.tsv >> stage.all; echo "pass $p rows $(wc -l < stage.pass$p.list) staged_total $(good | wc -l) $(date -Is)" >> stage.passes
done
awk -F'\t' '{ g = ($3 == "md5_ok" && $5 == 0); if (!($1 in r) || g) r[$1] = $0 } END { for (i in r) print r[i] }' stage.all | sort > stage.tsv
date -Is > stage.done
