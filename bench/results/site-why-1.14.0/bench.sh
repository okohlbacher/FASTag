#!/bin/bash
# site-why-1.14.0: FASTag 1.14.0 (release linux-x64) vs DirecTag 1.4.21142 at 128 threads on ibminode05,
# settings of the 2026-09-08 kim corpus benchmark (doc/BENCHMARK-corpus-128t.md). 3 reps, order alternating.
set -u
W=/scratch/kohlbach/site-why-1.14.0; RAW=$W/raw.tsv; GATE=0.25
FT=$W/opt/FASTag/FASTag
DT=/ceph/ibmi/abi/oliver/jpr-bench/envs/bumbershoot/bin/directag
DTCACHE=/scratch/kohlbach/rt047793/directag_cache/directag_intensity_ranksum_bins.cache
D47=/scratch/kohlbach/rt047793/in/4223_TIMS2_006_2_Slot2-6_1_2877_diatracer.mzML
D28=/scratch/kohlbach/fastag-carryover-1.12/timing/in/PXD028735_Gamma_01.mzML
D01=/scratch/kohlbach/jpr-acc/data/PXD000001/TMT_Erwinia_1uLSike_Top10HCD_isol2_45stepped_60min_01-20141210.mzML
T=128
export OPENMS_TMPDIR=/dev/shm/kohlbach-tmp OPENBLAS_NUM_THREADS=1 OPENMS_DISABLE_UPDATE_CHECK=ON
mkdir -p $OPENMS_TMPDIR $W/runs
N=$(nproc)
[ -s $RAW ] || echo -e "tool\tdataset\trep\tstart_utc\tload1_before\tload_per_core_before\tgate_wait_s\tload1_after\tload_per_core_after\texit\trundir" > $RAW

run() { # tool dataset input rep [extra fastag args]
  local tool=$1 ds=$2 in=$3 rep=$4; shift 4
  local w0=$(date +%s)
  while :; do
    l=$(cut -d' ' -f1 /proc/loadavg)
    awk -v l=$l -v n=$N -v g=$GATE 'BEGIN{exit !((l/n)<g)}' && break
    [ $(( $(date +%s) - w0 )) -gt 1800 ] && break
    sleep 10
  done
  local gw=$(( $(date +%s) - w0 ))
  local l0=$(cut -d' ' -f1 /proc/loadavg); local lpc=$(awk -v l=$l0 -v n=$N 'BEGIN{printf "%.4f", l/n}')
  local r=$W/runs/${tool}_${ds}_r${rep}
  rm -rf $r; mkdir -p $r
  local st=$(date -u +%FT%TZ)
  if [ $tool = fastag ]; then
    ( cd $r && env LC_ALL=C /usr/bin/time -v -o time.txt "$FT" -in "$in" -out tags.tsv \
        -tag_length 3 -max_tags 50 -max_peaks 100 -peaks_per_window 0 -gaps 0 -no_deisotope \
        -fragment_tolerance 0.02 -fragment_tolerance_unit Da -fixed_modifications "" -threads $T "$@" \
        > out.log 2> err.log )
  else
    cp $DTCACHE $r/
    ( cd $r && env LC_ALL=C /usr/bin/time -v -o time.txt "$DT" -TagLength 3 -MaxTagCount 50 -MaxPeakCount 100 \
        -FragmentMzTolerance 0.02 -PrecursorMzTolerance 1.5 -cpus $T "$in" > out.log 2> err.log )
  fi
  local rc=$(grep -m1 "Exit status" $r/time.txt | awk -F': ' '{print $NF}')
  local l1=$(cut -d' ' -f1 /proc/loadavg); local lpc1=$(awk -v l=$l1 -v n=$N 'BEGIN{printf "%.4f", l/n}')
  local of=$(ls $r/tags.tsv $r/*.tags 2>/dev/null | head -1)
  if [ -n "$of" ]; then
    echo -e "$(sha256sum $of | cut -d' ' -f1)\t$(stat -c %s $of)\t$(grep -c . $of)" > $r/out.sha
    [ "$ds" = PXD000001 ] && cp $of $W/acc/ 2>/dev/null
    rm -f $of
  fi
  rm -f $r/*.cache
  echo -e "$tool\t$ds\t$rep\t$st\t$l0\t$lpc\t$gw\t$l1\t$lpc1\t$rc\t$r" >> $RAW
}

mkdir -p $W/acc
echo "start $(date -u +%FT%TZ)" > $W/STATUS
# PXD000001: accuracy only (tag file kept), not timed for the page
run fastag PXD000001 $D01 0
for ds in PXD047793 PXD028735; do
  case $ds in PXD047793) in=$D47; X=();; PXD028735) in=$D28; X=(-acquisition_check warn);; esac
  cat $in > /dev/null                         # page cache warm, identical for both tools
  run fastag $ds $in 0 "${X[@]}"              # warm-up, not counted
  for rep in 1 2 3; do
    if [ $((rep % 2)) = 1 ]; then run fastag $ds $in $rep "${X[@]}"; run directag $ds $in $rep
    else run directag $ds $in $rep; run fastag $ds $in $rep "${X[@]}"; fi
    echo "$ds rep $rep done $(date -u +%FT%TZ)" >> $W/STATUS
  done
done
echo "DONE $(date -u +%FT%TZ)" >> $W/STATUS
touch $W/DONE
