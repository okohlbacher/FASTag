#!/bin/bash
# PROPOSED #2/#6 reserves: download each listed PRIDE file twice, independently, with SEG parallel byte ranges
# (PRIDE gives no SHA-1 for these files), require PRIDE size and equal sha256 of both copies, then hand the file to
# stage_pride.sh (route copy+trfp / copy+fileconverter, expected sha256 = the downloaded one) for the conversion.
# Usage: h2r_fetch.sh <list.tsv in stage_pride format> <out prefix> [SEG]
set -u
ROOT=/scratch/kohlbach/fastag-heldout-1.12; SD=$(cd "$(dirname "$0")" && pwd); SEG=${3:-8}
seg() {  # url bytes out
  local url=$1 n=$2 out=$3 step=$(( ($2 + SEG - 1) / SEG )) pids=() i
  for ((i=0; i<SEG; i++)); do
    local a=$((i*step)) b=$(( (i+1)*step - 1 )); [ $b -ge $n ] && b=$((n-1)); [ $a -gt $b ] && continue
    ( for t in 1 2 3 4 5; do curl -sS -f -L --connect-timeout 30 --speed-time 120 --speed-limit 10000 -r $a-$b -o "$out.s$i" "$url" \
        && [ "$(stat -c %s "$out.s$i")" = $((b-a+1)) ] && exit 0; sleep 10; done; exit 1 ) & pids+=($!)
  done
  local rc=0; for p in "${pids[@]}"; do wait $p || rc=1; done
  [ $rc = 0 ] || return 1
  : > "$out"; for ((i=0; i<SEG; i++)); do [ -f "$out.s$i" ] && cat "$out.s$i" >> "$out" && rm -f "$out.s$i"; done
  [ "$(stat -c %s "$out")" = "$n" ]
}
: > "$2.fetch.tsv"; : > "$2.copy.tsv"
while IFS=$'\t' read -r key dir file bytes sha1 url route exp; do
  D=$ROOT/$dir; mkdir -p "$D"; f=$D/$file; st=""
  if [ ! -s "$f" ] || [ "$(stat -c %s "$f")" != "$bytes" ]; then rm -f "$f"; seg "$url" "$bytes" "$f.part" && mv "$f.part" "$f" || st=DOWNLOAD_FAILED; fi
  if [ -z "$st" ]; then
    seg "$url" "$bytes" "$f.check" || st=SECOND_DOWNLOAD_FAILED
    s1=$(sha256sum "$f" | cut -c1-64); s2=$( [ -s "$f.check" ] && sha256sum "$f.check" | cut -c1-64); rm -f "$f.check"
    [ -z "$st" ] && { [ "$s1" = "$s2" ] && st=no_pride_sha1,size_ok,second_download_same || st=SECOND_DOWNLOAD_DIFFERS; }
  fi
  printf "%s\t%s\t%s\t%s\n" "$key" "$dir/$file" "$st" "${s1:-}" >> "$2.fetch.tsv"
  [ "${st#no_pride_sha1}" != "$st" ] && printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n" "$key" "$dir" "$file" "$bytes" - "$f" "copy+$route" "$s1" >> "$2.copy.tsv"
done < "$1"
bash "$SD/stage_pride.sh" "$2.copy.tsv" "$2.staged.tsv" 3
echo "H2R_FETCH_DONE $(date -Is)"
