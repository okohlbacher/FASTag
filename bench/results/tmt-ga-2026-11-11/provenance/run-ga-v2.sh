#!/usr/bin/env bash
set -euo pipefail
task=/scratch/kohlbach/fastag-tmt-filter-20261111
export LD_LIBRARY_PATH=/ceph/ibmi/abi/oliver/opt/openms-develop-70cebcd144/lib:/ceph/ibmi/abi/oliver/envs/fastag-omsdev/lib
export OPENMS_TMPDIR="$task/tmp"
export OPENBLAS_NUM_THREADS=1
export OMP_NUM_THREADS=8
unset FASTAG_FULL_PRECISION
/ceph/ibmi/abi/oliver/jpr-bench/envs/py/bin/python "$task/src/bench/tmt_pseudo_filter.py" \
  --datasets-json "$task/datasets.json" \
  --baseline /ceph/ibmi/abi/oliver/fastag-tmt-filter-20261111/bin/FASTag-baseline \
  --feature /ceph/ibmi/abi/oliver/fastag-tmt-filter-20261111/bin/FASTag-ga-v2 \
  --output "$task/results-ga-v2" --threads 8 --reps 3 --length 4 \
  --arms baseline off on auto --steps test run
