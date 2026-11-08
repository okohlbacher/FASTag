#!/bin/bash
# DEV tests of the held-out scorers (acceptance/1.12/scorers). DEV inputs and DEV outputs only: no file of any
# held-out manifest is read (every input below is a DEV run of its item: #2/#6 PXD003531 and PXD001819, #1 the 47
# species DEV runs, #3 the 177 chemistry DEV runs, #7 the E7-02 sweep). Runs on node data with the RC bundle.
# Usage: run_dev_tests.sh <repo mirror> <work dir> [steps: fastag,score]
set -uo pipefail
REPO=$1; W=$2; STEPS=${3:-fastag,score}
S=$REPO/acceptance/1.12/scorers
RC=/scratch/kohlbach/fastag-heldout-1.12/rc-a117801/opt/FASTag
PY=/ceph/ibmi/abi/oliver/jpr-bench/envs/py/bin/python
JB=/ceph/ibmi/abi/oliver/jpr-bench
DEV=/scratch/kohlbach/fastag112-dev
mkdir -p $W/staged/dev $W/runs $W/truth $W/out
export OPENBLAS_NUM_THREADS=1

# ---- inputs (DEV): staged root with links, truth = the paper harness's Sage searches
declare -A IN=( [PXD003531]=$JB/data/PXD003531/20130611_QE3_UPLC10_CFR_SA_OC_T_NO_03_01_01.mzML
                [PXD001819]=$JB/data/PXD001819/UPS1_25000amol_R1.mzML )
declare -A TR=( [PXD003531]=$JB/accuracy/work/runs/PXD003531_QE_NO_03/sage/default/results.sage.tsv
                [PXD001819]=$JB/accuracy/work/runs/PXD001819_UPS1_yeast_LTQ_CID/sage/default/results.sage.tsv )
for p in PXD003531 PXD001819; do
  mkdir -p $W/staged/dev/$p; ln -sf ${IN[$p]} $W/staged/dev/$p/
done

run() { # cfg manifest rel cell input opts...
  local cfg=$1 man=$2 rel=$3 cell=$4 in=$5; shift 5
  local d=$W/runs/$cfg/$man/$rel/$cell; mkdir -p $d
  [ -f $d/run.log ] && grep -q '^FASTAG_RC=0' $d/run.log && return 0
  ( cd $d && $RC -in $in -out tags.tsv -threads 8 "$@" > run.log 2>&1; echo "FASTAG_RC=$?" >> run.log )
}
export -f run; export RC W

if [[ $STEPS == *fastag* ]]; then
  # #6 inputs: charge-stripped copies (the gate's derivation; the PXD003531 copy must equal the gate input)
  for p in PXD003531 PXD001819; do
    b=$(basename ${IN[$p]} .mzML)
    $PY $S/strip_charge.py ${IN[$p]} $W/staged/dev/$p/$b.nocharge.mzML > $W/out/strip_$p.txt
  done
  J=()
  for p in PXD003531 PXD001819; do
    b=$(basename ${IN[$p]} .mzML); rel=dev/$p/$b
    for L in 3 4 5; do
      J+=("run CFG-02-base dev02 $rel L${L}_default ${IN[$p]} -tag_length $L")
      J+=("run CFG-02-cand dev02 $rel L${L}_default ${IN[$p]} -tag_length $L -complement_rule both")
      J+=("run CFG-02-base dev02 $rel L${L}_nodeiso ${IN[$p]} -tag_length $L -no_deisotope")
      J+=("run CFG-02-cand dev02 $rel L${L}_nodeiso ${IN[$p]} -tag_length $L -no_deisotope -complement_rule both")
      J+=("run CFG-06-base dev06 $rel S_L$L $W/staged/dev/$p/$b.nocharge.mzML -tag_length $L")
      J+=("run CFG-06-cand dev06 $rel S_L$L $W/staged/dev/$p/$b.nocharge.mzML -tag_length $L -unknown_charge infer")
    done
    J+=("run CFG-06-base dev06 $rel G_L3 ${IN[$p]} -tag_length 3")
    J+=("run CFG-06-cand dev06 $rel G_L3 ${IN[$p]} -tag_length 3 -unknown_charge infer")
    J+=("run CFG-15B-base dev15B $rel RC ${IN[$p]}")
    J+=("run CFG-15B-cand dev15B $rel RC ${IN[$p]} -ion_series auto")
  done
  printf '%s\n' "${J[@]}" | xargs -P 3 -I{} bash -c '{}'
  # #9 stand-in: the #2 L*_default runs serve as both arms (centroided input: legacy and auto tag the same)
  for p in PXD003531 PXD001819; do
    b=$(basename ${IN[$p]} .mzML); rel=dev/$p/$b
    for L in 3 4 5; do
      for c in CFG-09-base CFG-09-cand; do
        mkdir -p $W/runs/$c/dev09/$rel; ln -sfn $W/runs/CFG-02-base/dev02/$rel/L${L}_default $W/runs/$c/dev09/$rel/L${L}_default
      done
    done
  done
fi

if [[ $STEPS == *score* ]]; then
  for p in PXD003531 PXD001819; do
    b=$(basename ${IN[$p]} .mzML); rel=dev/$p/$b
    for m in dev02 dev06 dev09; do mkdir -p $W/truth/$m/$rel; ln -sf ${TR[$p]} $W/truth/$m/$rel/results.sage.tsv; done
    mkdir -p $W/truth/dev15B/$rel
    $PY $S/tests/sage_as_fragger.py ${TR[$p]} $W/truth/dev15B/$rel/msfragger_by.tsv
  done
  T=$S/tests
  $PY $S/score_item02.py $T dev02 $W/runs $W/truth $W/out/item02 > $W/out/item02.txt 2>&1
  $PY $S/score_item06.py $T dev06 $W/runs $W/truth $W/out/item06 > $W/out/item06.txt 2>&1
  $PY $S/score_item09.py $T $W/runs $W/truth $W/out/item09 --manifest dev09 > $W/out/item09.txt 2>&1
  $PY $S/score_item15B.py $T H1 $W/staged $W/runs $W/truth $W/out/item15B --manifest dev15B > $W/out/item15B.txt 2>&1
  $PY $S/score_item07.py $W/out/item07 --dev-sweep $T/e7-02-sweep.tsv > $W/out/item07.txt 2>&1
  # #1: the 47 DEV species runs; arms base / g_0.01_0.01_5_on / both_g_0.01_0.01_5_on
  $PY $S/tests/dev_layout.py species $REPO $DEV $JB $W > $W/out/layout_species.txt 2>&1
  $PY $S/score_item01.py $REPO/acceptance/1.12 $W/runs $W/truth $JB/species/ref50.fasta $DEV/tax $W/out/item01 \
      --runtable $W/species_runtable.tsv --manifest dev01 > $W/out/item01.txt 2>&1
  # #3: the 177 DEV chemistry runs; CFG-03-base = pass B, CFG-03-cand = pass V2b (+ C alkylation)
  $PY $S/tests/dev_layout.py chem $REPO $DEV $JB $W > $W/out/layout_chem.txt 2>&1
  $PY $S/score_item03.py $REPO/acceptance/1.12 $W/runs $W/out/item03 --manifest dev03 \
      --manifest-tsv $W/chem_runtable.tsv --run-col run_dir > $W/out/item03.txt 2>&1
  $PY $S/tests/check_item03_endpoint.py $REPO $W > $W/out/item03_endpoint_check.txt 2>&1
  echo DEV_TESTS_DONE > $W/out/done.txt
fi
