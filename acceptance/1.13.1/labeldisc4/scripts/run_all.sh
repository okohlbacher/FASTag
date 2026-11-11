#!/bin/bash
# held-out test 4: the commands of PREREG-labeldisc4.md, once. Launch only after freeze 2 is pushed.
cd /scratch/kohlbach/post1131/labeldisc/heldout4 || exit 1
D=/scratch/kohlbach/fastag-labeldisc/src/data/digest
python3 -I scripts/run_parammedic.py manifests/audited.tsv /scratch/kohlbach/fastag-labeldisc/heldout3/venv27/bin/param-medic pm 8 > pm.log 2>&1 &
for P in b2:e999342af40c1dfa66b314f838d0245a8b718a0346afc9dd3f4c911769ecb262 f2:9179c6d34c60abf13a5ea2e0e1f140899f3af4de2e0432830bd4039f9324bf55 m0:c49bb6594feb6891821745b358d632b8d5d80469d82db8d8cfd072c356fb8926; do
  X=${P%%:*}
  python3 -I scripts/run_heldout4.py manifests/audited.tsv ../opt-$X/FASTag ../opt-$X/FASTag.bin ${P#*:} $D runs-$X 5 > runs-$X.log 2>&1
  echo "$X rc=$?" >> run_all.status
done
wait
for X in b2 f2 m0; do python3 -I scripts/score_labeldisc3.py manifests/audited.tsv runs-$X pm/pm.tsv score-$X > score-$X.log 2>&1; echo "score $X rc=$?" >> run_all.status; done
python3 -I scripts/verdict_labeldisc4.py score-b2 score-f2 runs-f2 verdict.md > verdict.log 2>&1; echo "verdict rc=$?" >> run_all.status
touch run_all.done
