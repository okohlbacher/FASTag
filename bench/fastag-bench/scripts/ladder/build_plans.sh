#!/bin/bash
# Plan files for the FASTag 1.8.0 paper ladder on kim (384 logical CPUs), in the order they run.
# Inputs under $IN (see prep_vendor.sh, prep_mzpeak.sh, chain*.sh, patch_*.py for how they were made).
#   build_plans.sh <plan dir>
# Small runs (PXD003531, PXD076528): full ladder 1..384 x mzML/point/chunked x 3 repetitions.
# Large runs (PXD054073, PXD028735, PXD047793): 4..384 x 3 formats x 3 repetitions; 1 and 2 threads
# on mzML only, 1 repetition (a single 1-thread run of PXD047793 takes about 25 min).
# DirecTag 1.4.21142 and FASTag at the DirecTag paper settings ('matched') at 1/8/32/64/384 threads.
set -eu
P=${1:-plans}; mkdir -p "$P"
IN=${IN:-/scratch/kohlbach/ladder/in}
MP="python3 $(dirname "$0")/make_plan.py"
A=$IN/PXD003531/20130611_QE3_UPLC10_CFR_SA_OC_T_NO_03_01_01
B=$IN/PXD076528/7673_YD12_P116861_S00_R1
C=$IN/PXD054073/HeLa_T2_DDA_E_A_nLC_timspro_R02
D=$IN/PXD028735/LFQ_timsTOFPro_diaPASEF_Condition_A_Sample_Gamma_01
E=$IN/PXD047793/4223_TIMS2_006_2_Slot2-6_1_2877_diatracer
BIG=4,8,16,32,64,128,256,384

{ $MP fastag PXD003531 $A
  $MP matched PXD003531 $A.mzML
  $MP matched PXD003531 $A.mzML --tool directag; } > "$P/01_PXD003531.plan"

{ $MP fastag PXD076528 $B
  $MP matched PXD076528 $B.mzML
  # DirecTag refuses the TRFP mzML (post-2012 CV terms): one run records the failure, the
  # equal-length CV-patched copy (patch_cv.py) is the input both tools read for the head-to-head
  $MP matched PXD076528 $B.mzML --tool directag --threads 8 --reps 1
  $MP matched PXD076528_cvpatch $B.cvpatch.mzML --reps 1
  $MP matched PXD076528_cvpatch $B.cvpatch.mzML --tool directag; } > "$P/02_PXD076528.plan"

big() { # dataset stem
  $MP fastag "$1" "$2" --formats mzML --threads 1,2 --reps 1
  $MP fastag "$1" "$2" --threads $BIG
  $MP matched "$1" "$2.mzML" --threads 1 --reps 1
  $MP matched "$1" "$2.mzML" --threads 8,32,64,384
}
{ big PXD054073 $C
  $MP matched PXD054073 $C.mzML --tool directag --threads 8,64 --reps 1; } > "$P/03_PXD054073.plan"

{ big PXD028735 $D
  # the mzML declares <spectrumList count="0">; the count-patched copy (patch_count.py) feeds mzPeak
  $MP fastag PXD028735_countpatch $D.count --formats mzML --threads 64 --reps 1
  $MP matched PXD028735 $D.mzML --tool directag --threads 64 --reps 1
  $MP matched PXD028735_countpatch $D.count.mzML --tool directag --threads 64 --reps 1; } > "$P/04_PXD028735.plan"

{ big PXD047793 $E
  $MP matched PXD047793 $E.mzML --tool directag --threads 384,64,32 --reps 1
  for rep in 1 2 3; do
    printf 'fastag\toutsp_none\tPXD047793\tmzML\t%s\t64\t%s\t\n' "$E.mzML" $rep
    printf 'fastag\toutsp_mzml\tPXD047793\tmzML\t%s\t64\t%s\t-out_spectra spectra.mzML\n' "$E.mzML" $rep
    printf 'fastag\toutsp_mzpeak\tPXD047793\tmzML\t%s\t64\t%s\t-out_spectra spectra.mzpeak\n' "$E.mzML" $rep
  done; } > "$P/05_PXD047793.plan"
wc -l "$P"/*.plan
