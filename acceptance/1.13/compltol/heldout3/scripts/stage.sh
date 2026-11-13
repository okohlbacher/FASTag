#!/bin/bash
# compltol held-out 3: stage one candidate of select/candidates.tsv. No FASTag run.
#   stage.sh download <D = heldout3 dir of the acceptance tree> <pxd>
#   stage.sh convert  <D> <pxd>
# download: https from the PRIDE FTP mirror, single connection, resumed (curl -C -), at most 20 attempts; if the file
#   is still short, the rest with 4 parallel https range requests (200 MB parts, at most 40 attempts per part). Then
#   the size must equal PRIDE's and, where PRIDE gives one, the SHA-1 must match; else DOWNLOAD_FAILED / SHA1_DIFFERS
#   (the candidate does not qualify; no other file of the project is tried).
# convert: ltq .raw: ThermoRawFileParser -f 2; MS2 analyser from the filter strings; truth table H3-ltq-itms (>= 95 %
#   ITMS) or H3-ltq-ftms (>= 95 % FTMS), else no truth. timstof .zip: python -I -m zipfile, fix_zip_paths.py, the
#   first .d directory in name order, diaweaver-7ed1169 FileConverter -threads 6 -> <stem>.mzML (stem = zip name
#   without .zip and .d); drop_noprecursor_ms2.py -> <stem>.noprec.mzML (Sage input; FASTag reads <stem>.mzML).
#   Sage 0.14.7 with the sage.json that acceptance/1.12/scorers/truth_config.py writes from the chosen table row.
# Writes $H/qual/<pxd>.tsv (one row) and $H/qual/<pxd>.<phase>.done.
set -u
PH=$1; D=$(cd "$2" && pwd); P=$3
H=${CT_H3:-/scratch/kohlbach/acc114/compltol3}
A12=$D/../../../1.12
TRFP=/ceph/ibmi/abi/oliver/prose-auto-20261029/env/bin/thermorawfileparser
FC=/ceph/ibmi/abi/oliver/spextract/diaweaver-7ed1169/bin/FileConverter
SAGE=/ceph/ibmi/abi/oliver/opt/sage-0.14.7/sage-v0.14.7-x86_64-unknown-linux-gnu/sage
PY=/ceph/ibmi/abi/oliver/envs/prepdda/bin/python
PANEL=/ceph/ibmi/abi/oliver/prose-auto-20261029/panel
export RAYON_NUM_THREADS=${SAGE_THREADS:-6}
line=$(awk -F'\t' -v p="$P" '$3 == p' "$D/select/candidates.tsv"); [ -n "$line" ] || exit 2
IFS=$'\t' read -r draw rank acc file bytes sha1 url fasta ins hh <<< "$line"
if [ "$draw" = timstof ]; then stem=${file%.[Zz][Ii][Pp]}; stem=${stem%.d}; else stem=${file%.*}; fi
R=$H/raw/$acc; S=$H/staged/compltol/H3/$acc; rel=compltol/H3/$acc/$stem; T=$H/truth/compltol-H3/$rel
mkdir -p "$R" "$S" "$H/qual"; f=$R/$file; mz=$S/$stem.mzML
if [ "$PH" = download ]; then
  for a in $(seq 1 20); do
    [ -s "$f" ] && [ "$(stat -c %s "$f")" = "$bytes" ] && break
    curl -sS -f -L -C - --retry 3 --connect-timeout 30 --speed-time 120 --speed-limit 200000 -o "$f" "$url" 2>>"$R/curl.log" || sleep 20
  done
  if ! { [ -s "$f" ] && [ "$(stat -c %s "$f")" = "$bytes" ]; }; then   # range requests for the rest
    s=$(stat -c %s "$f" 2>/dev/null || echo 0); [ -e "$f" ] || : > "$f"; Q=$R/parts; mkdir -p "$Q"
    i=0; for a in $(seq $s 200000000 $((bytes-1))); do b=$((a+199999999)); [ $b -ge $bytes ] && b=$((bytes-1))
      printf '%05d %s %s\n' $i $a $b; i=$((i+1)); done > "$Q/list"
    get() { local n=$1 a=$2 b=$3 want=$(($3-$2+1))
      for t in $(seq 1 40); do [ -s "$Q/$n" ] && [ "$(stat -c %s "$Q/$n")" = "$want" ] && return 0
        curl -sS -f -L -r $a-$b --connect-timeout 30 --speed-time 60 --speed-limit 20000 -o "$Q/$n" "$url" 2>>"$Q/curl.log" || sleep 5; done; return 1; }
    export -f get; export Q url
    xargs -P 4 -L 1 bash -c 'get "$@"' _ < "$Q/list"
    ok=1; while read -r n a b; do [ "$(stat -c %s "$Q/$n" 2>/dev/null)" = "$((b-a+1))" ] || ok=0; done < "$Q/list"
    [ $ok = 1 ] && [ "$(stat -c %s "$f")" = "$s" ] && { while read -r n a b; do cat "$Q/$n" >> "$f"; done < "$Q/list"; }
    rm -rf "$Q"
  fi
  st=DOWNLOAD_FAILED
  if [ -s "$f" ] && [ "$(stat -c %s "$f")" = "$bytes" ]; then
    if [ "$sha1" = - ]; then st=size_ok; elif [ "$(sha1sum "$f" | cut -c1-40)" = "$sha1" ]; then st=sha1_ok; else st=SHA1_DIFFERS; fi
  fi
  echo "$st" > "$H/qual/$acc.download"; echo DONE > "$H/qual/$acc.download.done"; exit 0
fi
# convert
st=$(cat "$H/qual/$acc.download" 2>/dev/null || echo DOWNLOAD_FAILED)
an=-; tab=-; drop=-; note=-
if [ "$st" = size_ok ] || [ "$st" = sha1_ok ]; then
  if [ "$draw" = ltq ]; then
    if [ ! -s "$mz" ]; then rm -rf "$R/tmp"; mkdir -p "$R/tmp"
      timeout 7200 "$TRFP" -i "$f" -o "$R/tmp" -f 2 > "$R/$stem.trfp.log" 2>&1 && [ -s "$R/tmp/$stem.mzML" ] && mv "$R/tmp/$stem.mzML" "$mz"
      rm -rf "$R/tmp"; fi
    if [ -s "$mz" ]; then
      an=$(grep -o 'MS:1000512" value="[A-Z]*MS [^"]* ms2 ' "$mz" | awk '{sub(/.*value="/, ""); k[$1]++; n++} END{for (x in k) printf "%s%s:%d", (m++ ? "," : ""), x, k[x]}')
      tab=$(awk -v s="$an" 'BEGIN{n = split(s, a, ","); for (i = 1; i <= n; i++) {split(a[i], b, ":"); t += b[2]; c[b[1]] = b[2]}
            if (t && c["ITMS"] >= 0.95 * t) print "H3-ltq-itms"; else if (t && c["FTMS"] >= 0.95 * t) print "H3-ltq-ftms"; else print "-"}')
    fi
  else
    if [ ! -s "$mz" ]; then U=$R/unz; rm -rf "$U"; mkdir -p "$U"
      $PY -I -m zipfile -e "$f" "$U" > "$R/unzip.log" 2>&1; $PY -I "$A12/scripts/fix_zip_paths.py" "$U"
      d=$(find "$U" -maxdepth 3 -type d -iname '*.d' | sort | head -1)
      if [ -z "$d" ] && [ -f "$U/analysis.tdf" ]; then mkdir -p "$U/x/$stem.d"; find "$U" -mindepth 1 -maxdepth 1 ! -name x -exec mv {} "$U/x/$stem.d/" \; ; d=$U/x/$stem.d; fi
      if [ -n "$d" ]; then note="tdf $(sha256sum "$d/analysis.tdf" | cut -c1-64)"
        timeout 10800 $FC -in "$d" -out "$S/tmp.$stem.mzML" -threads 6 > "$R/$stem.fc.log" 2>&1 && mv "$S/tmp.$stem.mzML" "$mz"
        rm -f "$S/tmp.$stem.mzML"; else note="no .d in archive"; fi
      rm -rf "$U"; fi
    if [ -s "$mz" ]; then
      [ -s "$S/$stem.noprec.mzML" ] || $PY -I "$A12/scorers/drop_noprecursor_ms2.py" "$mz" "$S/$stem.noprec.mzML" --ids "$S/$stem.dropped_ids.txt" > "$R/$stem.noprec.log" 2>&1
      drop=$(grep -oE 'dropped_ms2_without_precursor_mz [0-9]+' "$R/$stem.noprec.log" | grep -oE '[0-9]+$')
      an=tof; tab=H3-timstof
    fi
  fi
  if [ "$tab" != - ] && [ -s "$mz" ]; then
    mkdir -p "$T"
    { grep -v '^# ' "$D/truth/$tab.tsv" | head -1; awk -F'\t' -v p="$acc" '$2 == p' "$D/truth/$tab.tsv"; } > "$T/truth_row.tsv"
    $PY -I "$A12/scorers/truth_config.py" "$T/truth_row.tsv" "$H/staged" "$PANEL" "$H/truth" --manifest compltol-H3 > "$T/truth_config.log" 2>&1
    if [ -s "$T/sage.json" ] && ! grep -q '^SAGE_RC=' "$T/sage.log" 2>/dev/null; then
      ( cd "$T" && timeout 10800 $SAGE --disable-telemetry-i-dont-want-to-improve-sage -o . sage.json > sage.log 2>&1; echo SAGE_RC=$? >> sage.log )
    fi
  fi
fi
src=$(grep -o 'SAGE_RC=.*' "$T/sage.log" 2>/dev/null | cut -d= -f2); src=${src:--}
ms2=-; [ -s "$mz" ] && ms2=$(grep -c 'accession="MS:1000511" name="ms level" value="2"' "$mz")
printf 'draw\tdraw_rank\tpxd\tfile\trun\tdownload\traw_sha256\tmzml_sha256\tmzml_bytes\tms2\tms2_filter\ttruth_table\tms2_dropped_noprec\tsage_rc\ttruth_sha256\tnote\n%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
  "$draw" "$rank" "$acc" "$file" "$stem" "$st" "$([ -s "$f" ] && sha256sum "$f" | cut -c1-64)" "$([ -s "$mz" ] && sha256sum "$mz" | cut -c1-64)" \
  "$([ -s "$mz" ] && stat -c %s "$mz")" "$ms2" "$an" "$tab" "${drop:--}" "$src" \
  "$([ -s "$T/results.sage.tsv" ] && sha256sum "$T/results.sage.tsv" | cut -c1-64)" "$note" > "$H/qual/$acc.tsv"
echo DONE > "$H/qual/$acc.convert.done"
