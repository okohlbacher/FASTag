#!/bin/bash
# E7-03 staging and conversion (FASTag 1.12 acceptance). Copies every drawn file from the E7-03 download dir to
# data:/scratch/kohlbach/fastag-heldout-1.12/e7-03/<id>/raw (hard links; ceph abi quota full) (sha256 checked against e7-03-manifest.tsv) and converts:
#   Thermo .raw        -> ThermoRawFileParser 2.0.0 -f 2 (prose-auto env, as the E7-02 corpus)
#   Bruker .d(.zip)    -> unzip, diaweaver-7ed1169 FileConverter -threads 8 (as E7-02); tdf/tdf_bin sha256 recorded
#   deposited mzML     -> copied
#   SCIEX .wiff        -> not convertible on Linux (msconvert, Windows); recorded, nothing run
# No FASTag run, no scoring. Usage: e703_conv.sh <list.tsv> <out.tsv> <parallel>
# list: id, file, sha256, route, extra(name|bytes|sha256|check or empty)
set -u
SRC=/scratch/kohlbach/fastag112-e7-freeze/e703/files
DST=/scratch/kohlbach/fastag-heldout-1.12/e7-03   # /ceph/ibmi/abi is at its 80 TiB group quota (2026-11-08)
TMP=/scratch/kohlbach/fastag112-heldout/e703/dtmp
TRFP=/ceph/ibmi/abi/oliver/prose-auto-20261029/env/bin/thermorawfileparser
FC=/ceph/ibmi/abi/oliver/spextract/diaweaver-7ed1169/bin/FileConverter
PY=/ceph/ibmi/abi/oliver/envs/prepdda/bin/python
one() {
  IFS=$'\t' read -r id file sha route extra <<< "$1"
  local C=$DST/$id; mkdir -p "$C/raw" "$C/conv"
  local st=copied
  if [ ! -s "$C/raw/$file" ]; then ln "$SRC/$id/$file" "$C/raw/$file" 2>/dev/null || { cp "$SRC/$id/$file" "$C/raw/$file.part" && mv "$C/raw/$file.part" "$C/raw/$file"; }; fi
  local got=$(sha256sum "$C/raw/$file" | cut -d' ' -f1)
  [ "$got" = "$sha" ] || st="RAW_SHA256_MISMATCH:$got"
  if [ -n "$extra" ]; then IFS='|' read -r en eb es ec <<< "$extra"
    [ -s "$C/raw/$en" ] || ln "$SRC/$id/$en" "$C/raw/$en" 2>/dev/null || cp "$SRC/$id/$en" "$C/raw/$en"
    [ "$(sha256sum "$C/raw/$en" | cut -d' ' -f1)" = "$es" ] || st="$st;COMPANION_SHA256_MISMATCH"; fi
  local out="" rc=- note=""
  case "$route" in
    ThermoRawFileParser*)
      local stem=${file%.*}; out=$C/conv/$stem.mzML
      if [ ! -s "$out" ]; then rm -rf "$C/conv/tmp"; mkdir -p "$C/conv/tmp"
        timeout 14400 $TRFP -i "$C/raw/$file" -o "$C/conv/tmp" -f 2 > "$C/conv/trfp.log" 2>&1; rc=$?
        [ $rc = 0 ] && [ -s "$C/conv/tmp/$stem.mzML" ] && mv "$C/conv/tmp/$stem.mzML" "$out"; rm -rf "$C/conv/tmp"; else rc=0; fi
      note="ThermoRawFileParser 2.0.0 -f 2" ;;
    unpack*)
      local T=$TMP/$id; mkdir -p "$T"
      ls -d "$T"/*.d >/dev/null 2>&1 || $PY -I -m zipfile -e "$C/raw/$file" "$T" > "$C/conv/unzip.log" 2>&1
      local d=$(ls -d "$T"/*.d 2>/dev/null | head -1)
      if [ -z "$d" ]; then d=$(find "$T" -maxdepth 3 -type d -iname '*.d' | head -1); fi
      if [ -z "$d" ] && [ -f "$T/analysis.tdf" ]; then   # archive holds the .d contents without the .d directory
        local s0=$(basename "$file"); s0=${s0%.[Zz]ip}; s0=${s0%.d}; mkdir -p "$T/$s0.d"
        find "$T" -mindepth 1 -maxdepth 1 ! -name "$s0.d" -exec mv {} "$T/$s0.d/" \; ; d="$T/$s0.d"; fi
      if [ -z "$d" ]; then rc=97; note="no .d directory in archive"; else
        local stem=$(basename "$d" .d); out=$C/conv/$stem.mzML
        local tdf="$d/analysis.tdf"
        if [ -f "$tdf" ]; then note="tdf $(sha256sum "$tdf" | cut -c1-64);tdf_bin $(sha256sum "$d/analysis.tdf_bin" | cut -c1-64)"
        else note="no analysis.tdf ($(ls "$d" | head -5 | tr '\n' ' '))"; fi
        if [ ! -s "$out" ]; then rm -rf "$C/conv/tmp"; mkdir -p "$C/conv/tmp"
          timeout 10800 $FC -in "$d" -out "$C/conv/tmp/$stem.mzML" -threads 8 > "$C/conv/fileconverter.log" 2>&1; rc=$?
          [ $rc = 0 ] && [ -s "$C/conv/tmp/$stem.mzML" ] && mv "$C/conv/tmp/$stem.mzML" "$out"; rm -rf "$C/conv/tmp"; else rc=0; fi
        note="diaweaver-7ed1169 FileConverter -threads 8; $note"
      fi ;;
    "as deposited"*)
      out=$C/conv/$file; [ -s "$out" ] || cp "$C/raw/$file" "$out"; rc=0; note="deposited mzML, copied" ;;
    msconvert*)
      rc=NA; note="NOT CONVERTIBLE HERE: SCIEX .wiff needs msconvert (ProteoWizard vendor reader) on Windows" ;;
    *) rc=NA; note="unknown route $route" ;;
  esac
  local osha="" ob=""
  if [ -n "$out" ] && [ -s "$out" ] && [ "$rc" = 0 ]; then osha=$(sha256sum "$out" | cut -d' ' -f1); ob=$(stat -c %s "$out"); fi
  printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n" "$id" "$st" "$route" "$rc" "${out#$DST/}" "$ob" "$osha" "$note"
}
export -f one; export SRC DST TMP TRFP FC PY
mkdir -p "$TMP" "$DST"
xargs -d '\n' -P "${3:-6}" -I{} bash -c 'one "{}"' < "$1" > "$2"
echo "E703_CONV_DONE $(date -Is)" >> "$2.done"
