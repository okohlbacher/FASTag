#!/bin/bash
# 1.13 item 12 (#16): the single held-out run and scoring of CFG-12-realchimera on node data.
# Refuses to start unless the acceptance checkout, the frozen harness, both binaries and the manifest hash to the
# values committed in PREREG-item12.md / item12/SHA256SUMS. Output: /scratch/kohlbach/b113/chimeric/work/heldout.
set -euo pipefail
ACC=/scratch/kohlbach/b113/chimeric/acc            # acceptance/1.13/ of the PREREG commit (git archive)
H=/scratch/kohlbach/b113/chimeric/frozen-c80faa3   # bench/fastag-bench of feat/b113-chimeric c80faa3 (git archive)
PY=/scratch/kohlbach/fastag112-f4/envs/bench/bin/python
W=/scratch/kohlbach/b113/chimeric/work/heldout
[ -e $W/endpoints_HO.tsv ] && { echo "already scored: $W/endpoints_HO.tsv exists, refusing a second scoring"; exit 3; }
cd $ACC && sha256sum -c --quiet item12/SHA256SUMS.acceptance
cd $H && sha256sum -c --quiet $ACC/item12/SHA256SUMS
echo "8f683f83b21061a30e5a87d0d3b864ceeb99bec5a18c839d0c157606fa6c7d0a  /scratch/kohlbach/b113/chimeric/opt/FASTag" | sha256sum -c --quiet
echo "ebc0b04c6e4a0f71bd5b214fddf97ce0ce4ff0a4be8d9c21f2c148c1670e928a  /scratch/kohlbach/jpr-bench/envs/sage/bin/sage" | sha256sum -c --quiet
mkdir -p $W
cd $H
PYTHONPATH=$H/src $PY -m fastag_bench.cli realchimera all -c $ACC/item12/realchimera-HO.yaml 2>&1 | tee $W/run_heldout.log
echo HELDOUT_DONE | tee -a $W/run_heldout.log
