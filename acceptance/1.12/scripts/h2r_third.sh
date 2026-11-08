#!/bin/bash
# Tie-break for a file whose two downloads differed: a third download in 256 MB chunks (kept), compared chunk by
# chunk with the first copy. Prints MISMATCH lines; THIRD_EQUALS_FIRST when all chunks agree.
# Usage: h2r_third.sh <file> <url> <bytes>
set -u; export CH=268435456; f=$1; url=$2; n=$3; W=$f.third; mkdir -p $W
chunk() {
  local i=$1 url=$2 n=$3 W=$4 a b o want have t
  a=$((i*CH)); b=$((a+CH-1)); [ $b -ge $n ] && b=$((n-1)); o=$W/c$i; want=$((b-a+1))
  for t in 1 2 3 4 5 6 7 8 9 10; do
    have=$(stat -c %s $o 2>/dev/null || echo 0)
    [ "$have" = "$want" ] && return 0
    [ "$have" -gt "$want" ] && { rm -f $o; have=0; }
    curl -sS -f -L --connect-timeout 30 --speed-time 120 --speed-limit 10000 -r $((a+have))-$b "$url" >> $o
    sleep 5
  done
  return 1
}
export -f chunk
k=$(( (n + CH - 1) / CH ))
seq 0 $((k-1)) | xargs -P 8 -I{} bash -c "chunk {} '$url' $n '$W'"
bad=0
for ((i=0; i<k; i++)); do
  a=$(sha256sum < $W/c$i | cut -c1-64)
  b=$(tail -c +$((i*CH+1)) "$f" | head -c $(stat -c %s $W/c$i) | sha256sum | cut -c1-64)
  [ "$a" = "$b" ] || { echo "MISMATCH chunk $i"; bad=$((bad+1)); }
done
[ $bad = 0 ] && echo THIRD_EQUALS_FIRST || echo "THIRD_DIFFERS_FROM_FIRST $bad chunks"
