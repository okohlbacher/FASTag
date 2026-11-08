#!/bin/bash
# E7-03 pseudo-DDA stratum (registry E7-10: "to be generated from the 48 DIA files before scoring (DIAspeXtract at its
# pinned release, diaTracer for .d), with their sha256 added before the run"). No FASTag run, no scoring.
#   Thermo DIA (mzML from TRFP): constant-mobility copy (prose-auto with_constant_mobility, 1/K0 = 1.0), then
#     DIAspeXtract 1.7.0 (/ceph/ibmi/abi/oliver/spextract/v1.7.0) -threads 8 with prose-auto's NO_MOBILITY_OPTIONS
#   Bruker .d DIA: diaTracer 2.2.1 (-t 24 -mC 0.3 -dI 0.01 -dR 3 -rM 500 -mF 1 -mO 0.1 -r 0, as dt_only.sh)
#   SCIEX .wiff: not convertible here (no mzML), so no pseudo-DDA either
# Usage: e703_pseudo.sh <list: id<TAB>kind(thermo|bruker)<TAB>input> <out.tsv> <parallel>
set -u
DST=/scratch/kohlbach/fastag-heldout-1.12/e7-03
DT=/ceph/ibmi/abi/oliver/spextract/diatracer
PAPY=/ceph/ibmi/abi/oliver/prose-auto-20261029/env/bin/python
PAH=/ceph/ibmi/abi/oliver/prose-auto-20261029/harness/v9c_code
JT=/scratch/kohlbach/fastag112-heldout/e703/jtmp
one() {
  IFS=$'\t' read -r id kind inp <<< "$1"
  local P=$DST/$id/pseudo; mkdir -p "$P"; local stem=$(basename "$inp"); stem=${stem%.mzML}; stem=${stem%.d}
  local out=$P/$stem.pseudo.mzML rc=0 note=""
  if [ ! -s "$out" ]; then
    if [ "$kind" = thermo ]; then
      OMP_NUM_THREADS=4 OPENBLAS_NUM_THREADS=4 MKL_NUM_THREADS=4 $PAPY -c "import sys; sys.path.insert(0, '$PAH'); from prose_auto.external import with_constant_mobility as w; w(sys.argv[1], sys.argv[2])" \
        "$inp" "$P/$stem.im.mzML" > "$P/im.log" 2>&1; rc=$?
      if [ $rc = 0 ]; then
        ( source /ceph/ibmi/abi/oliver/spextract/v1.7.0/env.sh; timeout 43200 $SPX_BIN -in "$P/$stem.im.mzML" -out "$P/tmp.$stem.pseudo.mzML" -threads 8 \
          -trace:detector openms -gate:delta_im 1.0 -assembly:im_weight_sigma 0 -charge:im_charge_veto false \
          -assembly:twin_im_tolerance -1 -trace:im_slice_merge -1 ) > "$P/spx.log" 2>&1; rc=$?
        [ $rc = 0 ] && mv "$P/tmp.$stem.pseudo.mzML" "$out"; rm -f "$P/$stem.im.mzML" "$P/tmp.$stem.pseudo.mzML"
      fi
      note="constant-IM copy + DIAspeXtract 1.7.0 (no-mobility options) -threads 8"
    else
      mkdir -p "$JT" "$P/dt"
      local m="$(dirname "$inp")/${stem}_diatracer.mzML"   # diaTracer writes <stem>_diatracer.mzML next to the .d
      [ -s "$m" ] || ( cd $DT && LC_ALL=C LANG=C LD_LIBRARY_PATH=./ext/bruker timeout 43200 java -Xmx200G -Djna.tmpdir=$JT -Djava.io.tmpdir=$JT \
          -Djna.library.path=./ext/bruker -jar diaTracer-2.2.1.jar -d "$inp" -t 24 -w "$P/dt" \
          -mC 0.3 -dI 0.01 -dR 3 -rM 500 -mF 1 -mO 0.1 -r 0 ) > "$P/dt.log" 2>&1; rc=$?
      [ $rc = 0 ] && [ -s "$m" ] && mv "$m" "$out"; rm -rf "$P/dt"
      note="diaTracer 2.2.1 -t 24"
    fi
  fi
  local s="" b=""; [ -s "$out" ] && { s=$(sha256sum "$out" | cut -c1-64); b=$(stat -c %s "$out"); }
  printf "%s\t%s\t%s\t%s\t%s\t%s\n" "$id" "$rc" "${out#$DST/}" "$b" "$s" "$note"
}
export -f one; export DST DT PAPY PAH JT
xargs -d '\n' -P "${3:-2}" -I{} bash -c 'one "{}"' < "$1" > "$2"
echo "PSEUDO_DONE $(date -Is)" > "$2.done"
