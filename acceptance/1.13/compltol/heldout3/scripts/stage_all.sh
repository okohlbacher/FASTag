#!/bin/bash
# compltol held-out 3: stage every candidate of select/candidates.tsv (download, conversion, truth). No FASTag run.
#   stage_all.sh <heldout3 dir of a git archive of the freeze-1 commit>
# Downloads: 4 at a time (node data is shared). Conversion + Sage: 2 at a time, 6 threads each (<= 12 threads).
set -u
D=$(cd "$1" && pwd); H=${CT_H3:-/scratch/kohlbach/acc114/compltol3}
mkdir -p "$H/qual" "$H/logs"
(cd /ceph/ibmi/abi/oliver/prose-auto-20261029/panel && sha256sum *.fasta) > "$H/fasta.sha256"
tail -n +2 "$D/select/candidates.tsv" | cut -f3 | xargs -P 4 -I{} bash -c "bash '$D/scripts/stage.sh' download '$D' {} > '$H/logs/download.{}.log' 2>&1"
tail -n +2 "$D/select/candidates.tsv" | cut -f3 | xargs -P 2 -I{} bash -c "bash '$D/scripts/stage.sh' convert '$D' {} > '$H/logs/convert.{}.log' 2>&1"
{ head -1 "$(ls $H/qual/*.tsv | head -1)"; for q in $H/qual/PXD*.tsv; do tail -n +2 "$q"; done | sort -t$'\t' -k1,1 -k2,2n; } > "$H/staged.tsv"
echo STAGE_ALL_DONE > "$H/stage_all.done"
