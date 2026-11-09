#!/bin/bash
# E15B-04 DEV staging: PXD060724 raw files from the PRIDE FTP mirror (https), size check + independent second
# download with the same sha256 (PRIDE gives no checksum), sha256, ThermoRawFileParser 2.0.0 -f 2 (prose-auto env,
# as the staged held-out sets). DEV only. Usage: dl.sh <file>
set -u
R=/scratch/kohlbach/fastag-15b-dev/PXD060724; mkdir -p $R; cd $R
TRFP=/ceph/ibmi/abi/oliver/prose-auto-20261029/env/bin/thermorawfileparser
f=$1; bytes=$2; url=https://ftp.pride.ebi.ac.uk/pride/data/archive/2025/02/PXD060724/$f
for a in 1 2 3 4; do
  [ -s $f ] && [ "$(stat -c %s $f)" = $bytes ] && break
  rm -f $f; curl -sS -f -L --retry 3 -o $f.part $url 2>>curl.log && mv $f.part $f
done
curl -sS -f -L --retry 3 -o $f.check $url 2>>curl.log
s1=$(sha256sum $f | cut -c1-64); s2=$(sha256sum $f.check | cut -c1-64); rm -f $f.check
st=$([ "$(stat -c %s $f)" = $bytes ] && echo size_ok || echo SIZE_MISMATCH),$([ $s1 = $s2 ] && echo second_download_same || echo SECOND_DOWNLOAD_DIFFERS)
stem=${f%.raw}; rm -rf tmp.$stem; mkdir tmp.$stem
timeout 14400 $TRFP -i $f -o tmp.$stem -f 2 > $stem.trfp.log 2>&1; rc=$?
[ $rc = 0 ] && mv tmp.$stem/$stem.mzML $stem.mzML; rm -rf tmp.$stem
printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\n" $f $(stat -c %s $f) $st $s1 $rc $(stat -c %s $stem.mzML 2>/dev/null || echo -) $(sha256sum $stem.mzML 2>/dev/null | cut -c1-64) > $stem.stage.tsv
