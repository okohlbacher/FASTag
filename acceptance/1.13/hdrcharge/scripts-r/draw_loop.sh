#!/bin/bash
# Run the draw; fetch the PRIDE records it names as missing (census/scripts/fetch_pride_meta.sh); repeat.
H=$(cd "$(dirname "$0")/.." && pwd)
for i in $(seq 1 200); do
  out=$(python3 "$H/scripts-r/select_heldout_r.py" "$H/inputs-r")
  if [[ "$out" == FETCH* ]]; then echo "${out#FETCH }" | tr ' ' '\n' > "$H/inputs-r/pride/.need"; bash "$H/../census/scripts/fetch_pride_meta.sh" "$H/inputs-r/pride/.need" "$H/inputs-r/pride" | grep -v FETCH_DONE; rm -f "$H/inputs-r/pride/.need"
  else echo "$out"; break; fi
done
