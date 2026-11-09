#!/bin/bash
# held-out runs of CFG-census-triage-113 (acceptance/1.13 f054006), one after another, 8 threads
cd /scratch/kohlbach/b113/census
M=acc/1.13/census/../../1.13/census
for r in PXD003903:PT4530-6 PXD016143:1DLC071619QE_NET_withoutDNAse_Protifi_NET2 PXD017427:QE9884 PXD034582:gamma6_DDA PXD037976:OA7A-2 PXD069084:1D2_pH5; do
  p=${r%%:*}; s=${r#*:}
  echo "RUN $p $(date -Is)"
  bash acc/1.13/census/scorers/run_census_triage.sh $PWD/heldout/$p/$s.mzML $PWD/heldout-runs/$p 8 > heldout-runs.$p.log 2>&1
  tail -1 heldout-runs.$p.log
done
echo HELDOUT_RUNS_DONE
