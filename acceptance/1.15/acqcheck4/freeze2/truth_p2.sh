#!/bin/bash
# acqcheck4: prep2.sh truth with 2 workers under nice -n 19 (node shared with a timed run); same commands otherwise
set -u
H=/scratch/kohlbach/acc115/acqcheck4/heldout; cd $H
awk -F"\t" '$3 == "md5_ok" && $5 == 0 && $6 != "" { print $1 "\tthermo\t" $6 "\t-" }' stage.tsv > truth.list
xargs -d "\n" -P 2 -I{} bash -c 'IFS=$'"'"'\t'"'"' read -r a b c d <<< "{}"; nice -n 19 python3 -I truth.py "$a" "$b" "$c" "$d"' < truth.list | sort > truth.body
{ python3 -I truth.py --header; cat truth.body; } > truth.tsv
date -Is > truth.done
