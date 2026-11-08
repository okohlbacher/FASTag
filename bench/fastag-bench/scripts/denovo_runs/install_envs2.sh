set -x
export MAMBA_ROOT_PREFIX=$HOME/micromamba
mm=$HOME/.local/bin/micromamba
E=/ceph/ibmi/abi/oliver/jpr-bench/envs
$mm create -y -p $E/pepnovo -c conda-forge -c bioconda pepnovo
$mm create -y -p $E/searchgui -c conda-forge -c bioconda searchgui=4.3.15
$mm list -p $E/pepnovo > $E/pepnovo.list.txt
$mm list -p $E/searchgui > $E/searchgui.list.txt
mkdir -p /ceph/ibmi/abi/oliver/jpr-bench/denovo/dl
cp -a /scratch/kohlbach/jpr-comparators/dl/denovogui/DeNovoGUI-1.16.8-mac_and_linux.tar.gz /ceph/ibmi/abi/oliver/jpr-bench/denovo/dl/
cp -a /scratch/kohlbach/jpr-comparators/dl/casanovo/casanovo_orbitrap_v5-2-0.ckpt /ceph/ibmi/abi/oliver/jpr-bench/denovo/dl/
sha256sum /ceph/ibmi/abi/oliver/jpr-bench/denovo/dl/* > /ceph/ibmi/abi/oliver/jpr-bench/denovo/dl/sha256.txt
echo ENV2DONE
