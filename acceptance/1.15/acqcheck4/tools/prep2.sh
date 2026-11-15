#!/bin/bash
# acqcheck4 freeze-2 preparation on node data, after staging (no FASTag binary runs here).
#   prep2.sh truth           truth.py for every staged row (main and backup) -> truth.tsv
#   prep2.sh select <drop>   selection rule (select.py) with the freeze-2 drop list -> audited.prep2.tsv
set -u
H=/scratch/kohlbach/acc115/acqcheck4/heldout; cd $H
[ -e stage.done ] || { echo "staging not finished"; exit 2; }
if [ "$1" = truth ]; then
  awk -F'\t' '$3 == "md5_ok" && $5 == 0 && $6 != "" { print $1 "\tthermo\t" $6 "\t-" }' stage.tsv > truth.list
  xargs -d "\n" -P 6 -I{} bash -c 'IFS=$'"'"'\t'"'"' read -r a b c d <<< "{}"; python3 -I truth.py "$a" "$b" "$c" "$d"' < truth.list | sort > truth.body
  { python3 -I truth.py --header; cat truth.body; } > truth.tsv
  date -Is > truth.done
elif [ "$1" = select ]; then
  python3 -I select.py select manifest.tsv stage.tsv truth.tsv "$2" audited.prep2.tsv > select.out
  date -Is > prep2.done
fi
