# Casanovo 5.2.1 on GPU (data, H100 PCIe index 1), full MS2 MGF, default config (beam 1, batch 1024)
set -x
W=/scratch/kohlbach/denovo; E=/ceph/ibmi/abi/oliver/jpr-bench/envs/casanovo-gpu
CK=/ceph/ibmi/abi/oliver/jpr-bench/denovo/dl/casanovo_orbitrap_v5-2-0.ckpt
export CUDA_VISIBLE_DEVICES=1 OMP_NUM_THREADS=16
cd $W/casanovo
for ds in PXD000001 PXD003531; do
  o=$W/casanovo/$ds; mkdir -p $o
  echo "$E/bin/casanovo sequence $W/mgf/$ds.mgf -m $CK -c $W/casanovo/casanovo_config.yaml --output_dir $o --output_root casanovo" > $o/command.txt
  { date -Is; uptime; nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used --format=csv,noheader; } > $o/load_before.txt
  nvidia-smi --query-gpu=index,utilization.gpu,memory.used --format=csv,noheader -i 1 -l 5 > $o/gpu_samples.csv &
  S=$!
  /usr/bin/time -v $E/bin/casanovo sequence $W/mgf/$ds.mgf -m $CK -c $W/casanovo/casanovo_config.yaml --output_dir $o --output_root casanovo > $o/run.log 2>&1
  echo rc=$? >> $o/run.log
  kill $S
  { date -Is; uptime; nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used --format=csv,noheader; } > $o/load_after.txt
done
echo CASDONE
