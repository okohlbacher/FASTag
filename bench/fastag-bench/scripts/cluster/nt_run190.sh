#!/bin/bash
# Non-tryptic SDRF runs: download (PRIDE), verify size/sha1, convert (ThermoRawFileParser, -f 2 -L 1-2),
# FASTag release (FASTAG_VER, default 1.9.0; 1.8.0 = nt_run.sh): termini pass A (prose-auto models) and B (shipped), mass-gap pass C, same options as
# fastag-digest-val/run_one.py and prose-auto 0.1.3's gap command (organism FASTA from the prose-auto panel).
# Version copy of nt_run.sh: only the binary and the report/work dirs change (reports_v190, sdrf-nt-v190);
# mzML already converted by the 1.8.0 run is reused (download/convert only if missing).
# Usage: nt_run190.sh <acc> <file> <url> <sha1> <size> <organism>
set -u
B=/ceph/ibmi/abi/oliver/jpr-bench/sdrf/nontryptic
VER=${FASTAG_VER:-1.9.0}; TAG=v$(echo $VER | tr -d . | cut -c1-3)
S=/scratch/kohlbach/sdrf-nt-$TAG
FASTAG=/ceph/ibmi/abi/oliver/opt/fastag-$VER/FASTag/FASTag
TRFP=/ceph/ibmi/abi/oliver/jpr-bench/envs/trfp/bin/ThermoRawFileParser
MODELS=/ceph/ibmi/abi/oliver/fastag-digest-val/prose_auto_013_digest_models.tsv
PANEL=/ceph/ibmi/abi/oliver/prose-auto-20261029/panel
TH=8
acc=$1; f=$2; url=$3; sha=$4; size=$5; org=$6
run=${f%.raw}
o=$B/reports_$TAG/nontryptic_new__${acc}__${run}; w=$S/$acc; mkdir -p $o $w $B/mzML/$acc /dev/shm/kohlbach-tmp
export OPENMS_TMPDIR=/dev/shm/kohlbach-tmp TMPDIR=/dev/shm/kohlbach-tmp FASTAG_FULL_PRECISION=1
log=$o/pipeline.log; : > $log
echo "start $(date -Is) load $(cat /proc/loadavg)" >> $log
if [ ! -s $B/mzML/$acc/$run.mzML ]; then
  curl -s -S --retry 3 -o $w/$f "$url" >> $log 2>&1
  got=$(stat -c %s $w/$f); echo "size $got expected $size" >> $log
  [ "$got" = "$size" ] || { echo "SIZE MISMATCH" >> $log; exit 1; }
  if [ "$sha" != "-" ]; then s=$(sha1sum $w/$f | cut -d' ' -f1); echo "sha1 $s expected $sha" >> $log; [ "$s" = "$sha" ] || { echo "SHA1 MISMATCH" >> $log; exit 1; }; fi
  $TRFP -i=$w/$f -o=$w -f=2 -L=1-2 >> $log 2>&1
  cp $w/$run.mzML $B/mzML/$acc/$run.mzML && rm -f $w/$f
fi
in=$B/mzML/$acc/$run.mzML
term="-in $in -tag_length 4 -threads $TH -subsample_fraction 0.25 -fragment_tolerance 20.0 -fragment_tolerance_unit ppm"
A="$FASTAG $term -out $w/A.tags.tsv -digest_out $o/A.digest.tsv -label_out $o/A.label.tsv -digest_models $MODELS"
Bc="$FASTAG $term -out $w/B.tags.tsv -digest_out $o/B.digest.tsv -label_out $o/B.label.tsv"
C="$FASTAG -in $in -out $w/C.tags.tsv -tag_length 4 -extension 6 -threads $TH -recon_fasta $PANEL/$org.fasta -recon_out $w/C.recon.tsv -delta_out $o/C.delta.tsv -recon_min_length 5 -fixed_modifications -fragment_tolerance 20.0 -fragment_tolerance_unit ppm -massgap_out $o/C.massgap.tsv"
for p in A Bc C; do echo "$p: ${!p}" >> $o/commands.txt; /usr/bin/time -v ${!p} > $o/$p.log 2>&1; echo "$p rc $?" >> $log; done
rm -f $w/*.tags.tsv $w/C.recon.tsv
echo "end $(date -Is) load $(cat /proc/loadavg)" >> $log
echo DONE >> $log
