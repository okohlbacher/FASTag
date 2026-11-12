#!/bin/bash
# Held-out test 5 staging with a bounded backup rule (PREREG-labeldisc5.md, "Technical failures"); no FASTag, no scan.
# Rank r = 0, 1, 2 in turn: stage the rank-r file of every project that has no staged file yet (stage_pride.sh, which
# itself tries each download up to 4 times with curl --retry 3). A row whose download failed or whose two downloads
# differ is rerun at most MAXRERUN times (10 min apart); a row whose conversion failed is not rerun. A project whose
# rank-r file is still not staged moves on to rank r+1; after rank 2 it is dropped.
# Usage: stage_heldout5.sh <selected.tsv> <parallel>      (cwd = the test directory; writes stage/)
set -u
SEL=$1; P=${2:-6}; MAXRERUN=2
SD=$(cd "$(dirname "$0")" && pwd); mkdir -p stage
export ROOT=$PWD/in
ok() { awk -F'\t' '$5 == "0" && $8 != "" && $3 !~ /FAILED|DIFFERS|MISMATCH/ {print $1}' "$@" 2>/dev/null; }
for r in 0 1 2; do
  ok stage/stage_r*.tsv | sort -u > stage/ok.keys
  # projects with a staged file, then the rank-r rows of the others (stage_pride list format)
  awk -v R=$r -F'\t' 'FILENAME == ARGV[1] {k[$1]=1; next} /^# / || $1 == "id" {next} {if ($1 in k) done[$2]=1; row[NR]=$0; pxd[NR]=$2; rank[NR]=$8}
     END {for (i in row) if (rank[i] == R && !(pxd[i] in done)) {split(row[i], c, "\t"); print c[1] "\t" c[2] "\t" c[9] "\t" c[10] "\t" c[11] "\t" c[12] "\ttrfp\t-"}}' \
     stage/ok.keys "$SEL" | sort > stage/list_r$r.tsv
  [ -s stage/list_r$r.tsv ] || continue
  bash "$SD/stage_pride.sh" stage/list_r$r.tsv stage/stage_r${r}_0.tsv "$P" > stage/stage_r${r}_0.log 2>&1
  for n in $(seq 1 $MAXRERUN); do
    awk -F'\t' '$3 ~ /FAILED|DIFFERS/ {print $1}' stage/stage_r${r}_$((n-1)).tsv > stage/rerun_r${r}_$n.keys
    [ -s stage/rerun_r${r}_$n.keys ] || break
    sleep 600
    awk -F'\t' 'FILENAME == ARGV[1] {k[$1]=1; next} ($1 in k)' stage/rerun_r${r}_$n.keys stage/list_r$r.tsv > stage/rerun_r${r}_$n.tsv
    bash "$SD/stage_pride.sh" stage/rerun_r${r}_$n.tsv stage/stage_r${r}_$n.tsv "$P" > stage/stage_r${r}_$n.log 2>&1
  done
done
ok stage/stage_r*.tsv | sort -u > stage/ok.keys
echo "STAGE5_DONE $(date -Is) staged $(wc -l < stage/ok.keys)" > stage/stage.done
