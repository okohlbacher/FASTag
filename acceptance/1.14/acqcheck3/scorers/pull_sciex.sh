#!/bin/bash
# acqcheck3: copy the SCIEX conversions from flash to node data (data -> flash directly, forwarded agent; nothing
# passes through the laptop) and check each mzML's sha256 against flash's status file. No FASTag, no truth script.
# Writes stage_sciex.tsv in the stage.tsv layout: id, route, fetch, raw sha256, conv rc (0 | NA), mzML, mzML sha256.
set -u
H=/scratch/kohlbach/b114/acqcheck3/heldout; cd $H
F=user@flash-workstation.cs.uni-tuebingen.de
: > stage_sciex.tsv
awk -F'\t' 'NR > 1 && ($6 ~ /\.wiff2?$/) { print $1 }' manifest.tsv | while read -r id; do
  R=$H/files/$id; mkdir -p $R/conv
  scp -q -o BatchMode=yes "$F:C:/acq3/out/$id/status.txt" $R/conv/flash_status.txt < /dev/null 2>/dev/null || { printf "%s\tsciex\tno_status\t\tNA\t\t\n" $id >> stage_sciex.tsv; continue; }
  tr -d '\r' < $R/conv/flash_status.txt > $R/conv/status.txt
  fetch=$(sed -n 's/^fetch=//p' $R/conv/status.txt); rs=$(sed -n 's/^raw_sha256=//p' $R/conv/status.txt)
  mz=$(sed -n 's/^mzml=//p' $R/conv/status.txt); sh=$(sed -n 's/^sha256=//p' $R/conv/status.txt)
  if grep -q '^staged=yes$' $R/conv/status.txt; then
    [ -s "$R/conv/$mz" ] && [ "$(sha256sum "$R/conv/$mz" | cut -d' ' -f1)" = "$sh" ] || \
      scp -q -o BatchMode=yes "$F:C:/acq3/out/$id/$mz" "$R/conv/$mz" < /dev/null
    got=$(sha256sum "$R/conv/$mz" 2>/dev/null | cut -d' ' -f1)
    if [ "$got" = "$sh" ]; then printf "%s\tsciex\t%s\t%s\t0\t%s\t%s\n" $id "$fetch" "$rs" "$R/conv/$mz" "$got" >> stage_sciex.tsv
    else printf "%s\tsciex\t%s\t%s\tcopy_sha256_FAIL\t%s\t%s\n" $id "$fetch" "$rs" "$R/conv/$mz" "$got" >> stage_sciex.tsv; fi
  else printf "%s\tsciex\t%s\t%s\tNA\t\t\n" $id "${fetch:-NA}" "$rs" >> stage_sciex.tsv; fi
done
date -Is > stage.sciex.done
