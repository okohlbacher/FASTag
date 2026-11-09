#!/bin/bash
# 1.13 item 12 (#16) held-out staging on node data: copy each run's mzML and search FASTA into
# /scratch/kohlbach/b113/chimeric/heldout/<run_id>/, hash the copies (sha256) and the raw files in place
# (sha256 and sha1; raw files stay where they are, read-only). No FASTag, Sage or scorer runs here.
set -euo pipefail
H=/scratch/kohlbach/b113/chimeric/heldout
V=/ceph/ibmi/abi/oliver/prose-auto-20261029/valset_all
B=/ceph/ibmi/abi/oliver/prose-auto-20261029/bench2
J=/ceph/ibmi/abi/oliver/jpr-bench/data
PANEL=/ceph/ibmi/abi/oliver/prose-auto-20261029/panel
HUMAN=$J/PXD054073/UP000005640_9606.fasta
mkdir -p $H
# run_id raw mzml fasta
cat > $H/sources.tsv <<T
HO-PXD066944-OFF03	$B/raw/PXD066944/TEMP_20250307_AST0_NEO5_JVO_MV50_DR_100SPD_10ng_HEK_Ref_DDA_2Th_1p5ms_10ms_v1Ref_cycle_OFF-03.raw	$B/mzml/PXD066944/TEMP_20250307_AST0_NEO5_JVO_MV50_DR_100SPD_10ng_HEK_Ref_DDA_2Th_1p5ms_10ms_v1Ref_cycle_OFF-03.mzML	$HUMAN
HO-PXD076528-7673	$J/PXD076528/7673_YD12_P116861_S00_R1.raw	$J/PXD076528/7673_YD12_P116861_S00_R1.mzML	$HUMAN
HO-PXD009612-MW3	$V/raw/PXD009612/170928_MW_3.raw	$V/in/PXD009612/170928_MW_3.mzML	$PANEL/Danio_rerio.fasta
HO-PXD040230-S2R1	$V/raw/PXD040230/20210629_Sample2red_CTRworms_repl1.raw	$V/in/PXD040230/20210629_Sample2red_CTRworms_repl1.mzML	$PANEL/Caenorhabditis_elegans.fasta
HO-PXD049370-185	$V/raw/PXD049370/201111_13_Orbi1_KN_SER_G90_T115_Paternoga_ysgA_185.raw	$V/in/PXD049370/201111_13_Orbi1_KN_SER_G90_T115_Paternoga_ysgA_185.mzML	$PANEL/Bacillus_subtilis.fasta
T
printf 'run_id\traw\traw_bytes\traw_sha256\traw_sha1\tmzml_src\tmzml\tmzml_bytes\tmzml_sha256\tmzml_src_sha256\tfasta_src\tfasta\tfasta_sha256\n' > $H/staged.tsv
while IFS=$'\t' read -r id raw mz fa; do
  d=$H/$id; mkdir -p $d
  cp -p "$mz" $d/; cp -p "$fa" $d/
  m=$d/$(basename "$mz"); f=$d/$(basename "$fa")
  [ -f "$(dirname "$mz")/trfp.log" ] && cp -p "$(dirname "$mz")/trfp.log" $d/trfp.log
  chmod a-w $m $f
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$id" "$raw" "$(stat -c %s "$raw")" \
    "$(sha256sum "$raw" | cut -d' ' -f1)" "$(sha1sum "$raw" | cut -d' ' -f1)" "$mz" "$m" "$(stat -c %s "$m")" \
    "$(sha256sum "$m" | cut -d' ' -f1)" "$(sha256sum "$mz" | cut -d' ' -f1)" "$fa" "$f" "$(sha256sum "$f" | cut -d' ' -f1)" >> $H/staged.tsv
done < $H/sources.tsv
echo STAGE_DONE
