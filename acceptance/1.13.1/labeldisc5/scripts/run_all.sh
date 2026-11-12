#!/bin/bash
# held-out test 5: the commands of PREREG-labeldisc5.md, once. Launch only after freeze 2 is pushed.
# 5 FASTag jobs of 8 threads (40 threads), arm t2 (candidate) then arm t0 (baseline); then scoring and verdict once.
cd /scratch/kohlbach/post1131/labeldisc/heldout5 || exit 1
D=/scratch/kohlbach/fastag-labeldisc/src/data/digest
for P in t2:4f9db2a7e3651e1216a64bf7887bc967e157417d5c6f3f75d12c5753baf4a61c t0:9e32b73ff63f1c93ae84a658d44039488a8f23db7165a5a5d06084740f3aea9c; do
  X=${P%%:*}
  python3 -I scripts/run_heldout5.py manifests/audited.tsv ../opt-$X/FASTag ../opt-$X/FASTag.bin ${P#*:} $D runs-$X 5 > runs-$X.log 2>&1
  echo "$X rc=$?" >> run_all.status
done
for X in t2 t0; do python3 -I scorers/score_labeldisc3.py manifests/audited.tsv runs-$X - score-$X > score-$X.log 2>&1; echo "score $X rc=$?" >> run_all.status; done
python3 -I scorers/verdict_labeldisc5.py manifests/audited.tsv score-t2 score-t0 runs-t2 verdict.md > verdict.log 2>&1; echo "verdict rc=$?" >> run_all.status
touch run_all.done
