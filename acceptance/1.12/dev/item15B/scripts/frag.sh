#!/bin/bash
# E15B-04 DEV: one MSFragger 4.4.1 search. Usage: frag.sh <search by|cz|hybrid> <stem>
set -u
B=/scratch/kohlbach/fastag-15b-dev; J=/ceph/ibmi/abi/oliver/spextract/tools/MSFragger-4.4.1.jar
s=$1; stem=$2; enz=$(case $stem in Tryp*) echo trypsin;; *) echo chymotrypsin;; esac)
D=$B/truth/dev15B-PXD060724/dev/PXD060724/$stem; mkdir -p $D/$s; cd $D/$s
ln -sf $B/PXD060724/$stem.mzML .
cp $B/params/msfragger_${s}_$enz.params search.params
java -Xmx60G -jar $J search.params $stem.mzML > fragger.log 2>&1; echo "FRAGGER_RC=$?" >> fragger.log
[ -s $stem.tsv ] && cp $stem.tsv $D/msfragger_$s.tsv
rm -f $stem.mzML
