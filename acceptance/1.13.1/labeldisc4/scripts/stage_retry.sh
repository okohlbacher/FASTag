#!/bin/bash
# Retry of rows that failed to download (connection refused by the PRIDE mirror); same files, same script, parallel 4.
# Usage: stage_retry.sh <minutes>
cd /scratch/kohlbach/post1131/labeldisc/heldout4 || exit 1
end=$(( $(date +%s) + $1 * 60 ))
prev=audit/stage1.tsv; n=2
while :; do
  awk -F'\t' '$3 ~ /FAILED|DIFFERS/ {print $1}' $prev > audit/retry$n.keys
  [ -s audit/retry$n.keys ] || break
  [ $(date +%s) -ge $end ] && break
  awk -F'\t' 'NR==FNR{k[$1]=1;next} ($1 in k)' audit/retry$n.keys sel/stage_list.tsv > audit/retry$n.list
  ROOT=$PWD/in bash scripts/stage_pride.sh audit/retry$n.list audit/stage$n.tsv 4 > audit/stage$n.log 2>&1
  prev=audit/stage$n.tsv; n=$((n+1)); sleep 20
done
touch audit/retry.done
