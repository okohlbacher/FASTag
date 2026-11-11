#!/usr/bin/env bash
set -uo pipefail
task=/scratch/kohlbach/fastag-gap-modes-20261111-0322813
shared=/ceph/ibmi/abi/oliver/fastag-gap-modes-20261111-0322813
export LD_LIBRARY_PATH=/ceph/ibmi/abi/oliver/opt/openms-develop-70cebcd144/lib:/ceph/ibmi/abi/oliver/envs/fastag-omsdev/lib
export OPENMS_TMPDIR="$task/tmp"
mkdir -p "$OPENMS_TMPDIR" "$task/provenance"
date -u +%FT%TZ > "$task/provenance/benchmark-started-utc.txt"
taskset -pc $$ > "$task/provenance/process-affinity.txt"
env | LC_ALL=C sort | sed -n '/^LD_LIBRARY_PATH=/p; /^OPENMS_TMPDIR=/p; /^OMP_/p' > "$task/provenance/runtime-environment.txt"
/ceph/ibmi/abi/oliver/jpr-bench/envs/py/bin/python "$task/benchmark_gap_modes.py" \
  --bench-package "$task/bench-package" \
  --baseline "$task/build-baseline/FASTag" --feature "$task/build-feature/FASTag" \
  --data-root "$task/benchmark" --output "$task/results-dax-32threads" --threads 32
status=$?
date -u +%FT%TZ > "$task/provenance/benchmark-ended-utc.txt"
cp -a "$task/results-dax-32threads" "$task/provenance" "$task/run_dax_benchmark.sh" "$shared/"
printf '%s\n' "$status" > "$task/benchmark-exit-status.txt"
cp "$task/benchmark-exit-status.txt" "$shared/"
exit "$status"
