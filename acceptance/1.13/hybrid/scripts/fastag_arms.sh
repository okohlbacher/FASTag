#!/bin/bash
# Hybrid arm: the two FASTag arms of one mzML, one after the other (by first), each under /usr/bin/time -v.
#   fastag_arms.sh <FASTag binary> <mzML> <run dir>
# by   = -ion_series auto                           (hybrid spectra read as b/y: the default reading)
# both = -ion_series auto -ion_series_hybrid both   (the candidate option)
# An arm that has written a FASTAG_RC line is not run again.
set -u
BIN=$1; MZ=$2; D=$3
source /scratch/kohlbach/b113/hdrcharge/env.sh
export OPENMS_DATA_PATH=/ceph/ibmi/abi/oliver/opt/openms-develop-70cebcd144/share/OpenMS OPENBLAS_NUM_THREADS=1
export TMPDIR=/scratch/kohlbach/b113/hybrid/tmp OPENMS_TMPDIR=/scratch/kohlbach/b113/hybrid/tmp
for arm in by both; do
  opt="-ion_series auto"; [ $arm = both ] && opt="-ion_series auto -ion_series_hybrid both"
  mkdir -p $D/$arm
  grep -q '^FASTAG_RC=' $D/$arm/run.log 2>/dev/null && continue
  # shellcheck disable=SC2086
  ( cd $D/$arm && /usr/bin/time -v $BIN -in "$MZ" -out tags.tsv -threads 8 $opt > run.log 2> run.err; echo "FASTAG_RC=$?" >> run.log )
done
