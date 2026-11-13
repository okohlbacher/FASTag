#!/bin/bash
# FASTag 1.14 held-out test aspn: stage the drawn files (download, checksum, conversion, MS2 check; no FASTag run, no search).
#   stage.sh <stage.tsv> <out.tsv>
# Per slot (column 'run'): the files in their drawn order (column 'role' = 1, 2, ...) until one passes; a slot whose
# files all fail is empty. Download over https from the PRIDE
# archive into $ROOT/raw/<PXD>/ (up to 8 resumed tries; PRIDE SHA-1 checked; without one, the size plus an independent
# second download with the same sha256), ThermoRawFileParser 2.0.0 -f 2 (centroided, indexed mzML), and the staging check:
# every MS2 has a filter string with FTMS, ms2 and @hcd; at least 2000 MS2 carry a charge state.
set -u
ROOT=${ASPN_HELDOUT:-/scratch/kohlbach/acc114/aspn/heldout}
TRFP=/ceph/ibmi/abi/oliver/prose-auto-20261029/env/bin/thermorawfileparser
LIST=$1; OUT=$2
printf 'run\trole\tgroup\tprotease\taccession\tdb\tfile\tbytes\tpride_sha1\tstatus\traw_sha256\tmzml\tmzml_bytes\tmzml_sha256\tms2\tms2_ftms_hcd\tms2_charged\tcheck\n' > "$OUT"
okrun=""
tail -n +2 "$LIST" | while IFS=$'\t' read -r run role group prot acc db file bytes sha1 url ncand; do
  [ "$okrun" = "$run" ] && continue          # chosen file passed: the backup is not downloaded
  D=$ROOT/raw/$acc; mkdir -p "$D"; f=$D/$file; st=DOWNLOAD_FAILED
  for a in 1 2 3 4 5 6 7 8; do
    if [ -s "$f" ] && [ "$sha1" != - ] && [ "$(sha1sum "$f" | cut -c1-40)" = "$sha1" ]; then st=sha1_ok; break; fi
    if [ -s "$f" ] && [ "$sha1" = - ] && [ "$(stat -c %s "$f")" = "$bytes" ]; then st=size_ok; break; fi
    rm -f "$f"
    curl -sS -f -L -C - --retry 3 --connect-timeout 30 --speed-time 120 --speed-limit 10000 -o "$f.part" "$url" 2>>"$D/curl.log"
    [ "$(stat -c %s "$f.part" 2>/dev/null)" = "$bytes" ] && mv "$f.part" "$f"
  done
  if [ "$st" = size_ok ]; then
    curl -sS -f -L --retry 3 --connect-timeout 30 -o "$f.check" "$url" 2>>"$D/curl.log"
    if [ "$(sha256sum "$f" | cut -c1-64)" = "$(sha256sum "$f.check" 2>/dev/null | cut -c1-64)" ]; then
      st=no_pride_sha1,size_ok,second_download_same; else st=SECOND_DOWNLOAD_DIFFERS; fi
    rm -f "$f.check"
  fi
  rs=$( [ -s "$f" ] && sha256sum "$f" | cut -c1-64); rs=${rs:--}
  stem=${file%.*}; mz=$D/$stem.mzML
  if { [ "$st" = sha1_ok ] || [ "$st" = no_pride_sha1,size_ok,second_download_same ]; } && [ ! -s "$mz" ]; then
    rm -rf "$D/tmp.$stem"; mkdir -p "$D/tmp.$stem"
    timeout 14400 "$TRFP" -i "$f" -o "$D/tmp.$stem" -f 2 > "$D/$stem.trfp.log" 2>&1 < /dev/null \
      && [ -s "$D/tmp.$stem/$stem.mzML" ] && mv "$D/tmp.$stem/$stem.mzML" "$mz"
    rm -rf "$D/tmp.$stem"
  fi
  ms=-; mb=-; n2=-; nf=-; nc=-; chk=FAIL
  if [ -s "$mz" ]; then
    ms=$(sha256sum "$mz" | cut -c1-64); mb=$(stat -c %s "$mz")
    # cvParams by accession: MS:1000511 ms level, MS:1000512 filter string, MS:1000041 charge state
    read -r n2 nf nc <<<"$(awk '/<spectrum /{inms2=0} /accession="MS:1000511" value="2"/{inms2=1; n2++}
      inms2 && /accession="MS:1000512"/ { if ($0 ~ /FTMS/ && $0 ~ /ms2/ && $0 ~ /@hcd/) nf++ }
      inms2 && /accession="MS:1000041"/ { nc++ }
      END { print n2 + 0, nf + 0, nc + 0 }' "$mz")"
    [ "$nf" = "$n2" ] && [ "$nc" -ge 2000 ] && chk=ok
  fi
  [ "$chk" = ok ] && okrun=$run
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$run" "$role" "$group" "$prot" "$acc" "$db" "$file" "$bytes" "$sha1" \
    "$st" "$rs" "${mz#$ROOT/}" "$mb" "$ms" "$n2" "$nf" "$nc" "$chk" >> "$OUT"
done
echo STAGE_DONE
