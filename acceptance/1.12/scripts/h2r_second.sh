#!/bin/bash
# Second, independent download (resumable 256 MB ranges, 8 in parallel) of each row in $1 whose first copy exists,
# sha256 of both copies compared; rows that pass go to <prefix>.copy.tsv and stage_pride.sh converts them
# (route copy+trfp / copy+fileconverter, expected sha256 = the downloaded one). Rows already in <prefix>.fetch.tsv
# are not downloaded again. Usage: h2r_second.sh <list.tsv> <prefix>
set -u; ROOT=/scratch/kohlbach/fastag-heldout-1.12; SD=$(cd "$(dirname "$0")" && pwd); export CH=268435456
chunk() {
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
touch "$2.fetch.tsv"
while IFS=$'\t' read -r key dir file bytes sha1 url route exp; do
  f=$ROOT/$dir/$file
  if ! grep -q "^$key	" "$2.fetch.tsv"; then
    if [ ! -s "$f" ] || [ "$(stat -c %s "$f")" != "$bytes" ]; then printf "%s\t%s\tFIRST_COPY_MISSING\t\n" "$key" "$dir/$file" >> "$2.fetch.tsv"; continue; fi
    W=$ROOT/$dir/.second.$file; mkdir -p "$W"; n=$(( (bytes + CH - 1) / CH ))
    seq 0 $((n-1)) | xargs -P 8 -I{} bash -c "chunk {} '$url' $bytes '$W'"
    : > "$f.check"; for ((i=0; i<n; i++)); do cat "$W/c$i" >> "$f.check"; done; rm -rf "$W"   # numeric chunk order
    s1=$(sha256sum "$f" | cut -c1-64); s2=$(sha256sum "$f.check" | cut -c1-64); sz=$(stat -c %s "$f.check"); rm -f "$f.check"
    if [ "$sz" = "$bytes" ] && [ "$s1" = "$s2" ]; then st=no_pride_sha1,size_ok,second_download_same; else st=SECOND_DOWNLOAD_DIFFERS; fi
    printf "%s\t%s\t%s\t%s\n" "$key" "$dir/$file" "$st" "$s1" >> "$2.fetch.tsv"
  fi
  line=$(grep "^$key	" "$2.fetch.tsv" | tail -1)
  st=$(echo "$line" | cut -f3); s1=$(echo "$line" | cut -f4)
  [ "${st#no_pride_sha1}" != "$st" ] && printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n" "$key" "$dir" "$file" "$bytes" - "$f" "copy+$route" "$s1" >> "$2.copy.tsv"
done < "$1"
bash "$SD/stage_pride.sh" "$2.copy.tsv" "$2.staged.tsv" 3
echo "H2R_SECOND_DONE $(date -Is)"
