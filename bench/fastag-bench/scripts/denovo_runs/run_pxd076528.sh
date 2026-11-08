# PXD076528 (Orbitrap Astral DDA): Sage on the full mzML (human UniProt panel FASTA; the PXD-supplied
# 20200824_swissprot_human_ci.fasta has 46 kB and is not a proteome), FASTag on the full mzML, de novo
# tools on a fixed-seed subsample of 20,000 MS2 spectra (numpy default_rng(20261103)).
set -x
W=/scratch/kohlbach/denovo; A=/ceph/ibmi/abi/oliver/jpr-bench/accuracy
MZ=$W/in76/7673_YD12_P116861_S00_R1.mzML; MGF=$W/mgf/PXD076528_sub20k_seed20261103.mgf; ds=PXD076528
SAGE=/scratch/kohlbach/jpr-bench/envs/sage/bin/sage; PY=/scratch/kohlbach/jpr-bench/envs/py311/bin/python
if [ ! -e $A/sage-$ds/results.sage.tsv ]; then
  o=$W/sage-$ds; mkdir -p $o
  (cd /ceph/ibmi/abi/oliver/jpr-bench/denovo/fastag-bench && PYTHONPATH=src $PY /ceph/ibmi/abi/oliver/jpr-bench/denovo/scripts/sage_gt.py PXD076528_Astral_7673 $MZ $W/in/Homo_sapiens.fasta $o)
  echo "$SAGE -o $o $o/sage.json" > $o/command.txt; $SAGE --version > $o/version.txt 2>&1
  uptime > $o/load.txt; RAYON_NUM_THREADS=32 /usr/bin/time -v $SAGE -o $o $o/sage.json > $o/run.log 2>&1; uptime >> $o/load.txt
  if [ ! -e $A/sage-$ds ]; then mkdir -p $A/sage-$ds.tmp && cp $o/* $A/sage-$ds.tmp/ && echo "written by the de novo task (open issue 4) on node data, $(date -Is); harness sage_config with the human UniProt panel FASTA (prose-auto panel Homo_sapiens.fasta, sha256 dffdff38...), not the 46 kB PXD FASTA; mzML converted with ThermoRawFileParser 2.0.0 -f 2 -L 1-2 (sha256 in denovo/in76)" > $A/sage-$ds.tmp/ORIGIN.txt && mv -n $A/sage-$ds.tmp $A/sage-$ds; fi
fi
F=/ceph/ibmi/abi/oliver/opt/fastag-1.8.0/FASTag/FASTag; o=$W/fastag/$ds; mkdir -p $o
echo "$F -in $MZ -out $o/tags.tsv -threads 16" > $o/command.txt; /usr/bin/time -v $F -in $MZ -out $o/tags.tsv -threads 16 > $o/run.log 2>&1
N=/ceph/ibmi/abi/oliver/jpr-bench/envs/searchgui/share/searchgui-4.3.15-0/resources/Novor
sed -e "s/, Phospho (ST), Phospho (Y)//" $W/novor/params_PXD003531.txt > $W/novor/params_$ds.txt
o=$W/novor/$ds; mkdir -p $o; cmd="taskset -c 0-15 java -jar $N/novor.jar -p $W/novor/params_$ds.txt -o $o/novor.csv -f $MGF"
echo "$cmd" > $o/command.txt; { date -Is; uptime; } > $o/load_before.txt; /usr/bin/time -v $cmd > $o/run.log 2>&1; { date -Is; uptime; } > $o/load_after.txt
PN=/ceph/ibmi/abi/oliver/jpr-bench/envs/pepnovo/bin/pepnovo; o=$W/pepnovo/$ds; mkdir -p $o/chunks
awk -v d=$o/chunks "/BEGIN IONS/{n++} {print > (d \"/c\" (n%32) \".mgf\")}" $MGF
base="-model CID_IT_TRYP -model_dir $W/pepnovo/models -fragment_tolerance 0.02 -pm_tolerance 0.02 -digest TRYPSIN -PTMs C+57:M+16"
echo "per chunk (spectrum n -> chunk n mod 32), taskset -c <i>: $PN $base -file c<i>.mgf -num_solutions 1 ; ... -tag_length 3 -num_solutions 10" > $o/command.txt
{ date -Is; uptime; } > $o/load_before.txt; start=$(date +%s.%N)
for i in $(seq 0 31); do ( taskset -c $i $PN $base -file $o/chunks/c$i.mgf -num_solutions 1 > $o/chunks/c$i.denovo.txt 2>&1 ) & done; wait; mid=$(date +%s.%N)
for i in $(seq 0 31); do ( taskset -c $i $PN $base -file $o/chunks/c$i.mgf -tag_length 3 -num_solutions 10 > $o/chunks/c$i.tags3.txt 2>&1 ) & done; wait; end=$(date +%s.%N)
{ date -Is; uptime; echo "denovo_wall_s $(echo "$mid - $start" | bc)"; echo "tags3_wall_s $(echo "$end - $mid" | bc)"; } > $o/load_after.txt
cat $o/chunks/c*.denovo.txt > $o/pepnovo_denovo.txt; cat $o/chunks/c*.tags3.txt > $o/pepnovo_tags3.txt
until grep -q INSTRUNDONE /ceph/ibmi/abi/oliver/jpr-bench/denovo/logs/instanovo.log; do sleep 30; done
export CUDA_VISIBLE_DEVICES=1 OMP_NUM_THREADS=16 HF_HOME=/scratch/kohlbach/hf
E=/ceph/ibmi/abi/oliver/jpr-bench/envs/casanovo-gpu; CK=/ceph/ibmi/abi/oliver/jpr-bench/denovo/dl/casanovo_orbitrap_v5-2-0.ckpt
o=$W/casanovo/$ds; mkdir -p $o; cmd="$E/bin/casanovo sequence $MGF -m $CK -c $W/casanovo/casanovo_config.yaml --output_dir $o --output_root casanovo"
echo "$cmd" > $o/command.txt; { date -Is; uptime; nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used --format=csv,noheader; } > $o/load_before.txt
nvidia-smi --query-gpu=index,utilization.gpu,memory.used --format=csv,noheader -i 1 -l 5 > $o/gpu_samples.csv & S=$!
/usr/bin/time -v $cmd > $o/run.log 2>&1; kill $S; { date -Is; uptime; nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used --format=csv,noheader; } > $o/load_after.txt
E=/ceph/ibmi/abi/oliver/jpr-bench/envs/instanovo-gpu
o=$W/instanovo/$ds; mkdir -p $o; cmd="$E/bin/instanovo transformer predict --data-path $MGF --output-path $o/instanovo.csv"
echo "$cmd" > $o/command.txt; { date -Is; uptime; nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used --format=csv,noheader; } > $o/load_before.txt
nvidia-smi --query-gpu=index,utilization.gpu,memory.used --format=csv,noheader -i 1 -l 5 > $o/gpu_samples.csv & S=$!
/usr/bin/time -v $cmd > $o/run.log 2>&1; kill $S; { date -Is; uptime; nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used --format=csv,noheader; } > $o/load_after.txt
echo P76DONE
