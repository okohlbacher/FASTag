#!/bin/bash
# Stage the drawn runs of the msfcalib held-out test (no FASTag run, no search, no scoring).
# After acceptance/1.13/msfragger2/scripts/stage_msfragger.sh; changed: the download goes through the group's PRIDE
# archive tool (~/.claude/skills/pride/scripts/pride_get.py: HTTPS, --split 4, size and PRIDE MD5 checked, persistent
# copy under /ceph/ibmi/abi/dont-backup/pride/<PXD>/raw/), then a verified copy to $ROOT/<PXD>/; the mzML is also
# copied to the archive's mzML/ and registered there. Conversion and check unchanged.
#   stage_msfcalib.sh <stage.tsv> <out.tsv> <role: chosen|backup> [accessions...]
# Per row of the role: pride_get meta/get/stage, sha256 of the raw file, ThermoRawFileParser 2.0.0 -f 2 (centroided,
# indexed mzML), sha256 of the mzML, check: every MS2 in the Orbitrap with HCD (filter strings 'FTMS' ... 'ms2' ...
# '@hcd'), >= 5000 MS2 with a charge state. Writes one row per file to <out.tsv>.
set -u
ROOT=${MSFCALIB_DATA:-/scratch/kohlbach/acc115/msfcalib/data}
ARCH=${PRIDE_ARCHIVE:-/ceph/ibmi/abi/dont-backup/pride}
P="python3 -I $HOME/.claude/skills/pride/scripts/pride_get.py"
TRFP=/ceph/ibmi/abi/oliver/prose-auto-20261029/env/bin/thermorawfileparser
LIST=$1; OUT=$2; ROLE=$3; shift 3
ONLY=" $* "
printf 'accession\tfile\tbytes\tpride_sha1\tstatus\traw_sha256\tmzml\tmzml_bytes\tmzml_sha256\tms2\tms2_ftms_hcd\tms2_charged\tcheck\n' > "$OUT"
tail -n +2 "$LIST" | while IFS=$'\t' read -r role acc file bytes sha1 url; do
  [ "$role" = "$ROLE" ] || continue
  [ "$ONLY" = "  " ] || [[ "$ONLY" == *" $acc "* ]] || continue
  D=$ROOT/$acc; mkdir -p "$D"; f=$D/$file; st=DOWNLOAD_FAILED
  [ -s "$ARCH/$acc/metadata/files.json" ] || $P meta "$acc" > "$D/pride_meta.log" 2>&1
  if $P get "$acc" --files "$file" --method https --split 4 > "$D/pride_get.log" 2>&1 \
     && $P stage "$acc" --files "$file" --to "$D" > "$D/pride_stage.log" 2>&1; then
    # verified against PRIDE's MD5 by pride_get when PRIDE has one; the archive manifest says which
    st=$(python3 -I -c 'import json,sys; m=json.load(open(sys.argv[1]))["files"].get(sys.argv[2],{})
print("pride_md5_ok" if m.get("md5_pride") and m.get("md5")==m.get("md5_pride") else "no_pride_md5,size_ok")' \
         "$ARCH/$acc/manifest.json" "$file" 2>/dev/null || echo MANIFEST_UNREADABLE)
    [ "$(stat -c %s "$f" 2>/dev/null)" = "$bytes" ] || st="SIZE_MISMATCH($st)"
  fi
  rs=$( [ -s "$f" ] && sha256sum "$f" | cut -c1-64)
  stem=${file%.*}; mz=$D/$stem.mzML
  if [[ "$st" == pride_md5_ok || "$st" == no_pride_md5,size_ok ]] && [ ! -s "$mz" ]; then
    rm -rf "$D/tmp.$stem"; mkdir -p "$D/tmp.$stem"
    nice -n 10 timeout 14400 "$TRFP" -i "$f" -o "$D/tmp.$stem" -f 2 > "$D/$stem.trfp.log" 2>&1 \
      && [ -s "$D/tmp.$stem/$stem.mzML" ] && mv "$D/tmp.$stem/$stem.mzML" "$mz"
    rm -rf "$D/tmp.$stem"
    if [ -s "$mz" ] && [ ! -e "$ARCH/$acc/mzML/$stem.mzML" ]; then   # persistent copy, registered in the archive
      mkdir -p "$ARCH/$acc/mzML" && cp "$mz" "$ARCH/$acc/mzML/$stem.mzML.part" \
        && mv "$ARCH/$acc/mzML/$stem.mzML.part" "$ARCH/$acc/mzML/$stem.mzML" \
        && $P register "$acc" --file "$ARCH/$acc/mzML/$stem.mzML" --source "$file" --converter ThermoRawFileParser \
             --converter-version 2.0.0 --args "-f 2" --note "FASTag acc115/msfcalib held-out staging" >> "$D/pride_register.log" 2>&1
    fi
  fi
  ms=-; mb=-; n2=-; nf=-; nc=-; chk=FAIL
  if [ -s "$mz" ]; then
    ms=$(sha256sum "$mz" | cut -c1-64); mb=$(stat -c %s "$mz")
    # cvParams by accession (ThermoRawFileParser writes value= before name=): MS:1000511 ms level,
    # MS:1000512 filter string, MS:1000041 charge state
    read -r n2 nf nc <<<"$(awk '/<spectrum /{inms2=0} /accession="MS:1000511" value="2"/{inms2=1; n2++}
      inms2 && /accession="MS:1000512"/ { if ($0 ~ /FTMS/ && $0 ~ /ms2/ && $0 ~ /@hcd/) nf++ }
      inms2 && /accession="MS:1000041"/ { nc++ }
      END { print n2 + 0, nf + 0, nc + 0 }' "$mz")"
    [ "$nf" = "$n2" ] && [ "$nc" -ge 5000 ] && chk=ok
  fi
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$acc" "$file" "$bytes" "$sha1" "$st" "$rs" \
    "${mz#$ROOT/}" "$mb" "$ms" "$n2" "$nf" "$nc" "$chk" >> "$OUT"
done
echo STAGE_DONE
