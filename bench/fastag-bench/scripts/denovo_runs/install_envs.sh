set -x
export MAMBA_ROOT_PREFIX=$HOME/micromamba
mm=$HOME/.local/bin/micromamba
E=/ceph/ibmi/abi/oliver/jpr-bench/envs
export PIP_CACHE_DIR=/scratch/kohlbach/pipcache TMPDIR=/scratch/kohlbach/tmp
mkdir -p $TMPDIR
$mm create -y -p $E/casanovo-gpu -c conda-forge python=3.11 pip
$E/casanovo-gpu/bin/pip install torch==2.8.0 --index-url https://download.pytorch.org/whl/cu128
$E/casanovo-gpu/bin/pip install casanovo==5.2.1 "pyarrow<16" pyteomics lxml "torch==2.8.0"
$E/casanovo-gpu/bin/pip freeze > $E/casanovo-gpu.freeze.txt
$mm create -y -p $E/instanovo-gpu -c conda-forge python=3.12 pip
$E/instanovo-gpu/bin/pip install torch==2.8.0 --index-url https://download.pytorch.org/whl/cu128
$E/instanovo-gpu/bin/pip install instanovo==1.2.2 "torch==2.8.0"
$E/instanovo-gpu/bin/pip freeze > $E/instanovo-gpu.freeze.txt
echo ENVDONE
