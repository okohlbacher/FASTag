set -x
A=/ceph/ibmi/abi/oliver/jpr-bench/accuracy
W=/scratch/kohlbach/denovo
SAGE=/scratch/kohlbach/jpr-bench/envs/sage/bin/sage
PY=/scratch/kohlbach/jpr-bench/envs/py311/bin/python
run() { id=$1; pxd=$2; mz=$3; fa=$4
  if [ -e $A/sage-$pxd/results.sage.tsv ]; then echo "exists $pxd"; return; fi
  o=$W/sage-$pxd; mkdir -p $o
  (cd /ceph/ibmi/abi/oliver/jpr-bench/denovo/fastag-bench && PYTHONPATH=src $PY /ceph/ibmi/abi/oliver/jpr-bench/denovo/scripts/sage_gt.py $id $mz $fa $o)
  echo "$SAGE -o $o $o/sage.json" > $o/command.txt
  $SAGE --version > $o/version.txt 2>&1
  echo "bioconda sage-proteomics 0.14.7 (hc1c3326_2); binary prints the string above" >> $o/version.txt
  uptime > $o/load.txt
  RAYON_NUM_THREADS=32 /usr/bin/time -v $SAGE -o $o $o/sage.json > $o/run.log 2>&1
  uptime >> $o/load.txt
  if [ ! -e $A/sage-$pxd ]; then mkdir -p $A/sage-$pxd.tmp && cp $o/* $A/sage-$pxd.tmp/ && echo "written by the de novo task (open issue 4) on node data, $(date -Is); harness sage_config; mzML path is node-local copy of the PXD file (sha256 in inputs)" > $A/sage-$pxd.tmp/ORIGIN.txt && mv -n $A/sage-$pxd.tmp $A/sage-$pxd; fi
}
run PXD003531_QE_NO_03 PXD003531 $W/in/20130611_QE3_UPLC10_CFR_SA_OC_T_NO_03_01_01.mzML $W/in/Homo_sapiens.fasta
run PXD000001_Erwinia_TMT6 PXD000001 $W/in/TMT_Erwinia_1uLSike_Top10HCD_isol2_45stepped_60min_01-20141210.mzML $W/in/erwinia_carotovora.fasta
echo SAGEDONE
