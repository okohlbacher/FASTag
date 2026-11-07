#!/usr/bin/env bash
# The -out_spectra compatibility shim (1.12 P3): at defaults the exported
# mzML lists exactly the "parameter: <name>" entries 1.11 wrote
# (FASTag::Cli::kLegacyOutSpectraParameters, printed by cli_param_test), so
# options added in 1.12 do not change the exported bytes. A legacy option at a
# non-default value is still listed with that value.
#
# Compared as sets: the ORDER follows OpenMS's MetaInfoRegistry, i.e. the
# order in which the process first registered each name, and that differs
# between inputs (on this fixture TOPPBase's common options come right after
# -out, on the gate's PXD010783 case they come last) -- identically for 1.11
# and this binary. The gate compares the bytes.
# Exits 77 (ctest SKIP) when the binary cannot start.
set -u
BIN="$1"
LIST="$2"   # cli_param_test
IN="$3"

if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-outspectra-test.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
names() { tr -d '\r' < "$1" | grep -o 'name="parameter: [^"]*"' | sed 's/^name="parameter: //; s/"$//' | LC_ALL=C sort; }

"$LIST" --print-legacy-out-spectra-parameters | tr -d '\r' | LC_ALL=C sort > "$TMP/legacy.txt" || fail "cli_param_test cannot print the list"
[ "$(wc -l < "$TMP/legacy.txt")" -eq 77 ] || fail "the legacy list does not have 77 names"

"$BIN" -in "$IN" -out "$TMP/t.tsv" -out_spectra "$TMP/s.mzML" -threads 2 > "$TMP/log" 2>&1 \
  || { cat "$TMP/log" >&2; fail "FASTag -out_spectra"; }
names "$TMP/s.mzML" > "$TMP/written.txt"
if ! cmp -s "$TMP/legacy.txt" "$TMP/written.txt"; then
  diff "$TMP/legacy.txt" "$TMP/written.txt" | head -10 >&2
  fail "the -out_spectra parameter list at defaults is not the 1.11 list"
fi

"$BIN" -in "$IN" -out "$TMP/t2.tsv" -out_spectra "$TMP/s2.mzML" -max_tags 7 -threads 2 > "$TMP/log" 2>&1 \
  || { cat "$TMP/log" >&2; fail "FASTag -out_spectra -max_tags 7"; }
names "$TMP/s2.mzML" > "$TMP/written2.txt"
cmp -s "$TMP/legacy.txt" "$TMP/written2.txt" || fail "a non-default legacy option changed the list"
tr -d '\r' < "$TMP/s2.mzML" | grep -q 'name="parameter: max_tags" type="xsd:int" value="7"' \
  || tr -d '\r' < "$TMP/s2.mzML" | grep 'parameter: max_tags' | grep -q '"7"' \
  || fail "-max_tags 7 is not listed with its value"
# A 1.12 option set away from its default is listed, a flag as well as a
# string (a flag's registered default never equals its Param value, so the
# shim asks the flag; #9 added the first 1.12 options).
"$BIN" -in "$IN" -out "$TMP/t3.tsv" -out_spectra "$TMP/s3.mzML" -pick_profile auto -pick_unknown_type -threads 2 \
  > "$TMP/log" 2>&1 || { cat "$TMP/log" >&2; fail "FASTag -out_spectra -pick_profile auto -pick_unknown_type"; }
names "$TMP/s3.mzML" > "$TMP/written3.txt"
printf 'pick_profile\npick_unknown_type\n' | cat - "$TMP/legacy.txt" | LC_ALL=C sort > "$TMP/want3.txt"
cmp -s "$TMP/want3.txt" "$TMP/written3.txt" || { diff "$TMP/want3.txt" "$TMP/written3.txt" >&2; fail "non-default 1.12 options are not listed exactly"; }
tr -d '\r' < "$TMP/s3.mzML" | grep 'parameter: pick_profile' | grep -q '"auto"' || fail "-pick_profile auto is not listed with its value"
tr -d '\r' < "$TMP/s3.mzML" | grep 'parameter: pick_unknown_type' | grep -q '"true"' || fail "-pick_unknown_type is not listed as true"
echo "out_spectra_params_test: passed"
