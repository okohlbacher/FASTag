#!/bin/bash
# Item 1 dev rerun after the four fixes (59492fa2): the 6 PXD045734 donor-4068
# runs, the arguments of item1_dev.sh plus -delta_spectra_out; and once with
# -delta_group 0 -recon_sub_tolerance 0 (the a66ad9d9 behaviour of rows and
# interpretations) to check that it reproduces a66ad9d9's first six columns.
set -uo pipefail
B=/ceph/ibmi/abi/oliver/fastag-deepexam; A=/ceph/ibmi/abi/dont-backup/pride/PXD045734
NEW=/scratch/kohlbach/deep/build/FASTag
O=$B/item1-dev2; mkdir -p $O/run $O/compat
export OPENMS_DATA_PATH=/ceph/ibmi/abi/oliver/opt/openms-develop-70cebcd144/share/OpenMS
FASTA=$A/raw/uniprot-human-22.fasta
ARGS=(-fragment_tolerance 20 -fragment_tolerance_unit ppm -extension 3 -variable_modifications "Oxidation (M)" "Deamidated (N)" "Deamidated (Q)" -recon_fasta $FASTA -recon_localize -threads 32)
echo -e "run\twall_s\tmaxrss_kb" > $O/timing.tsv
for m in $A/mzML/ah_4068_ZW_032115_*_57yo.mzML; do
  n=$(basename ${m%.mzML})
  /usr/bin/time -f "%e %M" -o $O/run/$n.time $NEW -in $m -out $O/run/$n.tags.tsv "${ARGS[@]}" -recon_out $O/run/$n.recon.tsv \
    -delta_out $O/run/$n.delta.tsv -delta_spectra_out $O/run/$n.spectra.tsv > $O/run/$n.log 2>&1 || echo "FAIL run $n"
  echo -e "$n\t$(cat $O/run/$n.time | tr ' ' '\t')" >> $O/timing.tsv
  $NEW -in $m -out /dev/shm/kohlbach-c.tags.tsv "${ARGS[@]}" -recon_out /dev/shm/kohlbach-c.recon.tsv \
    -delta_out $O/compat/$n.delta.tsv -delta_group 0 -recon_sub_tolerance 0 > $O/compat/$n.log 2>&1 || echo "FAIL compat $n"
  cmp -s /dev/shm/kohlbach-c.recon.tsv $B/item1-dev/new/$n.recon.tsv && echo "$n recon_compat_identical" || echo "$n recon_compat_DIFF"
  cmp -s <(cut -f1-6 $O/compat/$n.delta.tsv) <(cut -f1-6 $B/item1-dev/new/$n.delta.tsv) && echo "$n delta6_compat_identical" || echo "$n delta6_compat_DIFF"
  cmp -s $O/run/$n.tags.tsv $B/item1-dev/new/$n.tags.tsv && echo "$n tags_identical" || echo "$n tags_DIFF"
done
rm -f /dev/shm/kohlbach-c.*
date > $O/DONE
