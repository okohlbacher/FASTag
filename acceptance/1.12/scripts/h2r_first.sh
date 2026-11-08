#!/bin/bash
# First download only (resumable 256 MB ranges, 8 in parallel) of the rows in $1, in file order; the second,
# independent download and the sha256 comparison stay with h2r_fetch.sh. Skips a file h2r_fetch.sh has begun.
set -u; ROOT=/scratch/kohlbach/fastag-heldout-1.12; export CH=268435456
chunk() {  # i url bytes dir
  local i=$1 url=$2 n=$3 W=$4 a b o want have t
  a=$((i*CH)); b=$((a+CH-1)); [ $b -ge $n ] && b=$((n-1)); o=$W/c$i; want=$((b-a+1))
  for t in 1 2 3 4 5 6 7 8; do
    have=$(stat -c %s $o 2>/dev/null || echo 0)
    [ "$have" = "$want" ] && return 0
    [ "$have" -gt "$want" ] && { rm -f $o; have=0; }
    curl -sS -f -L --connect-timeout 30 --speed-time 120 --speed-limit 10000 -r $((a+have))-$b "$url" >> $o
    sleep 5
  done
  return 1
}
export -f chunk
while IFS=$'\t' read -r key dir file bytes sha1 url route exp; do
  f=$ROOT/$dir/$file; mkdir -p $ROOT/$dir
  if [ -e "$f" ] || ls "$f".part* >/dev/null 2>&1; then echo "SKIP $key"; continue; fi
  W=$ROOT/$dir/.first.$file; mkdir -p "$W"; n=$(( (bytes + CH - 1) / CH ))
  seq 0 $((n-1)) | xargs -P 8 -I{} bash -c "chunk {} '$url' $bytes '$W'"
  : > "$f.first"; for ((i=0; i<n; i++)); do cat "$W/c$i" >> "$f.first"; done
  if [ "$(stat -c %s "$f.first")" = "$bytes" ]; then mv "$f.first" "$f"; rm -rf "$W"; echo "FIRST_OK $key"; else echo "FIRST_FAIL $key"; fi
done < "$1"
echo "H2R_FIRST_DONE $(date -Is)"
