#!/bin/bash
# accel.sh <pxd> <file>: finish a partly downloaded raw file with parallel https range requests, then stage it.
H=/scratch/kohlbach/b113/compltol/heldout2; D=$H/pre2/acceptance/1.13/compltol/heldout2
line=$(awk -F'\t' -v p="$1" -v f="$2" '$3 == p && $4 == f' $D/select/candidates.tsv)
IFS=$'\t' read -r stratum rank acc file bytes sha1 url rest <<< "$line"
f=$H/raw/$acc/$file; P=$H/raw/$acc/parts.${file%.*}; mkdir -p $P
s=$(stat -c %s "$f"); echo "$s" > $P/start
seg=200000000; i=0
for a in $(seq $s $seg $((bytes-1))); do
  b=$((a+seg-1)); [ $b -ge $bytes ] && b=$((bytes-1))
  printf '%05d %s %s\n' $i $a $b; i=$((i+1))
done > $P/list
get() { n=$1; a=$2; b=$3; want=$((b-a+1))
  for t in $(seq 1 40); do
    [ -s $P/$n ] && [ "$(stat -c %s $P/$n)" = "$want" ] && return 0
    curl -sS -f -L -r $a-$b --connect-timeout 30 --speed-time 60 --speed-limit 20000 -o $P/$n "$url" 2>>$P/curl.log || sleep 5
  done; return 1; }
export -f get; export P url
xargs -P ${NPAR:-12} -L 1 bash -c 'get "$@"' _ < $P/list
while read -r n a b; do [ "$(stat -c %s $P/$n)" = "$((b-a+1))" ] || { echo "PART $n BAD"; exit 1; }; done < $P/list
[ "$(stat -c %s "$f")" = "$s" ] || { echo "file changed"; exit 1; }
while read -r n a b; do cat $P/$n >> "$f"; done < $P/list
echo "ACCEL_OK $(stat -c %s "$f") of $bytes"
bash $D/scripts/stage.sh $D/select/candidates.tsv "$acc" "$file"
