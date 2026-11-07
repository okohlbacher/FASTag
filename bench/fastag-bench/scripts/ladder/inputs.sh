#!/bin/bash
# bytes and sha256 of every ladder input (after chain28735.sh)
cd /scratch/kohlbach/ladder/in
while pgrep -f chain28735.sh >/dev/null; do sleep 30; done
echo -e "file\tbytes\tsha256" > inputs_sha.tsv
for f in */*.mzML */*.mzpeak; do echo -e "$f\t$(stat -c %s $f)\t$(sha256sum $f | cut -d" " -f1)" >> inputs_sha.tsv; done
cp inputs_sha.tsv convert.tsv vendor.tsv /ceph/ibmi/abi/oliver/jpr-bench/ladder/
