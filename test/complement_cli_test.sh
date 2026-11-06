#!/usr/bin/env bash
# The 1.12 E2 complement options against the real binary:
#   - every option at its default equals the option absent (tags, and the
#     -out_spectra mzML byte for byte: the shim keeps the 1.11 parameter list)
#   - with FASTAG_BASELINE_BIN, the option absent equals FASTag 1.11.0
#   - -complement_tolerance_unit fragment alone runs at k = 0.5, and
#     -complement_tolerance (Da) does not reach the fragment unit
#   - each option away from its default reaches the tags (a 3+ precursor
#     rule, the fragment-tied window, mid-p), so the defaults are not
#     identical by accident of a disconnected option
#   - -complement_rule precursor leaves the 2+ precursors' tags unchanged
#     (c=2, z=1: the rules coincide), and changes the 3+/4+ ones
#   - a non-default value is listed in the -out_spectra provenance
#   - -stream accepts the options
# Exits 77 (ctest SKIP) when the binary cannot start.
set -u
BIN="$1"
IN="$2"

if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-complement-cli.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
run() { local name=$1; shift; "$BIN" -in "$IN" -out "$TMP/$name.tsv" -threads 2 "$@" >"$TMP/$name.log" 2>&1 \
          || { cat "$TMP/$name.log" >&2; fail "run $name failed"; }; }
# The mzML's completion time is the only run-dependent field.
mzml_masked() { tr -d '\r' < "$1" | sed -E 's/completionTime="[^"]*"//; s/<fileChecksum>[^<]*</<fileChecksum></'; }

# The same relative output names in two directories: -out and -out_spectra
# are themselves listed in the exported mzML.
mkdir -p "$TMP/a" "$TMP/e"
IN_ABS=$(cd "$(dirname "$IN")" && pwd)/$(basename "$IN")
( cd "$TMP/a" && "$BIN" -in "$IN_ABS" -out t.tsv -out_spectra s.mzML -threads 2 > log 2>&1 ) \
  || { cat "$TMP/a/log" >&2; fail "run at defaults failed"; }
( cd "$TMP/e" && "$BIN" -in "$IN_ABS" -out t.tsv -out_spectra s.mzML -threads 2 \
    -complement_rule same_charge -complement_tolerance 0.02 -complement_tol_factor 0.5 \
    -complement_tolerance_unit Da > log 2>&1 ) \
  || { cat "$TMP/e/log" >&2; fail "run with the complement defaults spelled out failed"; }
cp "$TMP/a/t.tsv" "$TMP/absent.tsv"
[ "$(wc -l < "$TMP/absent.tsv")" -gt 10 ] || fail "too few tags at defaults; the comparisons would prove nothing"
cmp -s "$TMP/a/t.tsv" "$TMP/e/t.tsv" || fail "the complement options at their defaults changed the tags"
cmp -s <(mzml_masked "$TMP/a/s.mzML") <(mzml_masked "$TMP/e/s.mzML") \
  || { diff <(mzml_masked "$TMP/a/s.mzML") <(mzml_masked "$TMP/e/s.mzML") | head -6 >&2
       fail "the complement options at their defaults changed the -out_spectra mzML"; }
grep -q 'parameter: complement' "$TMP/a/s.mzML" && fail "a default complement option is listed in -out_spectra"

if [ -n "${FASTAG_BASELINE_BIN:-}" ]; then
  "$FASTAG_BASELINE_BIN" -in "$IN" -out "$TMP/base.tsv" -threads 2 >"$TMP/base.log" 2>&1 \
    || { cat "$TMP/base.log" >&2; fail "the baseline binary failed"; }
  cmp -s "$TMP/absent.tsv" "$TMP/base.tsv" || fail "tags at defaults differ from $FASTAG_BASELINE_BIN"
  echo "complement_cli_test: defaults equal the baseline binary"
elif [ "${FASTAG_BASELINE_REQUIRED:-0}" = 1 ]; then
  fail "FASTAG_BASELINE_REQUIRED=1 but FASTAG_BASELINE_BIN is not set"
fi

# Away from the defaults. The fixture has 97 2+, 33 3+ and 9 4+ precursors.
run prec -complement_rule precursor
run both -complement_rule both
run nodeiso -no_deisotope
run nodeiso_prec -no_deisotope -complement_rule precursor
run frag -complement_tol_factor 2 -complement_tolerance_unit fragment
# The unit alone runs at k = 0.5 (its own default), not at the Da default
# 0.02 read as k: equal to k 0.5 spelled out, different from k 0.02.
run frag_unit -complement_tolerance_unit fragment
run frag_k05 -complement_tolerance_unit fragment -complement_tol_factor 0.5
run frag_k002 -complement_tolerance_unit fragment -complement_tol_factor 0.02
cmp -s "$TMP/frag_unit.tsv" "$TMP/frag_k05.tsv" || fail "-complement_tolerance_unit fragment alone is not k 0.5"
cmp -s "$TMP/frag_unit.tsv" "$TMP/frag_k002.tsv" && fail "-complement_tolerance_unit fragment alone equals k 0.02"
# -complement_tolerance is the Da window only: it does not reach the fragment unit.
run frag_da -complement_tolerance_unit fragment -complement_tolerance 0.3
cmp -s "$TMP/frag_unit.tsv" "$TMP/frag_da.tsv" || fail "-complement_tolerance changed the fragment-unit window"
run midp -complement_midp
for v in prec both frag midp; do
  cmp -s "$TMP/absent.tsv" "$TMP/$v.tsv" && fail "-complement option set ($v) left the tags unchanged"
done
cmp -s "$TMP/nodeiso.tsv" "$TMP/nodeiso_prec.tsv" && fail "-complement_rule precursor without deisotoping changed nothing"

# 2+ precursors: the precursor rule's partner is the same-charge one, so
# their rows are identical; only 3+ and 4+ rows may differ. Column 1 is the
# spectrum's native ID; the charge is read from the input.
awk -F'\t' 'NR > 1 { print $1 }' "$TMP/absent.tsv" | sort -u > "$TMP/ids.txt"
tr -d '\r' < "$IN" | awk '
  /<spectrum / { if (match($0, /id="[^"]*"/)) id = substr($0, RSTART + 4, RLENGTH - 5) }
  /name="charge state"/ { if (match($0, /value="[0-9]+"/)) print id "\t" substr($0, RSTART + 7, RLENGTH - 8) }
' > "$TMP/charges.tsv"
[ "$(awk -F'\t' '$2 == 2' "$TMP/charges.tsv" | wc -l)" -gt 50 ] || fail "could not read the 2+ precursors of the fixture"
rows_of_charge() { awk -F'\t' -v c="$2" 'NR == FNR { if ($2 == c) want[$1] = 1; next } FNR == 1 || ($1 in want)' \
                   "$TMP/charges.tsv" "$1"; }
cmp -s <(rows_of_charge "$TMP/absent.tsv" 2) <(rows_of_charge "$TMP/prec.tsv" 2) \
  || fail "-complement_rule precursor changed tags of 2+ precursors"
[ "$(rows_of_charge "$TMP/absent.tsv" 2 | wc -l)" -gt 10 ] || fail "no 2+ rows were compared"
cmp -s <(rows_of_charge "$TMP/absent.tsv" 3) <(rows_of_charge "$TMP/prec.tsv" 3) \
  && fail "-complement_rule precursor left every 3+ row unchanged"

# Provenance: a non-default value is listed in -out_spectra.
run provenance -complement_rule both -out_spectra "$TMP/both.mzML"
grep -Eq 'name="parameter: complement_rule"[^>]*value="both"' "$TMP/both.mzML" \
  || fail "-out_spectra does not list -complement_rule both"

# -stream takes the options.
"$BIN" -stream -complement_rule both -complement_midp < /dev/null > "$TMP/stream.out" 2>"$TMP/stream.log" \
  || { cat "$TMP/stream.log" >&2; fail "-stream refused the complement options"; }

echo "complement_cli_test: all checks passed"
