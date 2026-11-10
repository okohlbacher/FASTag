#!/bin/bash
# hdrcharge second held-out round: stage drawn runs (no FASTag run, no search, no scoring).
#   stage_r.sh <stage.tsv> <out dir> <role: chosen|backup> <accession>
# https download from the PRIDE FTP mirror into $ROOT/<PXD>/ (resumed tries; PRIDE SHA-1 checked; without one, the
# size plus a second download with the same sha256), ThermoRawFileParser 2.0.0 -f 2, and the file check of
# select_heldout_r.py: instrument of the class in the mzML, MS1 spectra present, DDA (at least 5000 MS2, at least
# 90 % of them with a selected-ion charge, at least 1000 distinct isolation targets).
# Writes <out dir>/staged_<role>.<PXD>.tsv.
set -u
ROOT=${HDR_HELDOUT:-/scratch/kohlbach/b113/hdrcharge/heldout/r2}
TRFP=/ceph/ibmi/abi/oliver/prose-auto-20261029/env/bin/thermorawfileparser
LIST=$1; OD=$2; ROLE=$3; ACC=$4; mkdir -p "$OD"; OUT=$OD/staged_$ROLE.$ACC.tsv
printf 'class\taccession\tfile\tbytes\tpride_sha1\tstatus\traw_sha256\tmzml\tmzml_bytes\tmzml_sha256\tinstrument\tms1\tms2\tms2_charged\tisolation_targets\tcheck\n' > "$OUT"
tail -n +2 "$LIST" | while IFS=$'\t' read -r role cls acc file bytes sha1 url; do
  [ "$role" = "$ROLE" ] && [ "$acc" = "$ACC" ] || continue
  D=$ROOT/$acc; mkdir -p "$D"; f=$D/$file; st=DOWNLOAD_FAILED
  for a in $(seq 1 30); do
    if [ -s "$f" ] && [ "$sha1" != - ] && [ "$(sha1sum "$f" | cut -c1-40)" = "$sha1" ]; then st=sha1_ok; break; fi
    if [ -s "$f" ] && [ "$sha1" = - ] && [ "$(stat -c %s "$f")" = "$bytes" ]; then st=size_ok; break; fi
    rm -f "$f"
    curl -sS -f -L -C - --retry 3 --connect-timeout 30 --speed-time 120 --speed-limit 10000 -o "$f.part" "$url" 2>>"$D/curl.log"
    [ "$(stat -c %s "$f.part" 2>/dev/null)" = "$bytes" ] && mv "$f.part" "$f" || sleep 60
  done
  if [ "$st" = size_ok ]; then
    for a in $(seq 1 30); do   # resumed like the first download: a truncated transfer is not a differing file
      [ "$(stat -c %s "$f.check" 2>/dev/null)" = "$bytes" ] && break
      curl -sS -f -L -C - --retry 3 --connect-timeout 30 --speed-time 120 --speed-limit 10000 -o "$f.check" "$url" 2>>"$D/curl.log" || sleep 60
    done
    if [ "$(sha256sum "$f" | cut -c1-64)" = "$(sha256sum "$f.check" 2>/dev/null | cut -c1-64)" ]; then
      st=no_pride_sha1,size_ok,second_download_same; else st=SECOND_DOWNLOAD_DIFFERS; fi
    rm -f "$f.check"
  fi
  rs=$( [ -s "$f" ] && sha256sum "$f" | cut -c1-64)
  stem=${file%.*}; mz=$D/$stem.mzML
  if { [ "$st" = sha1_ok ] || [ "$st" = no_pride_sha1,size_ok,second_download_same ]; } && [ ! -s "$mz" ]; then
    rm -rf "$D/tmp.$stem"; mkdir -p "$D/tmp.$stem"
    timeout 14400 "$TRFP" -i "$f" -o "$D/tmp.$stem" -f 2 > "$D/$stem.trfp.log" 2>&1 \
      && [ -s "$D/tmp.$stem/$stem.mzML" ] && mv "$D/tmp.$stem/$stem.mzML" "$mz"
    rm -rf "$D/tmp.$stem"
  fi
  ms=-; mb=-; n1=-; n2=-; nc=-; nt=-; ins=-; chk=FAIL
  if [ -s "$mz" ]; then
    ms=$(sha256sum "$mz" | cut -c1-64); mb=$(stat -c %s "$mz")
    ins=$(head -n 80 "$mz" | grep -o 'name="\(Q Exactive[^"]*\|Orbitrap Astral[^"]*\|[^"]*Orbitrap[^"]*\|[^"]*Exploris[^"]*\)"' | head -1 | sed 's/name="//; s/"$//')
    read -r n1 n2 nc nt <<<"$(awk '/<spectrum /{l=0} /accession="MS:1000511" value="1"/{n1++} /accession="MS:1000511" value="2"/{l=2; n2++}
      l==2 && /accession="MS:1000041"/ { nc++ }
      l==2 && /accession="MS:1000827"/ { match($0, /value="[0-9.]+"/); t[substr($0, RSTART, RLENGTH)]=1 }
      END { k=0; for (x in t) k++; print n1 + 0, n2 + 0, nc + 0, k }' "$mz")"
    want="Q Exactive"; [ "$cls" = astral ] && want="Orbitrap Astral"
    case "$ins" in "$want"*) iok=1 ;; *) iok=0 ;; esac
    [ $iok = 1 ] && [ "$n1" -gt 0 ] && [ "$n2" -ge 5000 ] && [ $((nc * 10)) -ge $((n2 * 9)) ] && [ "$nt" -ge 1000 ] && chk=ok
  fi
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$cls" "$acc" "$file" "$bytes" "$sha1" "$st" "$rs" \
    "${mz#$ROOT/}" "$mb" "$ms" "${ins:--}" "$n1" "$n2" "$nc" "$nt" "$chk" >> "$OUT"
done
echo STAGE_DONE > "$OD/stage_$ROLE.$ACC.done"
