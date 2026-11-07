#!/usr/bin/env bash
# The FASTag 1.12 NEW gate cases (PLAN-INTEGRATION section 4.2), outside
# refs-1.10.0, on node data. Same digest format and PASS rule as the shared
# /ceph/ibmi/abi/oliver/fastag-gate/gate.sh, which stays unchanged: a case
# PASSes when every non-info line of its digest equals the reference.
#
#   gate_new_cases.sh <FASTag binary or wrapper> <outdir>    run, compare with $GATE_NEW_REFS
#   gate_new_cases.sh --refs <binary> <outdir>               run and (re)write $GATE_NEW_REFS
#   gate_new_cases.sh --stage                                copy inputs to $GATE_NEW_IN, verify sha256
#
# Cases (each added by its item; public PXD data only):
#   dia_refuse    #7  PXD006096 raw Orbitrap DIA (msconvert mzML): exit 11, the FASTAG_REFUSED
#                     line, and the sentinel at -out unchanged (nothing written)
#   pseudo_pass   #7  the DIAspeXtract 1.7.0 pseudo-DDA mzML of the same run: exit 0, and the
#                     tags equal to -acquisition_check off
#   profile_mzml  #9  PXD000865 (Q Exactive, TMT8, profile MS2), -pick_profile auto
# The references here are DEVELOPMENT references (tools/gate-1.12/refs-dev,
# written by the item's branch build and reviewed with it). They move into
# refs-1.12.0 only with the user's approval of that reference set.
#
# Environment: GATE_NEW_IN (default /scratch/kohlbach/gate-in-1.12),
# GATE_NEW_REFS (default tools/gate-1.12/refs-dev next to this script),
# GATE_CASES or GATE_NEW_CASES (space-separated subset), GATE_THREADS (default 32).
set -u
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
IN_DIR=${GATE_NEW_IN:-/scratch/kohlbach/gate-in-1.12}
REFS=${GATE_NEW_REFS:-$HERE/gate-1.12/refs-dev}
THREADS=${GATE_THREADS:-32}
export OPENMS_TMPDIR=${OPENMS_TMPDIR:-/dev/shm/$USER-tmp}
export OPENBLAS_NUM_THREADS=${OPENBLAS_NUM_THREADS:-1}
export OPENMS_DISABLE_UPDATE_CHECK=ON
mkdir -p "$OPENMS_TMPDIR"

ALL_CASES="dia_refuse pseudo_pass profile_mzml"
CASES=${GATE_CASES:-${GATE_NEW_CASES:-$ALL_CASES}}

PA=/ceph/ibmi/abi/oliver/prose-auto-20261029
# relative path under GATE_NEW_IN, persistent source (read only), sha256; tab-separated
INPUTS="PXD006096/100815_MM_ABPP_H1993_DMSO_DIA1_new.mzML	$PA/bench2/mzml/PXD006096/100815_MM_ABPP_H1993_DMSO_DIA1_new.mzML	1a27eee3b164ec355620a02a20860a7f49b2b900fe5a6cfc9fd14bc11d6b0d42
PXD006096/100815_MM_ABPP_H1993_DMSO_DIA1_new.pseudo.mzML	$PA/borg_ho_v9b/out/PXD006096/auto/100815_MM_ABPP_H1993_DMSO_DIA1_new.pseudo.mzML	6020bd4eaa135083d9dbd4455e1d9b2b38cb1c29c1f0f72db3cfa0cdebab27da
PXD000865/0299_F1_R1_P77628B02_TMT8.mzML	/ceph/ibmi/abi/projects/proteomics/kuster_proteome/MZML/8/0299_F1_R1_P77628B02_TMT8.mzML	8ec0952126809c9516cb476f5a79287d1b26ce11dcf631a78d6342340c54441c"

define_case() { # sets PXD IN ARGS
  ARGS=()
  case $1 in
    dia_refuse)   PXD=PXD006096; IN=PXD006096/100815_MM_ABPP_H1993_DMSO_DIA1_new.mzML ;;
    pseudo_pass)  PXD=PXD006096; IN=PXD006096/100815_MM_ABPP_H1993_DMSO_DIA1_new.pseudo.mzML ;;
    profile_mzml) PXD=PXD000865; IN=PXD000865/0299_F1_R1_P77628B02_TMT8.mzML
                  ARGS=(-pick_profile auto -fixed_modifications 'Carbamidomethyl (C)' 'TMT6plex (K)' 'TMT6plex (N-term)') ;;
    *) echo "unknown case $1" >&2; return 1 ;;
  esac
  IN=$IN_DIR/$IN
}

needed() { # the input paths the selected cases read
  local c; for c in $CASES; do define_case "$c" 2>/dev/null && echo "${IN#$IN_DIR/}"; done
}

check_inputs() {
  local ok=0 rel src want need
  need=$(needed)
  while IFS=$'\t' read -r rel src want; do
    grep -qxF "$rel" <<< "$need" || continue
    [ -f "$IN_DIR/$rel" ] || { echo "missing $IN_DIR/$rel (gate_new_cases.sh --stage)"; ok=1; continue; }
    [ "$(sha256sum "$IN_DIR/$rel" | cut -d' ' -f1)" = "$want" ] || { echo "sha256 mismatch: $IN_DIR/$rel"; ok=1; }
  done <<< "$INPUTS"
  return $ok
}

stage() {
  local rel src want need
  need=$(needed)
  while IFS=$'\t' read -r rel src want; do
    grep -qxF "$rel" <<< "$need" || continue
    mkdir -p "$IN_DIR/$(dirname "$rel")"
    [ -f "$IN_DIR/$rel" ] || cp "$src" "$IN_DIR/$rel" || return 1
  done <<< "$INPUTS"
  check_inputs && echo "inputs OK in $IN_DIR"
}

summary() { echo "summary $(grep -m1 -E '^[0-9]+ MS2 spectra, [0-9]+ tags' "$1" || echo MISSING)"; }

digest_case() { # in the case directory; $1 = exit code (as gate.sh)
  local rc=$1 f
  echo "summary $(grep -m1 -E '^[0-9]+ MS2 spectra, [0-9]+ tags' run.log || echo MISSING)"
  echo "exit $rc"
  for f in $(ls | sort); do
    case $f in
      run.log|time.txt) ;;
      *.mzML)
        echo "mzml $f masked=$(sed -E -e 's/(name="completion time" value=")[^"]*"/\1MASKED"/' \
              -e 's/(<software id="so_dp_[^"]*" version=")[^"]*"/\1MASKED"/' "$f" | sha256sum | cut -d' ' -f1)" ;;
      *) echo "file $f $(sha256sum "$f" | cut -d' ' -f1)" ;;
    esac
  done
  # Not compared: what picking did, for the reader of a failing diff.
  echo "info $(grep -m1 -oE '^mzML: centroided [0-9]+ profile spectra on read.*' run.log || echo 'mzML: no centroiding line')"
}

run_case() { # $1 case, $2 case dir; writes the digest to stdout, sets rc and the time file
  local c=$1 d=$2 rc_off
  case $c in
    dia_refuse) # #7: refused before any output opens
      printf 'sentinel\n' > "$d/tags.tsv"
      ( cd "$d" && /usr/bin/time -f '%e %M' -o time.txt "$BIN" -in "$IN" -out tags.tsv "${ARGS[@]}" -threads "$THREADS" > run.log 2>&1 ); rc=$?
      echo "exit $rc"
      echo "refused $(grep -m1 '^FASTAG_REFUSED ' "$d/run.log" || echo MISSING)"
      echo "sentinel tags.tsv $(sha256sum "$d/tags.tsv" | cut -d' ' -f1)"
      echo "files $(cd "$d" && ls | grep -v -x -e run.log -e tags.tsv -e time.txt | tr '\n' ' ')"
      echo "advice $(grep -c 'DIAspeXtract -in ' "$d/run.log")"
      [ $rc = 11 ] && rc=0 ;;  # the expected outcome
    pseudo_pass) # #7: passes, tags equal to -acquisition_check off
      ( cd "$d" && /usr/bin/time -f '%e %M' -o time.txt "$BIN" -in "$IN" -out tags.tsv "${ARGS[@]}" -threads "$THREADS" > run.log 2>&1 ); rc=$?
      mkdir -p "$d/off"
      ( cd "$d/off" && "$BIN" -in "$IN" -out tags.tsv "${ARGS[@]}" -acquisition_check off -threads "$THREADS" > run.log 2>&1 ); rc_off=$?
      summary "$d/run.log"
      echo "exit $rc"
      echo "acquisition $(grep -m1 -o '^Acquisition check: [^ ]*' "$d/run.log" || echo MISSING)"
      echo "file tags.tsv $(sha256sum "$d/tags.tsv" | cut -d' ' -f1)"
      if [ $rc_off = 0 ] && cmp -s "$d/tags.tsv" "$d/off/tags.tsv"; then echo "equals_off yes"; else echo "equals_off no"; fi ;;
    *)
      ( cd "$d" && /usr/bin/time -f '%e %M' -o time.txt "$BIN" -in "$IN" -out tags.tsv "${ARGS[@]}" -threads "$THREADS" > run.log 2>&1 ); rc=$?
      (cd "$d" && digest_case $rc) ;;
  esac
}

mode=check
case ${1:-} in
  --refs) mode=refs; shift ;;
  --stage) stage; exit $? ;;
  ""|-h|--help) sed -n 2,24p "$0"; exit 2 ;;
esac
BIN=${1:?binary}
BIN=$(readlink -f "$BIN")
OUT=${2:?outdir}
mkdir -p "$OUT"; OUT=$(readlink -f "$OUT")
check_inputs || exit 1

VER=$("$BIN" --help 2>&1 | grep -m1 '^Version:')
{ echo "binary $BIN"; echo "sha256 $(sha256sum "$BIN" | cut -d' ' -f1)"
  [ -f "$(dirname "$BIN")/FASTag.bin" ] && echo "FASTag.bin sha256 $(sha256sum "$(dirname "$BIN")/FASTag.bin" | cut -d' ' -f1)"
  echo "$VER"; echo "host $(hostname) threads $THREADS date $(date -Is)"; } > "$OUT/BINARY.txt"
echo "gate (1.12 new cases): $VER, $mode, out $OUT"

fails=""
for c in $CASES; do
  define_case "$c" || { fails="$fails $c"; continue; }
  d=$OUT/$c; rm -rf "$d"; mkdir -p "$d"
  rc=0
  run_case "$c" "$d" > "$OUT/$c.digest"
  read -r wall rss < <(tail -n1 "$d/time.txt")
  if [ $mode = refs ]; then
    [ $rc = 0 ] || { echo "$c: exit $rc, see $d/run.log"; fails="$fails $c"; continue; }
    echo "$c: ran (${wall}s, ${rss} KB)"
  else
    ref=$REFS/$c.digest
    if [ ! -f "$ref" ]; then status=NOREF
    elif diff -q <(grep -v '^info ' "$ref") <(grep -v '^info ' "$OUT/$c.digest") > /dev/null; then status=PASS
    else status=FAIL; fi
    [ $status = PASS ] || fails="$fails $c"
    echo "$c: $status (${wall}s)"
    [ $status = FAIL ] && diff <(grep -v '^info ' "$ref") <(grep -v '^info ' "$OUT/$c.digest") | sed 's/^/    /'
  fi
done

if [ $mode = refs ]; then
  [ -z "$fails" ] || { echo "refs NOT written, failing cases:$fails"; exit 1; }
  mkdir -p "$REFS"
  for c in $CASES; do cp "$OUT/$c.digest" "$REFS/"; cp "$OUT/BINARY.txt" "$REFS/BINARY.$c.txt"; done
  echo "refs written to $REFS for:$CASES"
  exit 0
fi
[ -z "$fails" ] && { echo "NEW CASES PASS ($(echo $CASES | wc -w) cases)"; exit 0; }
echo "NEW CASES FAIL:$fails"; exit 1
