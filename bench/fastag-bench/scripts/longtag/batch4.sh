#!/bin/bash
# Batch 4: timsTOF PXD054073 (supporting data set), build2, then scoring.
cd /scratch/kohlbach/longtag
export FASTAG_BIN=/scratch/kohlbach/longtag/build2/FASTag
R=./run_diag.sh; DS=PXD054073
$R b2_base $DS
FASTAG_DIAG_COMPL_CHARGE=1 $R zc $DS
FASTAG_DIAG_CPAIR=3 $R cpair3 $DS
FASTAG_DIAG_COMPL_CHARGE=1 FASTAG_DIAG_CPAIR=3 $R zc_cpair3 $DS
B=/ceph/ibmi/abi/oliver/jpr-bench; PY=$B/envs/py/bin/python; H=$B/accuracy/fastag-bench-v190/src
A=$B/accuracy/work/runs; F=$B/accuracy/work-v190/runs; ds=PXD054073_HeLa_ddaPASEF_R02; RR=/scratch/kohlbach/longtag/runs/$DS
sha256sum $F/$ds/fastag/fastag_matched/tags.tsv | cut -c1-16 > $RR/release_sha.txt
$PY $B/longtag/scripts/lt_score.py $H $ds $A/$ds/sage/default/results.sage.tsv $(ls $A/$ds/directag/directag_matched/*.tags) \
  $F/$ds/fastag/fastag_matched/tags.tsv $B/longtag/out/reruns_$DS.tsv b2_base=$RR/b2_base/tags.tsv zc=$RR/zc/tags.tsv cpair3=$RR/cpair3/tags.tsv zc_cpair3=$RR/zc_cpair3/tags.tsv
$PY $B/longtag/scripts/lt_score_strata.py $H $B/longtag/out/disc_$ds.tsv.gz $A/$ds/sage/default/results.sage.tsv $B/longtag/out/strata_$DS.tsv \
  base=$RR/b2_base/tags.tsv zc=$RR/zc/tags.tsv zc_cpair3=$RR/zc_cpair3/tags.tsv
echo BATCH4_DONE
