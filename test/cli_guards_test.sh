#!/usr/bin/env bash
# Guards on the command line and the output paths, against the real binary:
# inputs that used to run with the wrong result and exit 0, or destroy a file.
#   - an unknown modification name is refused (it ran without the shift)
#   - an output naming the input, or two outputs naming one file, is refused
#     (-out_spectra = -in truncated the raw file before re-reading it)
#   - a NaN / inf precursor in a -stream header is a bad header (it tagged
#     with nterm_mass 0, a false N-terminal claim)
#   - an entrapment database inside the target's key space is refused even
#     when it produced no event (every q_db came out 0)
#   - a native ID with a tab or newline stays one TSV field
#   - -max_peaks above the 1024 table ceiling is refused
#   - an empty -out_spectra result removes an earlier run's file there
# Exits 77 (ctest SKIP) when the binary cannot start.
set -u
BIN="$1"
IN="$2"
DB="$3"

if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-cli-guards.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
ARGS=(-fragment_tolerance 0.3 -fragment_tolerance_unit Da -threads 2)

# Unknown modification.
"$BIN" -in "$IN" -out "$TMP/m.tsv" -fixed_modifications "Carbamidomethy (C)" "${ARGS[@]}" \
  >"$TMP/m.log" 2>&1 && fail "an unknown modification name ran (exit 0)"
grep -q "Unknown modification" "$TMP/m.log" || fail "no message naming the unknown modification"

# -out_spectra = -in, by the same name and through a symlink.
cp "$IN" "$TMP/run.mzML"
ln -s "$TMP/run.mzML" "$TMP/link.mzML"
sum_before=$(cksum < "$TMP/run.mzML")
"$BIN" -in "$TMP/run.mzML" -out "$TMP/o.tsv" -out_spectra "$TMP/run.mzML" "${ARGS[@]}" \
  >"$TMP/o.log" 2>&1 && fail "-out_spectra equal to -in ran (exit 0)"
# Git Bash on Windows makes ln -s a copy, which is no alias: test only a real symlink.
if [ -L "$TMP/link.mzML" ]; then
  "$BIN" -in "$TMP/link.mzML" -out "$TMP/o.tsv" -out_spectra "$TMP/run.mzML" "${ARGS[@]}" \
    >"$TMP/o2.log" 2>&1 && fail "-out_spectra aliasing -in through a symlink ran (exit 0)"
fi
[ "$(cksum < "$TMP/run.mzML")" = "$sum_before" ] || fail "the input file was modified"
# Two outputs, one file.
"$BIN" -in "$IN" -out "$TMP/same.tsv" -fasta "$DB" -recon_out "$TMP/same.tsv" -tag_length 4 "${ARGS[@]}" \
  >"$TMP/s.log" 2>&1 && fail "-recon_out equal to -out ran (exit 0)"
grep -q "name the same file" "$TMP/s.log" || fail "no message naming the colliding outputs"
# /dev/null twice is fine (not a regular file).
"$BIN" -in "$IN" -out /dev/null -fasta "$DB" -recon_out /dev/null -tag_length 4 "${ARGS[@]}" >/dev/null 2>&1 \
  || fail "-out and -recon_out both /dev/null was refused"

# NaN / inf precursor in -stream.
OUT=$(printf 'spectrum a nan 2\n300.1 10\n400.2 20\n\nspectrum b inf 2\n300.1 10\n\nspectrum c 500.25 2\n300.1 10\n400.2 20\n413.317 15\n' \
      | "$BIN" -stream -fragment_tolerance 0.3 -fragment_tolerance_unit Da 2>/dev/null)
[ "$(printf '%s\n' "$OUT" | grep -c '^#error ')" -eq 2 ] || { printf '%s\n' "$OUT" >&2; fail "nan/inf precursor headers were not refused"; }
printf '%s\n' "$OUT" | grep -q '^#end c ' || fail "a valid block after the bad ones lost its sentinel"

# Entrapment database identical to the target.
"$BIN" -in "$IN" -out "$TMP/e.tsv" -fasta "$DB" -entrapment_fasta "$DB" -tag_length 4 "${ARGS[@]}" \
  >"$TMP/e.log" 2>&1 && fail "an entrapment database equal to the target ran (exit 0)"
grep -q "entire key" "$TMP/e.log" || fail "no message about the shared key space"

# A native ID with a tab: same byte length (keeps the index valid), id and idRef alike.
sed 's/scan=11472"/s\&#9;11472"/g' "$IN" > "$TMP/tab.mzML"
grep -q 's&#9;11472' "$TMP/tab.mzML" || fail "fixture edit did not apply"
"$BIN" -in "$TMP/tab.mzML" -out "$TMP/tab.tsv" "${ARGS[@]}" >"$TMP/tab.log" 2>&1 \
  || fail "the run with a tab in a native ID failed ($(tail -1 "$TMP/tab.log"))"
grep -q 's 11472' "$TMP/tab.tsv" || fail "the tab-carrying native ID wrote no row"
BAD=$(awk -F'\t' 'NF != 12' "$TMP/tab.tsv" | head -1)
[ -z "$BAD" ] || fail "a row with a stray field: $BAD"

# -out_spectra with nothing to write removes an earlier run's file there.
echo stale > "$TMP/stale.mzML"
"$BIN" -in "$IN" -out "$TMP/z.tsv" -out_spectra "$TMP/stale.mzML" -max_evalue 1e-300 "${ARGS[@]}" \
  >"$TMP/z.log" 2>&1 && fail "an empty -out_spectra result exited 0"
[ ! -e "$TMP/stale.mzML" ] || fail "an earlier run's -out_spectra file was left in place"

# -max_peaks above the table ceiling.
"$BIN" -in "$IN" -out "$TMP/p.tsv" -max_peaks 5000 "${ARGS[@]}" >/dev/null 2>&1 \
  && fail "-max_peaks 5000 ran (exit 0)"

echo "cli_guards_test: all checks passed"
