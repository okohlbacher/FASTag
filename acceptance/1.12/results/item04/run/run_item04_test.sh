#!/bin/bash
# FASTag 1.12 #4 held-out scoring (test split), once. PREREG-item04.md on acceptance/1.12 (ed0a7e0).
# Step order: pool-truth sage-modes chimera-build run score collect (chimera-build before run so that
# 'run' also tags the chimeras, as the DEV run did; the PREREG loop listed run before chimera-build).
set -euo pipefail
H=/scratch/kohlbach/fastag112-f4/ho-test-7ef0f33
B=$H/bench/fastag-bench
C=$H/acceptance/1.12/scorers/item04/unidentified-test.yaml
S=/scratch/kohlbach/fastag-heldout-1.12
U=/scratch/kohlbach/fastag112-f4/unid
PY=/scratch/kohlbach/fastag112-f4/envs/bench/bin/python
echo "=== start $(date -Is) host $(hostname)"
echo "ab7e64450bcb7f063f41d50a26a5b0dbe6667d1c60e5b23f89eb44442dfb2b2d  $C" | sha256sum -c
(cd $H && sha256sum -c sums04.txt)
echo "c4c2ad67fcd9106e474f552267f7cdfefe107f394b268bbc236308b773e4d7f3  $S/rc-a117801/opt/FASTag.bin" | sha256sum -c
while IFS=$'\t' read pool rel sha; do
  [ "$pool" = pool ] && continue
  src=$S/$rel; dst=$U/data/$pool/$(basename $rel)
  mkdir -p $U/data/$pool
  [ -e $dst ] || ln $src $dst
  echo "$sha  $dst" | sha256sum -c
done < $H/m04.tsv
cd $B
export PYTHONPATH=src OMP_NUM_THREADS=4
for step in pool-truth sage-modes chimera-build run score collect; do
  echo "=== $step $(date -Is)"
  taskset -c 200-223 $PY -m fastag_bench.cli unidentified $step -c $C --split test
done
echo "=== DONE $(date -Is)"
