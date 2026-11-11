#!/usr/bin/env bash
set -euo pipefail
task=/scratch/kohlbach/fastag-tmt-filter-20261111
saved=/ceph/ibmi/abi/oliver/fastag-tmt-filter-20261111
env_prefix=/ceph/ibmi/abi/oliver/envs/fastag-omsdev
sdk=/ceph/ibmi/abi/oliver/opt/openms-develop-70cebcd144
export PATH="$env_prefix/bin:$PATH"
export LD_LIBRARY_PATH="$sdk/lib:$env_prefix/lib"
export OPENMS_TMPDIR="$task/tmp"
date -u
hostname
cat /proc/loadavg
cmake --build "$task/build" --target FASTag tmt_pseudo_test -j 8
ctest --test-dir "$task/build" -R '^tmt_pseudo_test$' --output-on-failure
cp "$task/build/FASTag" "$saved/bin/FASTag-ga-v2"
sha256sum "$saved/bin/FASTag-ga-v2"
