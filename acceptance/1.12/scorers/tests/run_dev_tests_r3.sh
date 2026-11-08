#!/bin/bash
# Round 3 DEV tests (DECISIONS-2026-11-08 #2): the 0.5 Da ion-trap twins (-it05) on the DEV ion-trap run PXD001819
# (#2/#6 DEV, LTQ Orbitrap Velos, ion-trap MS2), both arms of #2 and #6, and the amended scorers 02/06/09 on
# PXD001819 (it05 runs) + PXD003531 (QE, the 20 ppm runs of run_dev_tests.sh, linked). DEV inputs only; no file of
# any held-out manifest is read. Node data, RC bundle. Step 'floor' scores with INFO_FLOOR_PCT as set in acclib.py;
# the floor value was read from the out0 run (INFO_FLOOR_PCT = None) of the ion-trap cells (cells_i.tsv).
# Usage: run_dev_tests_r3.sh <repo mirror> <old work dir of run_dev_tests.sh> <work dir> [fastag,link,score]
set -uo pipefail
REPO=$1; OLD=$2; W=$3; STEPS=${4:-fastag,link,score}
S=$REPO/acceptance/1.12/scorers; T=$S/tests
RC=/scratch/kohlbach/fastag-heldout-1.12/rc-a117801/opt/FASTag
PY=/ceph/ibmi/abi/oliver/jpr-bench/envs/py/bin/python
IN=/ceph/ibmi/abi/oliver/jpr-bench/data/PXD001819/UPS1_25000amol_R1.mzML
NC=$OLD/staged/dev/PXD001819/UPS1_25000amol_R1.nocharge.mzML
TOL="-fragment_tolerance 0.5 -fragment_tolerance_unit Da"
rel=dev/PXD001819/UPS1_25000amol_R1
qrel=dev/PXD003531/20130611_QE3_UPLC10_CFR_SA_OC_T_NO_03_01_01
export OPENBLAS_NUM_THREADS=1
mkdir -p $W/runs $W/truth $W/out
run() { local cfg=$1 man=$2 cell=$3 in=$4; shift 4
  local d=$W/runs/$cfg/$man/$rel/$cell; mkdir -p $d
  [ -f $d/run.log ] && grep -q '^FASTAG_RC=0' $d/run.log && return 0
  ( cd $d && $RC -in $in -out tags.tsv -threads 8 "$@" > run.log 2>&1; echo "FASTAG_RC=$?" >> run.log ); }
export -f run; export RC W rel
if [[ $STEPS == *fastag* ]]; then
  J=()
  for L in 3 4 5; do
    J+=("run CFG-02-base-it05 dev02 L${L}_default $IN -tag_length $L $TOL")
    J+=("run CFG-02-cand-it05 dev02 L${L}_default $IN -tag_length $L -complement_rule both $TOL")
    J+=("run CFG-02-base-it05 dev02 L${L}_nodeiso $IN -tag_length $L -no_deisotope $TOL")
    J+=("run CFG-02-cand-it05 dev02 L${L}_nodeiso $IN -tag_length $L -no_deisotope -complement_rule both $TOL")
    J+=("run CFG-06-base-it05 dev06 S_L$L $NC -tag_length $L $TOL")
    J+=("run CFG-06-cand-it05 dev06 S_L$L $NC -tag_length $L -unknown_charge infer $TOL")
  done
  J+=("run CFG-06-base-it05 dev06 G_L3 $IN -tag_length 3 $TOL")
  J+=("run CFG-06-cand-it05 dev06 G_L3 $IN -tag_length 3 -unknown_charge infer $TOL")
  printf '%s\n' "${J[@]}" | xargs -P 3 -I{} bash -c '{}'
fi
if [[ $STEPS == *link* ]]; then
  for c in CFG-02-base:dev02 CFG-02-cand:dev02 CFG-06-base:dev06 CFG-06-cand:dev06; do
    cfg=${c%%:*}; m=${c##*:}; mkdir -p $W/runs/$cfg/$m/dev/PXD003531; ln -sfn $OLD/runs/$cfg/$m/$qrel $W/runs/$cfg/$m/$qrel; done
  for m in dev02 dev06 dev09; do for r in $qrel $rel; do mkdir -p $W/truth/$m/$(dirname $r); ln -sfn $OLD/truth/$m/$r $W/truth/$m/$r; done; done
  for L in 3 4 5; do   # #9 stand-in as run_dev_tests.sh: the #2 base L*_default runs serve as both arms
    for c in CFG-09-base CFG-09-cand; do mkdir -p $W/runs/$c/dev09/$qrel; ln -sfn $OLD/runs/CFG-02-base/dev02/$qrel/L${L}_default $W/runs/$c/dev09/$qrel/L${L}_default; done
    for c in CFG-09-base-it05 CFG-09-cand-it05; do mkdir -p $W/runs/$c/dev09/$rel; ln -sfn $W/runs/CFG-02-base-it05/dev02/$rel/L${L}_default $W/runs/$c/dev09/$rel/L${L}_default; done
  done
fi
if [[ $STEPS == *score* ]]; then
  $PY $S/score_item02.py $T dev02 $W/runs $W/truth $W/out/item02 > $W/out/item02.txt 2>&1
  $PY $S/score_item06.py $T dev06 $W/runs $W/truth $W/out/item06 > $W/out/item06.txt 2>&1
  $PY $S/score_item09.py $T $W/runs $W/truth $W/out/item09 --manifest dev09 > $W/out/item09.txt 2>&1
  echo DEV_TESTS_R3_DONE > $W/out/done.txt
fi
