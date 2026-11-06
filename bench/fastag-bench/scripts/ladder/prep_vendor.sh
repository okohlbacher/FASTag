#!/bin/bash
# vendor -> mzML (untimed preparation): ThermoRawFileParser 2.0.0 for PXD076528, 7z + mzpeak-convert 0.18.0 --to mzml for PXD054073
set -u
E=/ceph/ibmi/abi/oliver/jpr-bench/envs/trfp/bin; I=/ceph/ibmi/abi/oliver/jpr-bench/inputs; S=/scratch/kohlbach/ladder/in
C=/ceph/ibmi/abi/oliver/opt/mzpeak-convert/0.18.0/mzpeak-convert
cd $S
( s=$(date +%s); $E/thermorawfileparser -i=$I/PXD076528/7673_YD12_P116861_S00_R1.raw -o=$S/PXD076528 -f=2 -L=1-2 > PXD076528/trfp.log 2>&1; echo -e "PXD076528\ttrfp\t$?\t$(( $(date +%s)-s ))s\tThermoRawFileParser $($E/thermorawfileparser --version 2>&1 | tail -1) -f=2 -L=1-2" >> vendor.tsv ) &
( s=$(date +%s); cd PXD054073 && $E/7z x -y $I/PXD054073/HeLa_T2_DDA_E_A_nLC_timspro_R02.d.7z > 7z.log 2>&1; echo -e "PXD054073\t7z\t$?\t$(( $(date +%s)-s ))s" >> ../vendor.tsv
  s=$(date +%s); $C --to mzml -o HeLa_T2_DDA_E_A_nLC_timspro_R02.mzML HeLa_T2_DDA_E_A_nLC_timspro_R02.d > convert_mzml.log 2>&1; echo -e "PXD054073\tmzpeak-convert --to mzml\t$?\t$(( $(date +%s)-s ))s\t$($C --version)" >> ../vendor.tsv ) &
wait
echo done > vendor.done
