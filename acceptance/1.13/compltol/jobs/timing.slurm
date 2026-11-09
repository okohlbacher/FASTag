#!/bin/bash
# compltol criterion (iv) (PREREG-compltol.md): PXD003531 (DEV), 1 thread, 3 interleaved repeats of each arm
# (CFG-CT-base = defaults, CFG-CT-cand = -complement_tolerance_unit auto) on one exclusive BinAC2 compute node.
#SBATCH --partition=compute
#SBATCH --job-name=cttiming
#SBATCH --exclusive
#SBATCH --ntasks=1
#SBATCH --mem=64gb
#SBATCH --time=04:00:00
#SBATCH --output=/pfs/10/project/bw26g016/fastag-1.13/compltol/logs/%x-%j.out
set -uo pipefail
FT=/pfs/10/project/bw26g016/fastag-1.12; W=/pfs/10/project/bw26g016/fastag-1.13/compltol
echo "b7a1701c7cbe85d6ba7c9ecc270046a86e514e2eed45e4cd2eab78814d3ffac9  $W/opt/FASTag.bin" | sha256sum -c - || exit 3
SRC=$FT/gate/gate-in-110/PXD003531/20130611_QE3_UPLC10_CFR_SA_OC_T_NO_03_01_01.mzML
cp "$SRC" "$TMPDIR/in.mzML"
echo "2b1da22229a9d8e8d4cde05d889c3a74dedd68bb9f00f3bdd9d78d2a8d9ace4a  $TMPDIR/in.mzML" | sha256sum -c - || exit 4
echo "host $(hostname) $(grep -m1 'model name' /proc/cpuinfo)"
D=$W/timing; mkdir -p $D
printf 'arm\trepeat\tseconds\trc\thost\n' > $D/timing.tsv
cd $TMPDIR
for rep in 1 2 3; do
  for arm in CFG-CT-base CFG-CT-cand; do
    if [ $arm = CFG-CT-cand ]; then OPTS="-complement_tolerance_unit auto"; else OPTS=""; fi
    t0=$(date +%s.%N)
    $W/bin/FASTag -in in.mzML -out tags_${arm}_$rep.tsv -threads 1 $OPTS > run_${arm}_$rep.log 2>&1; rc=$?
    t1=$(date +%s.%N)
    printf '%s\t%s\t%s\t%s\t%s\n' $arm $rep $(awk -v a=$t0 -v b=$t1 'BEGIN{printf "%.3f", b-a}') $rc $(hostname) >> $D/timing.tsv
    cp run_${arm}_$rep.log $D/; sha256sum tags_${arm}_$rep.tsv >> $D/tags.sha256; rm -f tags_${arm}_$rep.tsv
  done
done
cat $D/timing.tsv
echo TIMING_DONE
