#!/bin/bash
# acqcheck3 freeze-2 preparation on node data, after staging (no FASTag binary runs here):
# backup rule (select.py), truth for every staged selected file (truth.py, vendor metadata), merged audited.tsv.
set -u
H=/scratch/kohlbach/b114/acqcheck3/heldout; cd $H
[ -e stage.data.done ] && [ -e stage.sciex.done ] || { echo "staging not finished"; exit 2; }
python3 -I select.py select manifest.tsv stage.tsv stage_sciex.tsv selected.tsv > select.out
awk -F'\t' 'NR == 1 { for (i = 1; i <= NF; i++) c[$i] = i; next }
  $c["staged"] == "yes" { raw = ($c["route"] == "bruker") ? "'$H'/files/" $c["id"] "/raw/" $c["file"] : "-";
                          print $c["id"] "\t" $c["route"] "\t" $c["input"] "\t" raw }' selected.tsv > truth.list
xargs -d "\n" -P 6 -I{} bash -c 'IFS=$'"'"'\t'"'"' read -r a b c d <<< "{}"; python3 -I truth.py "$a" "$b" "$c" "$d"' < truth.list | sort > truth.body
{ python3 -I truth.py --header; cat truth.body; } > truth.tsv
python3 -I select.py merge selected.tsv truth.tsv audited.tsv >> select.out
date -Is > prep2.done
