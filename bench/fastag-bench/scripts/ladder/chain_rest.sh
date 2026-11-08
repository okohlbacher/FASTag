#!/bin/bash
# PXD076528 and PXD054073 mzML -> point/chunked mzPeak (untimed preparation)
cd /scratch/kohlbach/ladder/in
C=/ceph/ibmi/abi/oliver/opt/mzpeak-convert/0.18.0/mzpeak-convert
conv() { b=${1%.mzML}; for L in point chunked; do s=$(date +%s); $C --layout $L -q -o $b.$L.mzpeak $1 > $b.$L.convert.log 2>&1; rc=$?
  echo -e "$1\t$L\t$rc\t$(( $(date +%s)-s ))s\t$($C --version)" >> convert.tsv; done; }
conv PXD076528/7673_YD12_P116861_S00_R1.mzML
while [ ! -f vendor.done ]; do sleep 20; done
conv PXD054073/HeLa_T2_DDA_E_A_nLC_timspro_R02.mzML
