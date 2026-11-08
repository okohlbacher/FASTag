#!/bin/bash
# after prep_mzpeak.sh: PXD028735 point/chunked mzPeak from the count-patched mzML (untimed preparation)
cd /scratch/kohlbach/ladder/in
while pgrep -f prep_mzpeak.sh >/dev/null; do sleep 20; done
C=/ceph/ibmi/abi/oliver/opt/mzpeak-convert/0.18.0/mzpeak-convert
b=PXD028735/LFQ_timsTOFPro_diaPASEF_Condition_A_Sample_Gamma_01
for L in point chunked; do
  s=$(date +%s); $C --layout $L -q -o $b.$L.mzpeak $b.count.mzML > $b.$L.convert.log 2>&1; rc=$?
  echo -e "$b.count.mzML\t$L\t$rc\t$(( $(date +%s)-s ))s\t$($C --version)" >> convert.tsv
done
