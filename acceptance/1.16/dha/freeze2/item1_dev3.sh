#!/bin/bash
# Item 1 hardening (steps 2-4 of REVIEW-path-2026-11-18): the six PXD045734
# donor-4068 development runs ONLY, under the arms of HARDENING.md.
#   main     defaults (1.16b) + -delta_loc_null 7.3, all outputs
#   t1       main at 1 thread (determinism)
#   compat   -delta_loc_model count -delta_loc_min_evidence 1 -delta_isotope_flank any (= 59492fa2)
#   consensus -delta_select consensus
#   count / unique  the other localization models (+ null)
#   blind    no variable modifications
#   entrap   target + shuffled entrapment proteome of equal size
#   iso01    -isotope_error 0 1
set -uo pipefail
B=/ceph/ibmi/abi/oliver/fastag-deepexam; A=/ceph/ibmi/abi/dont-backup/pride/PXD045734
BIN=${BIN:-/scratch/kohlbach/deep/build/FASTag}
O=${O:-$B/item1-dev3}; mkdir -p $O
export OPENMS_DATA_PATH=/ceph/ibmi/abi/oliver/opt/openms-develop-70cebcd144/share/OpenMS
FASTA=$A/raw/uniprot-human-22.fasta
EFASTA=/scratch/kohlbach/deep/entrap/human_entrap.fasta
VM=(-variable_modifications "Oxidation (M)" "Deamidated (N)" "Deamidated (Q)")
BASE=(-fragment_tolerance 20 -fragment_tolerance_unit ppm -extension 3 -recon_localize)
ARMS=${ARMS:-"main t1 compat consensus count unique blind entrap iso01"}
[ -f $O/timing.tsv ] || echo -e "arm\trun\twall_s\tmaxrss_kb" > $O/timing.tsv
for arm in $ARMS; do
  mkdir -p $O/$arm
  for m in $A/mzML/ah_4068_ZW_032115_{UIF,USF,WSF}_{IC,N}_57yo.mzML; do
    n=$(basename ${m%.mzML}); d=$O/$arm
    X=("${BASE[@]}" "${VM[@]}" -recon_fasta $FASTA -threads 32)
    OUTS=(-out /dev/shm/kohlbach-d3.tags.tsv -recon_out /dev/shm/kohlbach-d3.recon.tsv -delta_out $d/$n.delta.tsv -delta_spectra_out $d/$n.spectra.tsv -delta_counts_out $d/$n.counts.tsv)
    case $arm in
      main) OUTS=(-out $d/$n.tags.tsv -recon_out $d/$n.recon.tsv -delta_out $d/$n.delta.tsv -delta_spectra_out $d/$n.spectra.tsv -delta_counts_out $d/$n.counts.tsv); X+=(-delta_loc_null 7.3);;
      t1) X=("${BASE[@]}" "${VM[@]}" -recon_fasta $FASTA -threads 1 -delta_loc_null 7.3);;
      compat) X+=(-delta_loc_model count -delta_loc_min_evidence 1 -delta_isotope_flank any);;
      consensus) X+=(-delta_select consensus -delta_loc_null 7.3);;
      count) X+=(-delta_loc_model count -delta_loc_null 7.3);;
      unique) X+=(-delta_loc_model unique -delta_loc_null 7.3);;
      blind) X=("${BASE[@]}" -recon_fasta $FASTA -threads 32 -delta_loc_null 7.3);;
      entrap) X=("${BASE[@]}" "${VM[@]}" -recon_fasta $EFASTA -recon_min_length 8 -threads 32 -delta_loc_null 7.3);;
      iso01) X+=(-isotope_error 0 1);;
    esac
    /usr/bin/time -f "%e %M" -o $d/$n.time $BIN -in $m "${OUTS[@]}" "${X[@]}" > $d/$n.log 2>&1 || echo "FAIL $arm $n"
    echo -e "$arm\t$n\t$(cat $d/$n.time | tr ' ' '\t')" >> $O/timing.tsv
  done
done
rm -f /dev/shm/kohlbach-d3.*
date > $O/DONE
