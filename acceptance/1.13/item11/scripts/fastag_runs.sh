#!/bin/bash
# b113-ax DEV: FASTag (feat/b113-ax build) on the PXD018176 UVPD MGFs: arm by (defaults) and arm ax (-ion_series ax).
set -u
W=/scratch/kohlbach/b113/ax; BIN=$W/build/FASTag
E=/ceph/ibmi/abi/oliver/envs/fastag-omsdev
export MAMBA_ROOT_PREFIX=$HOME/micromamba
eval "$(~/.local/bin/micromamba shell hook -s bash)"
micromamba activate $E
export TMPDIR=$W/tmp OPENMS_TMPDIR=$W/tmp
run() { local arm=$1 f=$2; shift 2; local stem=${f%.mgf}; local d=$W/dev/runs/$arm/$stem; mkdir -p $d
  ( cd $d && $BIN -in $W/data/PXD018176/$f -out tags.tsv -threads 4 -fragment_tolerance 15 "$@" > run.log 2>&1; echo "FASTAG_RC=$?" >> run.log ) }
export -f run; export W BIN
for f in $(cd $W/data/PXD018176 && ls UVPD_recal_*.mgf); do echo "by $f"; echo "ax $f -ion_series ax"; done |
  xargs -P 4 -L 1 bash -c 'run "$@"' _
echo DONE > $W/dev/runs/FASTAG_DONE
