#!/bin/bash
# acqcheck2 held-out: the one scored run. Started only after the freeze commit is pushed and stage.tsv exists.
# 1 truth (truth.py, every staged mzML)  2 probe with candidate and base binary  3 score
set -u
A=/scratch/kohlbach/b113/acqcheck2; H=$A/heldout; cd $H
[ -e stage.final.done ] || { echo "staging not finished"; exit 2; }
[ -e run.started ] && { echo "already run"; exit 3; }
date -Is > run.started
sha256sum $A/opt/FASTag $A/opt-base/FASTag truth.py score.py $A/probe.sh manifest.tsv > run.sha256
awk -F'\t' 'NR == FNR { m[$1] = 1; next } m[$1] && ($2 == "sha1_ok" || $2 == "size_ok") && $4 == 0 { print $1 "\t" $5 }' manifest.tsv stage.tsv > run.list
xargs -d "\n" -P 24 -I{} bash -c 'IFS=$'"'"'\t'"'"' read -r id f <<< "{}"; python3 truth.py "$id" "$f"' < run.list | sort > truth.tsv
bash $A/probe.sh run.list $A/opt/FASTag probe.cand.tsv
bash $A/probe.sh run.list $A/opt-base/FASTag probe.base.tsv
python3 score.py manifest.tsv truth.tsv probe.cand.tsv probe.base.tsv units.tsv summary.txt > score.out 2>&1
date -Is > run.done
