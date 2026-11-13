#!/bin/bash
# acqcheck3 held-out: the one scored run. Started only after freeze 2 (audited.tsv) is pushed.
#   run.sh <frozen sha256 of audited.tsv>
# 1 default FASTag run per unit, observed to its acquisition decision (decide.sh, 4 at once, 2 threads each)
# 2 metadata probe per unit (probe.sh; reported only)   3 score.py once
set -u
A=/scratch/kohlbach/b114/acqcheck3; H=$A/heldout; cd $H
[ -e prep2.done ] || { echo "freeze-2 preparation missing"; exit 2; }
[ -e run.started ] && { echo "already run"; exit 3; }
[ "$(sha256sum audited.tsv | cut -d' ' -f1)" = "$1" ] || { echo "audited.tsv is not the frozen one"; exit 4; }
date -Is > run.started
sha256sum $A/opt/FASTag decide.sh probe.sh score.py truth.py audited.tsv > run.sha256
awk -F'\t' 'NR == 1 { for (i = 1; i <= NF; i++) c[$i] = i; next }
  $c["staged"] == "yes" && ($c["truth"] == "DIA" || $c["truth"] == "NONDIA") { print $c["id"] "\t" $c["input"] "\t" $c["input_sha256"] }' audited.tsv > run.list
one() { IFS=$'\t' read -r id f sh <<< "$1"
  if [ "$(sha256sum "$f" | cut -d' ' -f1)" != "$sh" ]; then printf "%s\tinput_sha256_mismatch\tNA\t0\tNA\n" "$id"; return; fi
  bash $H/decide.sh "$id" "$f" "$H/runs/$id" "$A/opt/FASTag"; }
export -f one; export A H
xargs -d "\n" -P 4 -I{} bash -c 'one "{}"' < run.list | sort > decide.tsv
cut -f1,2 run.list > probe.list
bash probe.sh probe.list $A/opt/FASTag probe.tsv
python3 -I score.py audited.tsv decide.tsv probe.tsv units.tsv summary.txt > score.out 2>&1
date -Is > run.done
