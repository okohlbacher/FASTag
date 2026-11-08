# InstaNovo 1.2.2 transformer (instanovo-v1.2.0) on GPU (data, H100 PCIe index 1), default inference config (beam 5, batch 128, fp16)
set -x
W=/scratch/kohlbach/denovo; E=/ceph/ibmi/abi/oliver/jpr-bench/envs/instanovo-gpu
export CUDA_VISIBLE_DEVICES=1 OMP_NUM_THREADS=16 HF_HOME=/scratch/kohlbach/hf
mkdir -p $W/instanovo; cd $W/instanovo
for ds in PXD000001 PXD003531; do
  o=$W/instanovo/$ds; mkdir -p $o
  echo "$E/bin/instanovo transformer predict --data-path $W/mgf/$ds.mgf --output-path $o/instanovo.csv" > $o/command.txt
  { date -Is; uptime; nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used --format=csv,noheader; } > $o/load_before.txt
  nvidia-smi --query-gpu=index,utilization.gpu,memory.used --format=csv,noheader -i 1 -l 5 > $o/gpu_samples.csv &
  S=$!
  /usr/bin/time -v $E/bin/instanovo transformer predict --data-path $W/mgf/$ds.mgf --output-path $o/instanovo.csv > $o/run.log 2>&1
  echo rc=$? >> $o/run.log
  kill $S
  { date -Is; uptime; nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used --format=csv,noheader; } > $o/load_after.txt
done
echo INSTRUNDONE
