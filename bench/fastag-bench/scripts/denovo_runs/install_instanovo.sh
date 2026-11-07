set -x
export MAMBA_ROOT_PREFIX=/scratch/kohlbach/mamba-root PIP_CACHE_DIR=/scratch/kohlbach/pipcache TMPDIR=/scratch/kohlbach/tmp
E=/ceph/ibmi/abi/oliver/jpr-bench/envs
$HOME/.local/bin/micromamba create -y -p $E/instanovo-gpu -c conda-forge python=3.12 pip
$E/instanovo-gpu/bin/pip install torch==2.8.0 --index-url https://download.pytorch.org/whl/cu128
$E/instanovo-gpu/bin/pip install instanovo==1.2.2 "torch==2.8.0"
$E/instanovo-gpu/bin/pip freeze > $E/instanovo-gpu.freeze.txt
echo INSTDONE
