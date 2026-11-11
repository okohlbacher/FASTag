#!/bin/bash
# Held-out test 3: reporter-ion audit scan (audit_scan.py, stride 2) of every staged mzML that has no scan json yet.
# Usage: scan_all.sh <heldout3 dir> [parallel]     reads audit/stage*.tsv, writes audit/scan/<id>.json and audit/scan.done
cd "$1" || exit 1; mkdir -p audit/scan; rm -f audit/scan.done
cat audit/stage1*.tsv audit/stage[2-9]*.tsv 2>/dev/null | awk -F'\t' '$5=="0" && $8!="" && $3!~/FAILED|DIFFERS|MISMATCH/{print $1"\t"$6}' | sort -u |
  while IFS=$'\t' read -r id f; do [ -s "audit/scan/$id.json" ] || printf '%s\t%s\n' "$id" "$f"; done > audit/scan.todo
one() { IFS=$'\t' read -r id f <<< "$1"; python3 -I scripts/audit_scan.py "$id" "in/$f" "audit/scan/$id.json" 2 > "audit/scan/$id.log" 2>&1; }
export -f one
xargs -a audit/scan.todo -d '\n' -P "${2:-8}" -I{} bash -c 'one "{}"'
echo "SCAN_DONE $(date -Is)" > audit/scan.done
