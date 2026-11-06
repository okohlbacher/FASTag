#!/bin/bash
# FASTag 1.12 NEW gate cases (PLAN-INTEGRATION section 4.2), kept apart from
# the frozen refs-1.10.0 gate: /ceph/ibmi/abi/oliver/fastag-gate/gate.sh and
# its 9 cases are not touched. These cases move into refs-1.12.0 only once the
# user approves that reference set; until then they are compared against a
# development reference directory.
#
#   gate_new_cases.sh <FASTag binary or wrapper> <outdir>   run every case, compare with $GATE_NEW_REFS
#   gate_new_cases.sh --refs <binary> <refsdir>             run every case and write the references
#   gate_new_cases.sh --stage                               copy inputs to $GATE_NEW_IN, verify checksums
#
# Environment: GATE_NEW_IN (default /scratch/kohlbach/fastag112-e7/gate-in), GATE_NEW_REFS
# (reference directory, required to compare), GATE_NEW_CASES (space-separated subset),
# GATE_THREADS (default 32).
#
# Cases (public PXD data only):
#   dia_refuse   #7  PXD006096 raw Orbitrap DIA (msconvert mzML): exit 11, the FASTAG_REFUSED
#                    line, and the sentinel at -out unchanged (nothing written)
#   pseudo_pass  #7  the DIAspeXtract 1.7.0 pseudo-DDA mzML of the same run: exit 0, and the
#                    tags equal to -acquisition_check off
# Each case writes <outdir>/<case>.digest; a case PASSes when it equals the reference.
set -u
REFS=${GATE_NEW_REFS:-}
GATE_NEW_IN=${GATE_NEW_IN:-/scratch/kohlbach/fastag112-e7/gate-in}
THREADS=${GATE_THREADS:-32}
export OPENMS_TMPDIR=${OPENMS_TMPDIR:-/dev/shm/$USER-tmp}
export OPENBLAS_NUM_THREADS=${OPENBLAS_NUM_THREADS:-1}
export OPENMS_DISABLE_UPDATE_CHECK=ON
mkdir -p "$OPENMS_TMPDIR"

PA=/ceph/ibmi/abi/oliver/prose-auto-20261029
# relative path under GATE_NEW_IN, persistent source (read only), sha256
INPUTS="PXD006096/100815_MM_ABPP_H1993_DMSO_DIA1_new.mzML $PA/bench2/mzml/PXD006096/100815_MM_ABPP_H1993_DMSO_DIA1_new.mzML 1a27eee3b164ec355620a02a20860a7f49b2b900fe5a6cfc9fd14bc11d6b0d42
PXD006096/100815_MM_ABPP_H1993_DMSO_DIA1_new.pseudo.mzML $PA/borg_ho_v9b/out/PXD006096/auto/100815_MM_ABPP_H1993_DMSO_DIA1_new.pseudo.mzML 6020bd4eaa135083d9dbd4455e1d9b2b38cb1c29c1f0f72db3cfa0cdebab27da"

ALL_CASES="dia_refuse pseudo_pass"
CASES=${GATE_NEW_CASES:-$ALL_CASES}

define_case() { # sets IN ARGS
  ARGS=()
  case $1 in
    dia_refuse)  IN=PXD006096/100815_MM_ABPP_H1993_DMSO_DIA1_new.mzML ;;
    pseudo_pass) IN=PXD006096/100815_MM_ABPP_H1993_DMSO_DIA1_new.pseudo.mzML ;;
    *) echo "unknown case $1" >&2; return 1 ;;
  esac
  IN=$GATE_NEW_IN/$IN
}

check_inputs() {
  local rel src sum ok=0
  while read -r rel src sum; do
    [ -z "$rel" ] && continue
    [ "$(sha256sum "$GATE_NEW_IN/$rel" 2>/dev/null | cut -d' ' -f1)" = "$sum" ] || { echo "input checksum FAILED: $rel" >&2; ok=1; }
  done <<< "$INPUTS"
  return $ok
}

stage() {
  local rel src sum
  while read -r rel src sum; do
    [ -z "$rel" ] && continue
    mkdir -p "$GATE_NEW_IN/$(dirname "$rel")"
    [ -f "$GATE_NEW_IN/$rel" ] || cp "$src" "$GATE_NEW_IN/$rel"
  done <<< "$INPUTS"
  check_inputs && echo "inputs OK in $GATE_NEW_IN"
}

summary() { echo "summary $(grep -m1 -E '^[0-9]+ MS2 spectra, [0-9]+ tags' "$1" || echo MISSING)"; }

run_case() { # in $OUT/<case>; writes the digest to stdout
  local c=$1 d=$OUT/$1 rc rc_off f
  rm -rf "$d"; mkdir -p "$d"
  case $c in
    dia_refuse)
      printf 'sentinel\n' > "$d/tags.tsv"
      ( cd "$d" && "$BIN" -in "$IN" -out tags.tsv "${ARGS[@]}" -threads "$THREADS" > run.log 2>&1 ); rc=$?
      echo "exit $rc"
      echo "refused $(grep -m1 '^FASTAG_REFUSED ' "$d/run.log" || echo MISSING)"
      echo "sentinel tags.tsv $(sha256sum "$d/tags.tsv" | cut -d' ' -f1)"
      echo "files $(cd "$d" && ls | grep -v -x -e run.log -e tags.tsv | tr '\n' ' ')"
      echo "advice $(grep -c 'DIAspeXtract -in ' "$d/run.log")"
      ;;
    pseudo_pass)
      ( cd "$d" && "$BIN" -in "$IN" -out tags.tsv "${ARGS[@]}" -threads "$THREADS" > run.log 2>&1 ); rc=$?
      mkdir -p "$d/off"
      ( cd "$d/off" && "$BIN" -in "$IN" -out tags.tsv "${ARGS[@]}" -acquisition_check off -threads "$THREADS" > run.log 2>&1 ); rc_off=$?
      summary "$d/run.log"
      echo "exit $rc"
      echo "acquisition $(grep -m1 -o '^Acquisition check: [^ ]*' "$d/run.log" || echo MISSING)"
      echo "file tags.tsv $(sha256sum "$d/tags.tsv" | cut -d' ' -f1)"
      if [ $rc_off = 0 ] && cmp -s "$d/tags.tsv" "$d/off/tags.tsv"; then echo "equals_off yes"; else echo "equals_off no"; fi
      ;;
  esac
}

mode=check
case ${1:-} in
  --refs) mode=refs; shift ;;
  --stage) stage; exit $? ;;
  ""|-h|--help) sed -n 2,25p "$0"; exit 2 ;;
esac
BIN=${1:?binary}
BIN=$(readlink -f "$BIN")
OUT=${2:?outdir}
if [ $mode = refs ]; then REFS_DIR=$(mkdir -p "$OUT" && readlink -f "$OUT"); OUT=$REFS_DIR/run; fi
mkdir -p "$OUT"; OUT=$(readlink -f "$OUT")
check_inputs || { echo "inputs missing or changed in $GATE_NEW_IN (gate_new_cases.sh --stage)"; exit 1; }
[ $mode = check ] && [ -z "$REFS" ] && { echo "GATE_NEW_REFS is not set"; exit 2; }
VER=$("$BIN" --help 2>&1 | grep -m1 '^Version:')
echo "gate_new_cases: $VER, $mode, out $OUT"
fails=""
for c in $CASES; do
  define_case "$c" || { fails="$fails $c"; continue; }
  run_case "$c" > "$OUT/$c.digest"
  if [ $mode = refs ]; then continue; fi
  if [ ! -f "$REFS/$c.digest" ]; then status=NOREF
  elif cmp -s "$REFS/$c.digest" "$OUT/$c.digest"; then status=PASS
  else status=FAIL; fi
  echo "$c: $status"
  [ $status = FAIL ] && diff "$REFS/$c.digest" "$OUT/$c.digest" | sed 's/^/    /'
  [ $status = PASS ] || fails="$fails $c"
done
if [ $mode = refs ]; then
  for c in $CASES; do cp "$OUT/$c.digest" "$REFS_DIR/"; done
  { echo "binary $BIN"; echo "sha256 $(sha256sum "$BIN" | cut -d' ' -f1)"
    [ -f "$(dirname "$BIN")/FASTag.bin" ] && echo "FASTag.bin sha256 $(sha256sum "$(dirname "$BIN")/FASTag.bin" | cut -d' ' -f1)"
    echo "$VER"; echo "host $(hostname) threads $THREADS date $(date -Is)"; } > "$REFS_DIR/BINARY.txt"
  echo "references written to $REFS_DIR for: $CASES"
  exit 0
fi
[ -z "$fails" ] && { echo "NEW CASES PASS ($(echo $CASES | wc -w) cases)"; exit 0; }
echo "NEW CASES FAIL:$fails"; exit 1
