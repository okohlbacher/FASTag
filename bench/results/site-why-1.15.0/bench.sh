#!/bin/bash
# site-why-1.15.0: FASTag 1.15.0 (release FASTag-1.15.0-linux-x64.tar.gz) at 128 threads on ibminode05,
# protocol of site-why-1.14.0/bench.sh (load gate < 0.25 per core, warm page cache, one uncounted warm-up,
# 3 reps, /usr/bin/time -v). FASTag side only; DirecTag's numbers are those of the 1.14.0 run (same node).
#
# Paths and settings come from the environment; the defaults are the values of the recorded run:
#   W      output folder (raw.tsv, runs/, acc/)     FT   the FASTag wrapper of the unpacked release
#   D47    PXD047793 diaTracer mzML                 D28  PXD028735 mzML
#   D01    PXD000001 mzML                           T    threads (128)
#   GATE   load per core below which a run starts   OPENMS_TMPDIR  OpenMS's temporary folder
# Inputs: INPUTS.tsv (sha256; D47 and D28 are derived files, see RESULT.md).
set -u
W=${W:-/scratch/kohlbach/rsw-bench/site-why-1.15.0}; RAW=$W/raw.tsv; GATE=${GATE:-0.25}
FT=${FT:-/scratch/kohlbach/rsw-bench/opt/FASTag/FASTag}
D47=${D47:-/scratch/kohlbach/rt047793/in/4223_TIMS2_006_2_Slot2-6_1_2877_diatracer.mzML}
D28=${D28:-/scratch/kohlbach/fastag-carryover-1.12/timing/in/PXD028735_Gamma_01.mzML}
D01=${D01:-/scratch/kohlbach/jpr-acc/data/PXD000001/TMT_Erwinia_1uLSike_Top10HCD_isol2_45stepped_60min_01-20141210.mzML}
T=${T:-128}
export OPENMS_TMPDIR=${OPENMS_TMPDIR:-/dev/shm/kohlbach-tmp} OPENBLAS_NUM_THREADS=1 OPENMS_DISABLE_UPDATE_CHECK=ON
mkdir -p $OPENMS_TMPDIR $W/runs $W/acc
N=$(nproc)
[ -s $RAW ] || echo -e "tool\tdataset\trep\tstart_utc\tload1_before\tload_per_core_before\tgate_wait_s\tload1_after\tload_per_core_after\texit\twall_s\tmaxrss_kb\ttags_sha256\ttags_rows\trundir" > $RAW

run() { # dataset input rep [extra args]
  local ds=$1 in=$2 rep=$3; shift 3
  local w0=$(date +%s)
  while :; do
    l=$(cut -d' ' -f1 /proc/loadavg)
    awk -v l=$l -v n=$N -v g=$GATE 'BEGIN{exit !((l/n)<g)}' && break
    [ $(( $(date +%s) - w0 )) -gt 1800 ] && break
    sleep 10
  done
  local gw=$(( $(date +%s) - w0 ))
  local l0=$(cut -d' ' -f1 /proc/loadavg); local lpc=$(awk -v l=$l0 -v n=$N 'BEGIN{printf "%.4f", l/n}')
  local r=$W/runs/fastag_${ds}_r${rep}
  rm -rf $r; mkdir -p $r
  local st=$(date -u +%FT%TZ)
  ( cd $r && env LC_ALL=C /usr/bin/time -v -o time.txt "$FT" -in "$in" -out tags.tsv \
      -tag_length 3 -max_tags 50 -max_peaks 100 -peaks_per_window 0 -gaps 0 -no_deisotope \
      -fragment_tolerance 0.02 -fragment_tolerance_unit Da -fixed_modifications "" -threads $T "$@" \
      > out.log 2> err.log )
  local rc=$(grep -m1 "Exit status" $r/time.txt | awk -F': ' '{print $NF}')
  local wall=$(awk -F': ' '/Elapsed \(wall clock\)/{n=split($NF,a,":"); s=0; for(i=1;i<=n;i++) s=s*60+a[i]; printf "%.2f", s}' $r/time.txt)
  local rss=$(awk -F': ' '/Maximum resident set size/{print $NF}' $r/time.txt)
  local l1=$(cut -d' ' -f1 /proc/loadavg); local lpc1=$(awk -v l=$l1 -v n=$N 'BEGIN{printf "%.4f", l/n}')
  local sha=- rows=-
  if [ -f $r/tags.tsv ]; then
    sha=$(sha256sum $r/tags.tsv | cut -d' ' -f1); rows=$(( $(grep -c . $r/tags.tsv) - 1 ))
    [ "$ds" = PXD000001 ] && cp $r/tags.tsv $W/acc/pxd000001_fastag-1.15.0_matched.tsv
    rm -f $r/tags.tsv
  fi
  echo -e "fastag\t$ds\t$rep\t$st\t$l0\t$lpc\t$gw\t$l1\t$lpc1\t$rc\t$wall\t$rss\t$sha\t$rows\t$r" >> $RAW
}

echo "start $(date -u +%FT%TZ) load $(cut -d' ' -f1-3 /proc/loadavg)" > $W/STATUS
sha256sum $FT.bin "$(dirname $FT)/FASTag" > $W/binary.sha256
# PXD000001: accuracy only (tag file kept), not timed for the page
run PXD000001 $D01 0
for ds in PXD047793 PXD028735; do
  case $ds in PXD047793) in=$D47; X=();; PXD028735) in=$D28; X=(-acquisition_check warn);; esac
  sha256sum $in >> $W/inputs.sha256          # records the input and warms the page cache
  run $ds $in 0 "${X[@]}"                     # warm-up, not counted
  for rep in 1 2 3; do run $ds $in $rep "${X[@]}"; done
  echo "$ds done $(date -u +%FT%TZ)" >> $W/STATUS
done
sha256sum $D01 >> $W/inputs.sha256
echo "DONE $(date -u +%FT%TZ)" >> $W/STATUS
touch $W/DONE
