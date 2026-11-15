#!/bin/bash
# Fetch the PRIDE v3 project and file records of the accessions in $1 into the cache dir $2 (read by
# select_census_heldout.py). Files: pageSize 1000, pages until an empty page.
set -u; L=$1; C=$2; mkdir -p "$C"; API=https://www.ebi.ac.uk/pride/ws/archive/v3/projects
while read -r a; do
  [ -s "$C/$a.project.json" ] || curl -sS -f --retry 5 --max-time 120 "$API/$a" -o "$C/$a.project.json" || echo "FAIL project $a"
  if [ ! -s "$C/$a.files.json" ]; then
    echo -n "[" > "$C/$a.files.tmp"; p=0; first=1
    while :; do
      j=$(curl -sS -f --retry 5 --max-time 300 "$API/$a/files?pageSize=1000&page=$p") || { echo "FAIL files $a"; break; }
      body=$(printf '%s' "$j" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(json.dumps(d)[1:-1] if d else "")')
      [ -z "$body" ] && break
      [ $first = 1 ] || echo -n "," >> "$C/$a.files.tmp"; first=0
      printf '%s' "$body" >> "$C/$a.files.tmp"; p=$((p+1))
    done
    echo "]" >> "$C/$a.files.tmp"; mv "$C/$a.files.tmp" "$C/$a.files.json"
  fi
done < "$L"
echo FETCH_DONE
