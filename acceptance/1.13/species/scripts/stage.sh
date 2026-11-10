#!/bin/bash
# Stage the held-out mzMLs (read-only source under /ceph) to /scratch on data and hash them. No FASTag here.
# usage: stage.sh <stage.tsv: pxd<TAB>source path> <dest root>     writes <dest root>/staged.sha256 and STAGE_DONE
set -u
while IFS=$'\t' read -r pxd src; do
  mkdir -p "$2/mzml/$pxd" && cp -n "$src" "$2/mzml/$pxd/" || echo "FAIL $src" >> "$2/stage.err"
done < "$1"
(cd "$2" && find mzml -name '*.mzML' | sort | xargs -P 8 -n 1 sha256sum | sort -k2 > staged.sha256)
touch "$2/STAGE_DONE"
