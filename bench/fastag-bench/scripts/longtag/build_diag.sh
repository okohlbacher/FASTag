#!/bin/bash
# Diagnostic build of FASTag v1.9.0 (+ env-var knobs, LONGTAG DIAGNOSTIC) for the tag-length-3 analysis.
set -uo pipefail
E=/ceph/ibmi/abi/oliver/envs/fastag-omsdev
P=/ceph/ibmi/abi/oliver/opt/openms-develop-70cebcd144
S=${SRC:-/scratch/kohlbach/longtag/src}
B=/scratch/kohlbach/longtag/build
export MAMBA_ROOT_PREFIX=$HOME/micromamba
eval "$(~/.local/bin/micromamba shell hook -s bash)"
micromamba activate $E
export TMPDIR=/dev/shm/kohlbach-tmp OPENMS_TMPDIR=/dev/shm/kohlbach-tmp; mkdir -p $TMPDIR
if [ ! -f $B/build.ninja ]; then
cmake -S $S -B $B -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_PREFIX_PATH="$P;$E" || { echo CONFIGURE_FAILED; exit 1; }
fi
ninja -C $B -j 24 FASTag 2>&1 | grep -v "^\[" ; rc=${PIPESTATUS[0]}
echo BUILD_RC=$rc
