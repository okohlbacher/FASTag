set -uo pipefail
E=/ceph/ibmi/abi/oliver/envs/fastag-omsdev
P=/ceph/ibmi/abi/oliver/opt/openms-develop-70cebcd144
S=/scratch/kohlbach/b113/nontryptic/heldout/src
B=/scratch/kohlbach/b113/nontryptic/heldout/build
export MAMBA_ROOT_PREFIX=$HOME/micromamba
eval "$(~/.local/bin/micromamba shell hook -s bash)"
micromamba activate $E
export TMPDIR=/dev/shm/kohlbach-tmp OPENMS_TMPDIR=/dev/shm/kohlbach-tmp; mkdir -p $TMPDIR
cmake -S $S -B $B -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_PREFIX_PATH="$P;$E" \
  -DFASTAG_BUILD_TESTS=ON -DFASTAG_BUILD_BENCH=OFF || { echo CONFIGURE_FAILED; touch BUILD_DONE; exit 1; }
ninja -C $B -j 16 -k 0 2>&1 | grep -v "^\[" ; rc=${PIPESTATUS[0]}
echo BUILD_RC=$rc
touch /scratch/kohlbach/b113/nontryptic/heldout/BUILD_DONE
