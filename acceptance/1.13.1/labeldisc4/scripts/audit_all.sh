#!/bin/bash
# reporter-scan audit of every staged mzML (no FASTag): audit_all.sh <stage.tsv ...>
cd /scratch/kohlbach/post1131/labeldisc/heldout4
cat "$@" | awk -F"\t" "\$5==0 && \$8!=\"\"{print \$1\"\t\"\$6}" | sort -u | while IFS=$(printf "\t") read id mz; do
  [ -s audit/scan/$id.json ] || echo "$id in/$mz"
done | xargs -P 16 -L 1 bash -c "/ceph/ibmi/abi/oliver/envs/prepdda/bin/python scripts/audit_scan.py \$0 \$1 audit/scan/\$0.json 2 > audit/scan/\$0.log 2>&1"
echo AUDIT_SCAN_DONE
