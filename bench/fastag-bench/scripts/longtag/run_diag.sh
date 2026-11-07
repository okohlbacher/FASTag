#!/bin/bash
# run_diag.sh NAME DATASET [extra FASTag args...]; env knobs (FASTAG_DIAG_*) pass through.
# Matched settings of the paper (tag length 3), diagnostic FASTag 1.9.0 build.
set -uo pipefail
NAME=$1; DS=$2; shift 2
E=/ceph/ibmi/abi/oliver/envs/fastag-omsdev
P=/ceph/ibmi/abi/oliver/opt/openms-develop-70cebcd144
BIN=${FASTAG_BIN:-/scratch/kohlbach/longtag/build/FASTag}
D=/ceph/ibmi/abi/oliver/jpr-bench/data
MODS=()
case $DS in
  PXD076528) IN=$D/PXD076528/7673_YD12_P116861_S00_R1.mzML; TOL=0.02;;
  PXD001819) IN=$D/PXD001819/UPS1_25000amol_R1.mzML; TOL=0.5;;
  PXD003531) IN=$(ls $D/PXD003531/*.mzML | head -1); TOL=0.02;;
  PXD054073) IN=$D/PXD054073/HeLa_T2_DDA_E_A_nLC_timspro_R02.mzML; TOL=0.02;;
  PXD000001) IN=$(ls $D/PXD000001/*.mzML | head -1); TOL=0.02; MODS=(-fixed_modifications "Methylthio (C)" "TMT6plex (K)" "TMT6plex (N-term)");;
esac
O=/scratch/kohlbach/longtag/runs/$DS/$NAME; mkdir -p $O
export LD_LIBRARY_PATH=$P/lib:$E/lib:${LD_LIBRARY_PATH:-}
export OPENMS_DATA_PATH=$P/share/OpenMS
CMD="$BIN -in $IN -out $O/tags.tsv -threads 16 ${MODS[*]} -tag_length 3 -max_tags 50 -max_peaks ${MAXP:-100} -peaks_per_window ${PPW:-0} -gaps 0 ${DEISO:--no_deisotope} -fragment_tolerance ${FTOL:-$TOL} -fragment_tolerance_unit Da $*"
env | grep -E "FASTAG_DIAG|^DEISO|^FTOL|^MAXP|^PPW" > $O/env.txt || true
echo "$CMD" > $O/command.txt
$BIN -in $IN -out $O/tags.tsv -threads 16 "${MODS[@]}" -tag_length 3 -max_tags 50 -max_peaks ${MAXP:-100} -peaks_per_window ${PPW:-0} -gaps 0 ${DEISO:--no_deisotope} -fragment_tolerance ${FTOL:-$TOL} -fragment_tolerance_unit Da "$@" > $O/run.log 2>&1
echo "rc=$?" >> $O/run.log
sha256sum $O/tags.tsv | cut -c1-16 > $O/sha.txt
