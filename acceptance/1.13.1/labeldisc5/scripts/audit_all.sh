#!/bin/bash
# held-out test 5: reporter-scan audit of every staged mzML (no FASTag): audit_all.sh <stage.tsv ...>   (the test-4 script, directory changed, 12 jobs)
cd /scratch/kohlbach/post1131/labeldisc/heldout5 || exit 1
mkdir -p audit/scan
cat "$@" | awk -F"\t" "\$5==0 && \$8!=\"\"{print \$1\"\t\"\$6}" | sort -u | while IFS=$(printf "\t") read id mz; do
  [ -s audit/scan/$id.json ] || echo "$id in/$mz"
done | xargs -P 12 -L 1 bash -c "/ceph/ibmi/abi/oliver/envs/prepdda/bin/python -I scripts/audit_scan.py \$0 \$1 audit/scan/\$0.json 2 > audit/scan/\$0.log 2>&1"
echo AUDIT_SCAN_DONE
