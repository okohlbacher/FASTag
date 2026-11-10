#!/bin/bash
# FASTag 1.13 label discovery held-out test 3 staging (copy of the test 1 script, ROOT changed; itself a copy of acceptance/1.12/scripts/stage_pride.sh, ROOT changed);
# FASTag 1.12 held-out staging from PRIDE (no FASTag run, no scoring).
# Downloads each listed file over https from the PRIDE FTP mirror into data:/scratch/kohlbach/fastag-heldout-1.12/<dir>/
# (the /ceph/ibmi/abi group quota is full, 2026-11-08), checks PRIDE's SHA-1 where PRIDE gives one, otherwise the
# PRIDE size plus an independent second download with the same sha256 (as E7-03), records sha256, and converts:
#   .raw      ThermoRawFileParser 2.0.0 -f 2 (prose-auto env; add -p with route trfp_profile)
#   .d.zip    unzip + diaweaver-7ed1169 FileConverter -threads 8
#   copy      an existing file on /ceph or /scratch (url = its path): copied, sha256 checked against the list;
#             copy+trfp_profile copies a Thermo .raw and converts it with -p
# Usage: stage_pride.sh <list.tsv> <out.tsv> <parallel>
# list: key, dir (relative), file, bytes, pride_sha1 ('-' none), url_or_path, route (trfp|trfp_profile|fileconverter|copy|none), sha256_expected ('-')
set -u
ROOT=${ROOT:-/scratch/kohlbach/fastag-labeldisc/heldout3/in}
TRFP=${TRFP:-/ceph/ibmi/abi/oliver/prose-auto-20261029/env/bin/thermorawfileparser}  # #4/#11 override: the harness TRFP (2.0.0 too)
FC=/ceph/ibmi/abi/oliver/spextract/diaweaver-7ed1169/bin/FileConverter
PY=/ceph/ibmi/abi/oliver/envs/prepdda/bin/python
SD=$(cd "$(dirname "$0")" && pwd)
one() {
  IFS=$'\t' read -r key dir file bytes sha1 url route exp <<< "$1"
  local D=$ROOT/$dir; mkdir -p "$D"; cd "$D" || return
  local st="" f="$D/$file"
  if [ "${route%%+*}" = copy ]; then
    [ -s "$f" ] || { cp "$url" "$f.part" && mv "$f.part" "$f"; }
    st=copied
  else
    local ok=0
    for a in 1 2 3 4; do
      if [ -s "$f" ]; then
        if [ "$sha1" != - ]; then [ "$(sha1sum "$f" | cut -c1-40)" = "$sha1" ] && { ok=1; break; }
        else [ "$(stat -c %s "$f")" = "$bytes" ] && { ok=1; break; }; fi
        rm -f "$f"
      fi
      curl -sS -f -L --retry 3 -o "$f.part" "$url" 2>>"$D/curl.log" && mv "$f.part" "$f"
    done
    if [ $ok = 1 ] && [ "$sha1" != - ]; then st=sha1_ok
    elif [ $ok = 1 ]; then
      curl -sS -f -L --retry 3 -o "$f.check" "$url" 2>>"$D/curl.log"
      if [ "$(sha256sum "$f" | cut -c1-64)" = "$(sha256sum "$f.check" 2>/dev/null | cut -c1-64)" ]; then st=no_pride_sha1,size_ok,second_download_same; else st=SECOND_DOWNLOAD_DIFFERS; fi
      rm -f "$f.check"
    else st=DOWNLOAD_FAILED; fi
  fi
  local sha=$( [ -s "$f" ] && sha256sum "$f" | cut -c1-64)
  [ "$exp" != - ] && [ "$exp" != "$sha" ] && st="$st;SHA256_MISMATCH_EXPECTED_$exp"
  local out="" rc=- note=""
  case "${route#copy+}" in
    trfp|trfp_profile)
      local stem=${file%.*}; out=$D/$stem.mzML; local p=""; [ "${route#copy+}" = trfp_profile ] && { p="-p"; out=$D/$stem.profile.mzML; }
      if [ ! -s "$out" ]; then rm -rf "$D/tmp.$stem"; mkdir -p "$D/tmp.$stem"
        timeout 14400 $TRFP -i "$f" -o "$D/tmp.$stem" -f 2 $p > "$D/$stem.trfp.log" 2>&1; rc=$?
        [ $rc = 0 ] && [ -s "$D/tmp.$stem/$stem.mzML" ] && mv "$D/tmp.$stem/$stem.mzML" "$out"; rm -rf "$D/tmp.$stem"
      else rc=0; fi
      note="ThermoRawFileParser 2.0.0 ($TRFP) -f 2 $p" ;;
    fileconverter)
      local T=$D/unz.${file%%.*}; mkdir -p "$T"
      ls -d "$T"/*.d >/dev/null 2>&1 || $PY -I -m zipfile -e "$f" "$T" > "$D/unzip.log" 2>&1
      $PY -I "$SD/fix_zip_paths.py" "$T"
      local d=$(ls -d "$T"/*.d 2>/dev/null | head -1)
 [ -z "$d" ] && d=$(find "$T" -maxdepth 3 -type d -iname '*.d' | head -1)
      if [ -z "$d" ] && [ -f "$T/analysis.tdf" ]; then   # archive holds the .d contents without the .d directory
        local s0=$(basename "$file"); s0=${s0%.[Zz]ip}; s0=${s0%.d}; mkdir -p "$T/$s0.d"
        find "$T" -mindepth 1 -maxdepth 1 ! -name "$s0.d" -exec mv {} "$T/$s0.d/" \; ; d="$T/$s0.d"; fi
      if [ -z "$d" ]; then rc=97; note="no .d in archive"; else
        local stem=$(basename "$d" .d); out=$D/$stem.mzML
        note="tdf $(sha256sum "$d/analysis.tdf" 2>/dev/null | cut -c1-64);tdf_bin $(sha256sum "$d/analysis.tdf_bin" 2>/dev/null | cut -c1-64)"
        if [ ! -s "$out" ]; then timeout 10800 $FC -in "$d" -out "$D/tmp.$stem.mzML" -threads 8 > "$D/$stem.fc.log" 2>&1; rc=$?
          [ $rc = 0 ] && mv "$D/tmp.$stem.mzML" "$out"; rm -f "$D/tmp.$stem.mzML"; else rc=0; fi
        note="diaweaver-7ed1169 FileConverter -threads 8; $note"; rm -rf "$T"
      fi ;;
    *) rc=NA; note="no conversion" ;;
  esac
  local osha="" ob=""
  [ -n "$out" ] && [ -s "$out" ] && [ "$rc" = 0 ] && { osha=$(sha256sum "$out" | cut -c1-64); ob=$(stat -c %s "$out"); }
  printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n" "$key" "$dir/$file" "$st" "$sha" "$rc" "${out#$ROOT/}" "$ob" "$osha" "$note"
}
export -f one; export ROOT TRFP FC PY SD
xargs -d '\n' -P "${3:-4}" -I{} bash -c 'one "{}"' < "$1" > "$2"
echo "STAGE_DONE $(date -Is)" > "$2.done"
