# PepNovo+ 20101117 (bioconda pepnovo), CID_IT_TRYP model (the only model available; data are HCD), 32 single-threaded chunks
set -x
W=/scratch/kohlbach/denovo/pepnovo; PN=/ceph/ibmi/abi/oliver/jpr-bench/envs/pepnovo/bin/pepnovo
cd $W
declare -A PTM=([PXD003531]="C+57:M+16:S+80:T+80:Y+80" [PXD000001]="C+46:K+229:^+229:M+16")
for ds in PXD000001 PXD003531; do
  o=$W/$ds; mkdir -p $o/chunks
  awk -v d=$o/chunks "/BEGIN IONS/{n++} {print > (d \"/c\" (n%32) \".mgf\")}" /scratch/kohlbach/denovo/mgf/$ds.mgf
  base="-model CID_IT_TRYP -model_dir $W/models -fragment_tolerance 0.02 -pm_tolerance 0.02 -digest TRYPSIN -PTMs ${PTM[$ds]}"
  echo "per chunk c<i>.mgf (i = 0..31, spectrum n -> chunk n mod 32), taskset -c <i>: $PN $base -file c<i>.mgf -num_solutions 1 > c<i>.denovo.txt ; $PN $base -file c<i>.mgf -tag_length 3 -num_solutions 10 > c<i>.tags3.txt" > $o/command.txt
  { date -Is; uptime; } > $o/load_before.txt
  start=$(date +%s.%N)
  for i in $(seq 0 31); do
    ( taskset -c $i $PN $base -file $o/chunks/c$i.mgf -num_solutions 1 > $o/chunks/c$i.denovo.txt 2> $o/chunks/c$i.denovo.err ) &
  done; wait
  mid=$(date +%s.%N)
  for i in $(seq 0 31); do
    ( taskset -c $i $PN $base -file $o/chunks/c$i.mgf -tag_length 3 -num_solutions 10 > $o/chunks/c$i.tags3.txt 2> $o/chunks/c$i.tags3.err ) &
  done; wait
  end=$(date +%s.%N)
  { date -Is; uptime; echo "denovo_wall_s $(echo "$mid - $start" | bc)"; echo "tags3_wall_s $(echo "$end - $mid" | bc)"; } > $o/load_after.txt
  cat $o/chunks/c*.denovo.txt > $o/pepnovo_denovo.txt; cat $o/chunks/c*.tags3.txt > $o/pepnovo_tags3.txt
done
echo PNDONE
