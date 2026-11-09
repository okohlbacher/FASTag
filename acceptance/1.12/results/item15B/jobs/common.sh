# #15B H1 held-out runs on node data (PREREG-item15B.md amendment 1, freeze da60823).
S=/scratch/kohlbach/fastag-heldout-1.12          # staged inputs root (manifest fastag_input is relative to it)
R=$S/item15B                                      # runs root $R/runs, truth root $R/truth
SRC=$R/h1/src-da60823                             # git archive of the freeze commit da6082361a40
RCBIN=$S/rc-a117801/opt/FASTag                    # documented wrapper of FASTag.bin
J=/ceph/ibmi/abi/oliver/spextract/tools/MSFragger-4.4.1.jar
PY=/ceph/ibmi/abi/oliver/jpr-bench/envs/py/bin/python3
M=item15B-sets-r2
RUNS="item15B/sets/PXD024621/19072019_D4-3_8175_2hHCD-ETD:set7
item15B/sets/PXD024621/08062020_Nano1_uPAC50_9149_AMPK_2h_DDA_HCD-ETD:set7
item15B/sets/PXD024621/19072019_D4-3_8169_2hHCD-ETD:set7
item15B/sets/PXD009208/LUMOS_SCL-IAH_AR_Control_R4_F0:set9
item15B/sets/PXD009208/LUMOS_SCL-IAH_AR_Olap-H2O2_R3_F2:set9
item15B/sets/PXD009208/LUMOS_SCL-IAH_AR_Olap-H2O2_R2_F6:set9"
check_bins() {
  echo c4c2ad67fcd9106e474f552267f7cdfefe107f394b268bbc236308b773e4d7f3"  "$S/rc-a117801/opt/FASTag.bin | sha256sum -c - || exit 9
  echo 56b15a35060e1aa3b38508eed5e1b21ce697918bad75b450307160c86c652112"  "$J | sha256sum -c - || exit 9
}
