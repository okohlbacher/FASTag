#!/bin/bash
# b113-ax DEV: one MSFragger 4.4.1 search of a PXD018176 MGF. Usage: frag.sh <by|abxy|ax> <mgf basename>
set -u
W=/scratch/kohlbach/b113/ax/dev; J=/ceph/ibmi/abi/oliver/spextract/tools/MSFragger-4.4.1.jar
JAVA=/ceph/ibmi/abi/oliver/opt/jdk-21.0.12.1/bin/java
s=$1; f=$2; stem=${f%.mgf}
D=$W/truth/$stem/$s; mkdir -p $D; cd $D
python3 -I $W/mgf_titles.py /scratch/kohlbach/b113/ax/data/PXD018176/$f $D/$f
cp $W/params/msfragger_$s.params search.params
$JAVA -Xmx24G -jar $J search.params $f > fragger.log 2>&1; echo "FRAGGER_RC=$?" >> fragger.log
rm -f $f
