#!/usr/bin/env bash
# Thread-count determinism on the mzML path, for the tag TSV AND every
# secondary output: the vendored fixture at -threads 1, 3 and 8 must write
# byte-identical files. (fastag_test 5 repeats one spectrum in one thread;
# mzpeak_roundtrip compares thread counts on mzPeak input only.)
# Exits 77 (ctest SKIP) when the binary cannot start.
set -u
BIN="$1"
IN="$2"
DB="$3"
DATA="$4"   # data/digest
if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi
export FASTAG_DIGEST_DIR="$DATA"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-threads-test.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

OUTS=(tags recon delta digest label massgap glyco)
for t in 1 3 8; do
  d="$TMP/t$t"; mkdir -p "$d"
  "$BIN" -in "$IN" -out "$d/tags.tsv" -threads "$t" \
    -tag_length 4 -extension 1 -fragment_tolerance 0.3 -fragment_tolerance_unit Da \
    -fasta "$DB" -recon_out "$d/recon.tsv" -delta_out "$d/delta.tsv" \
    -digest_out "$d/digest.tsv" -label_out "$d/label.tsv" -massgap_out "$d/massgap.tsv" \
    -glyco -glyco_out "$d/glyco.tsv" -recon_id_out "$d/ids.idXML" \
    >"$d/log" 2>&1 || { cat "$d/log" >&2; fail "-threads $t run failed"; }
done
for f in "${OUTS[@]}"; do
  [ "$(wc -l < "$TMP/t1/$f.tsv")" -gt 1 ] || fail "$f.tsv has no rows at -threads 1; the check would prove nothing"
  for t in 3 8; do
    cmp -s "$TMP/t1/$f.tsv" "$TMP/t$t/$f.tsv" || fail "$f.tsv differs between -threads 1 and $t"
  done
done
# idXML carries a creation date; compare it without that line.
for t in 3 8; do
  cmp -s <(grep -v 'date=' "$TMP/t1/ids.idXML") <(grep -v 'date=' "$TMP/t$t/ids.idXML") \
    || fail "ids.idXML differs between -threads 1 and $t"
done
# 1.12 E2: -complement_rule both (with the fragment-tied window and mid-p)
# is deterministic too.
for t in 1 3 8; do
  "$BIN" -in "$IN" -out "$TMP/t$t/compl.tsv" -threads "$t" -fragment_tolerance 0.3 -fragment_tolerance_unit Da \
    -complement_rule both -complement_tol_factor 0.2 -complement_tolerance_unit fragment -complement_midp \
    >"$TMP/t$t/compl.log" 2>&1 || { cat "$TMP/t$t/compl.log" >&2; fail "-complement_rule both at -threads $t failed"; }
done
[ "$(wc -l < "$TMP/t1/compl.tsv")" -gt 1 ] || fail "compl.tsv has no rows at -threads 1"
for t in 3 8; do
  cmp -s "$TMP/t1/compl.tsv" "$TMP/t$t/compl.tsv" || fail "-complement_rule both differs between -threads 1 and $t"
done
echo "threads_test: all checks passed (${#OUTS[@]} TSVs and the idXML identical at 1, 3 and 8 threads)"
