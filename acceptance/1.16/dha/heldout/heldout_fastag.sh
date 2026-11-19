#!/bin/bash
# PREREG-dha AMENDMENT-2 §1 on the held-out runs: item1_dev3.sh's arms
#   blind  (gating)   no -variable_modifications
#   main   (informed, reported) Oxidation (M), Deamidated (N), Deamidated (Q)
#   entrap (reported) informed + shuffled entrapment proteome, -recon_min_length 8
# with the arguments of item1_dev3.sh (freeze2) unchanged; only the run list and paths differ.
# usage: heldout_fastag.sh <run list> <mzML dir> <out dir>
set -uo pipefail
LIST=$1; MZ=$2; O=$3
A=/ceph/ibmi/abi/dont-backup/pride/PXD045734
BIN=${BIN:-/scratch/kohlbach/dha-build/FASTag}
export OPENMS_DATA_PATH=/ceph/ibmi/abi/oliver/opt/openms-develop-70cebcd144/share/OpenMS
FASTA=$A/raw/uniprot-human-22.fasta
EFASTA=/scratch/kohlbach/deep/entrap/human_entrap.fasta
VM=(-variable_modifications "Oxidation (M)" "Deamidated (N)" "Deamidated (Q)")
BASE=(-fragment_tolerance 20 -fragment_tolerance_unit ppm -extension 3 -recon_localize)
mkdir -p $O
[ -f $O/timing.tsv ] || echo -e "arm\trun\twall_s\tmaxrss_kb" > $O/timing.tsv
for arm in blind main entrap; do
  mkdir -p $O/$arm
  while read -r n; do
    m=$MZ/$n.mzML; d=$O/$arm
    OUTS=(-out $d/$n.tags.tsv -recon_out $d/$n.recon.tsv -delta_out $d/$n.delta.tsv -delta_spectra_out $d/$n.spectra.tsv -delta_counts_out $d/$n.counts.tsv)
    case $arm in
      main)   X=("${BASE[@]}" "${VM[@]}" -recon_fasta $FASTA -threads 32 -delta_loc_null 7.3);;
      blind)  X=("${BASE[@]}" -recon_fasta $FASTA -threads 32 -delta_loc_null 7.3);;
      entrap) X=("${BASE[@]}" "${VM[@]}" -recon_fasta $EFASTA -recon_min_length 8 -threads 32 -delta_loc_null 7.3)
              OUTS=(-out /dev/shm/kohlbach-ho.tags.tsv -recon_out /dev/shm/kohlbach-ho.recon.tsv -delta_out $d/$n.delta.tsv -delta_spectra_out $d/$n.spectra.tsv -delta_counts_out $d/$n.counts.tsv);;
    esac
    /usr/bin/time -f "%e %M" -o $d/$n.time $BIN -in $m "${OUTS[@]}" "${X[@]}" > $d/$n.log 2>&1 || echo "FAIL $arm $n"
    echo -e "$arm\t$n\t$(cat $d/$n.time | tr ' ' '\t')" >> $O/timing.tsv
  done < $LIST
done
rm -f /dev/shm/kohlbach-ho.*
date > $O/DONE
