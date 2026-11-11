#!/bin/bash
# acqcheck2 staging, retry passes (replaces stage2.sh before it did anything): PRIDE limits the connections per
# address and other jobs on the node download too, so stage.sh is repeated (8 parallel) until every manifest file
# is staged or the hard stop 03:20 CET (20:20 CST) 2026-11-11. No FASTag binary, no truth script.
H=/scratch/kohlbach/b113/acqcheck2/heldout; cd $H
while [ ! -e stage.tsv.done ]; do sleep 20; done
cat stage.tsv > stage.all; rm stage.tsv.done; n=$(( $(wc -l < manifest.tsv) - 1 )); p=1
good() { awk -F'\t' '($2 == "sha1_ok" || $2 == "size_ok") && $4 == 0' stage.all | cut -f1 | sort -u | wc -l; }
while [ $(good) -lt $n ]; do
  left=$(( $(date -d "2026-11-11 03:20" +%s) - $(date +%s) )); [ $left -gt 60 ] || break
  p=$((p+1)); timeout $left bash stage.sh manifest.tsv stage.tsv 8 > stage.pass$p.out 2>&1
  cat stage.tsv.part >> stage.all; rm -f stage.tsv.done; echo "pass $p good $(good) $(date -Is)" >> stage.passes; sleep 30
done
# one row per file: a staged row wins
awk -F'\t' '{ g = (($2 == "sha1_ok" || $2 == "size_ok") && $4 == 0); if (!($1 in r) || g) r[$1] = $0 } END { for (i in r) print r[i] }' stage.all | sort > stage.tsv
touch stage.tsv.done; date -Is > stage.final.done
