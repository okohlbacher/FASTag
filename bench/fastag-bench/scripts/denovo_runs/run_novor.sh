# Novor v1.05.0573 (free academic edition, bundled in bioconda searchgui 4.3.15), CPU, pinned to 16 cores
set -x
W=/scratch/kohlbach/denovo; N=/ceph/ibmi/abi/oliver/jpr-bench/envs/searchgui/share/searchgui-4.3.15-0/resources/Novor
cd $W/novor
for ds in PXD000001 PXD003531; do
  o=$W/novor/$ds; mkdir -p $o
  cmd="taskset -c 0-15 java -jar $N/novor.jar -p $W/novor/params_$ds.txt -o $o/novor.csv -f $W/mgf/$ds.mgf"
  echo "$cmd" > $o/command.txt; java -version 2>> $o/command.txt
  { date -Is; uptime; } > $o/load_before.txt
  /usr/bin/time -v $cmd > $o/run.log 2>&1; echo rc=$? >> $o/run.log
  { date -Is; uptime; } > $o/load_after.txt
done
echo NOVDONE
