set -uo pipefail
D=/scratch/kohlbach/b113/hdrcharge/dev; cd $D; source ../env.sh
B=/scratch/kohlbach/b113/hdrcharge/frozen/FASTag; JB=/ceph/ibmi/abi/oliver/jpr-bench
declare -A IN=( [PXD003531]=$JB/data/PXD003531/20130611_QE3_UPLC10_CFR_SA_OC_T_NO_03_01_01.mzML [PXD001819]=$JB/data/PXD001819/UPS1_25000amol_R1.mzML )
declare -A OPT=( [PXD003531]="" [PXD001819]="-fragment_tolerance 0.5 -fragment_tolerance_unit Da" )
for p in PXD003531 PXD001819; do for in in orig pert; do
  src=${IN[$p]}; [ $in = pert ] && src=$D/$p/pert.mzML
  d=$D/$p/$in/final; mkdir -p $d
  ( cd $d && $B -in $src -out tags.tsv -threads 16 ${OPT[$p]} -check_header_charge warn -check_header_out hc.tsv > log 2>&1; echo FASTAG_RC=$? >> log; rm -f tags.tsv ) &
done; done; wait; echo done > $D/final.done
