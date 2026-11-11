#!/bin/bash
# compltol held-out 2: stage and qualify one candidate file. No FASTag run.
#   stage.sh <candidates.tsv> <pxd> <file.raw>
# https download from the PRIDE FTP mirror (resumed; size checked, PRIDE SHA-1 where PRIDE gives one),
# ThermoRawFileParser -f 2, MS2 analyser count from the mzML filter strings, Sage 0.14.7 truth with the sage.json
# that acceptance/1.12/scorers/truth_config.py wrote from truth/compltol-H2-candidates.tsv.
# Writes $H/qual/<pxd>__<stem>.tsv and .done.
set -u
H=${CT_H2:-/scratch/kohlbach/b113/compltol/heldout2}
TRFP=/ceph/ibmi/abi/oliver/prose-auto-20261029/env/bin/thermorawfileparser
SAGE=/ceph/ibmi/abi/oliver/opt/sage-0.14.7/sage-v0.14.7-x86_64-unknown-linux-gnu/sage
export RAYON_NUM_THREADS=${SAGE_THREADS:-12}
line=$(awk -F'\t' -v p="$2" -v f="$3" '$3 == p && $4 == f' "$1"); [ -n "$line" ] || exit 2
IFS=$'\t' read -r stratum rank acc file bytes sha1 url fasta ins hh <<< "$line"
stem=${file%.*}; R=$H/raw/$acc; mkdir -p "$R" "$H/staged/compltol/H2/$acc" "$H/qual"
f=$R/$file; mz=$H/staged/compltol/H2/$acc/$stem.mzML; T=$H/truth/compltol-H2/compltol/H2/$acc/$stem; Q=$H/qual/${acc}__$stem
st=DOWNLOAD_FAILED
for a in $(seq 1 20); do
  if [ -s "$f" ] && [ "$(stat -c %s "$f")" = "$bytes" ]; then
    if [ "$sha1" = - ]; then st=size_ok; elif [ "$(sha1sum "$f" | cut -c1-40)" = "$sha1" ]; then st=sha1_ok; else st=SHA1_DIFFERS; fi
    break
  fi
  curl -sS -f -L -C - --retry 3 --connect-timeout 30 --speed-time 120 --speed-limit 10000 -o "$f" "$url" 2>>"$R/curl.log" || sleep 20
done
if [ "$st" != DOWNLOAD_FAILED ] && [ "$st" != SHA1_DIFFERS ] && [ ! -s "$mz" ]; then
  rm -rf "$R/tmp.$stem"; mkdir -p "$R/tmp.$stem"
  timeout 7200 "$TRFP" -i "$f" -o "$R/tmp.$stem" -f 2 > "$R/$stem.trfp.log" 2>&1 \
    && [ -s "$R/tmp.$stem/$stem.mzML" ] && mv "$R/tmp.$stem/$stem.mzML" "$mz"
  rm -rf "$R/tmp.$stem"
fi
an=-; src=-
if [ -s "$mz" ]; then
  an=$(grep -o 'MS:1000512" value="[A-Z]*MS [^"]* ms2 ' "$mz" | awk '{sub(/.*value="/, ""); k[$1]++} END{for (x in k) printf "%s%s:%d", (n++ ? "," : ""), x, k[x]}')
  if [ -s "$T/sage.json" ] && ! grep -q '^SAGE_RC=' "$T/sage.log" 2>/dev/null; then
    ( cd "$T" && timeout 7200 $SAGE --disable-telemetry-i-dont-want-to-improve-sage -o . sage.json > sage.log 2>&1; echo SAGE_RC=$? >> sage.log )
  fi
  src=$(grep -o 'SAGE_RC=.*' "$T/sage.log" 2>/dev/null | cut -d= -f2)
fi
psm=-
[ -s "$T/results.sage.tsv" ] && psm=$(awk -F'\t' 'NR == 1 {for (i = 1; i <= NF; i++) c[$i] = i; next}
  $c["label"] == 1 && $c["rank"] == 1 && $c["spectrum_q"] <= 0.01 {n++; z = $c["charge"]; if (z > 4) z = 4; k[z]++}
  END{printf "all:%d,z1:%d,z2:%d,z3:%d,z4+:%d", n, k[1], k[2], k[3], k[4]}' "$T/results.sage.tsv")
printf 'stratum\tdraw_rank\tpxd\tfile\tdownload\traw_sha256\tmzml_bytes\tmzml_sha256\tms2_filter\tsage_rc\ttarget_psms_q01\ttruth_sha256\n%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
  "$stratum" "$rank" "$acc" "$file" "$st" "$([ -s "$f" ] && sha256sum "$f" | cut -c1-64)" "$([ -s "$mz" ] && stat -c %s "$mz")" \
  "$([ -s "$mz" ] && sha256sum "$mz" | cut -c1-64)" "$an" "$src" "$psm" "$([ -s "$T/results.sage.tsv" ] && sha256sum "$T/results.sage.tsv" | cut -c1-64)" > "$Q.tsv"
echo STAGE_DONE > "$Q.done"
