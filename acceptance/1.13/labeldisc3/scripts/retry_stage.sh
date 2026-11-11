#!/bin/bash
# Held-out test 3: retry rows of a stage list that failed for transient PRIDE errors (403, empty reply, closed transfer).
# Same files, same checks (stage_pride_labeldisc3.sh); a row is done when its download check and conversion succeeded.
# Usage: ROOT=... retry_stage.sh <list.tsv> <first out.tsv> <rounds> <parallel>     writes <first out>.rN.tsv and <first out>.retry.done
SD=$(cd "$(dirname "$0")" && pwd); L=$1; O=$2
while [ ! -e "$O.done" ]; do sleep 30; done
for i in $(seq 2 $(( $3 + 1 ))); do
  cat "$O" "${O%.tsv}".r*.tsv 2>/dev/null | awk -F'\t' '$5=="0" && $8!="" && $3!~/FAILED|DIFFERS|MISMATCH/{print $1}' | sort -u > "$O.ok"
  awk -F'\t' 'NR==FNR{ok[$1]=1;next} !($1 in ok)' "$O.ok" "$L" > "$O.todo"
  [ -s "$O.todo" ] || break
  bash "$SD/stage_pride_labeldisc3.sh" "$O.todo" "${O%.tsv}.r$i.tsv" "$4"
done
echo "RETRY_DONE $(date -Is) left $(wc -l < "$O.todo")" > "$O.retry.done"
