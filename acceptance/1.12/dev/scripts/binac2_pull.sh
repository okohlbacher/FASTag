#!/bin/bash
# Pull BinAC2 species DEV results back to data (direct, key on data) and compare or merge.
#   binac2_pull.sh check <runs subdir> <ref runs subdir>   pull <runs subdir>, compare every species.tsv with the
#                                                         same arm under <ref runs subdir> (sha256), print SAME/DIFF
#   binac2_pull.sh merge <runs subdir>                     pull into species/runs_binac2, then copy every arm
#                                                         directory that has no species.tsv yet into species/runs
set -u
K="ssh -o BatchMode=yes -i $HOME/.ssh/binac2_ibmi_ed25519"; H=tu_iisko01@login.binac2.uni-tuebingen.de
W=/pfs/10/work/tu_iisko01-fastag112/root/scratch/kohlbach/fastag112-dev
DEV=/scratch/kohlbach/fastag112-dev
mode=$1; sub=$2
case $mode in
  check)
    ref=$3
    rsync -rlt -e "$K" "$H:$W/$sub/" "$DEV/$sub/" || exit 1
    same=0; diff=0
    for f in "$DEV/$sub"/*/*/species.tsv; do
      rel=${f#$DEV/$sub/}; g=$DEV/$ref/$rel
      if [ -f "$g" ] && [ "$(sha256sum < "$f")" = "$(sha256sum < "$g")" ]; then same=$((same + 1)); else diff=$((diff + 1)); echo "DIFF $rel"; fi
    done
    echo "species.tsv SAME $same DIFF $diff" ;;
  merge)
    rsync -rlt -e "$K" "$H:$W/$sub/" "$DEV/species/runs_binac2/" || exit 1
    n=0; skip=0
    for d in "$DEV/species/runs_binac2"/*/*/; do
      [ -f "$d/species.tsv" ] || continue
      rel=${d#$DEV/species/runs_binac2/}; t=$DEV/species/runs/$rel
      if [ -f "$t/species.tsv" ]; then skip=$((skip + 1)); continue; fi
      mkdir -p "$t"; cp -p "$d"/* "$t"/; n=$((n + 1))
    done
    for m in "$DEV/species/runs_binac2"/*/meta.json; do
      r=$(basename "$(dirname "$m")"); [ -f "$DEV/species/runs/$r/meta.json" ] || cp -p "$m" "$DEV/species/runs/$r/"
    done
    cp -p "$DEV/species/runs_binac2"/driver-binac2-*.log "$DEV/species/runs/" 2>/dev/null
    echo "merged $n arms, $skip already present" ;;
esac
