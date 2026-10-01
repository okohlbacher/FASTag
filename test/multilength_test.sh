#!/usr/bin/env bash
# -tag_lengths against the real binary. A multi-length run must write, for each
# spectrum, exactly the rows the single-length runs write, concatenated in
# ascending length: in file mode (with extension, so the realised lengths of
# different seeds overlap and the `length` column cannot reconstruct the
# order) and in -stream, where each block's #end count is the sum.
# Exits 77 (ctest SKIP) when the binary cannot start.
set -u
BIN="$1"
IN="$2"

if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi

TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-multilength-test.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

# ------------------------------------------------------------------ file mode
ARGS=(-extension 1 -fragment_tolerance 0.3 -fragment_tolerance_unit Da -threads 2)
# Unsorted and with a duplicate: the run must still use 3, 4, 5 in that order.
"$BIN" -in "$IN" -out "$TMP/multi.tsv" -tag_lengths 5 3 4 3 "${ARGS[@]}" >"$TMP/multi.log" 2>&1 \
  || fail "multi-length run exited $? ($(tail -1 "$TMP/multi.log"))"
for L in 3 4 5; do
  "$BIN" -in "$IN" -out "$TMP/$L.tsv" -tag_length "$L" "${ARGS[@]}" >/dev/null 2>&1 \
    || fail "-tag_length $L run failed"
  [ "$(wc -l < "$TMP/$L.tsv")" -gt 1 ] || fail "-tag_length $L wrote no rows; the check would prove nothing"
done

# Spectrum IDs in input order, then each spectrum's single-length rows in
# ascending length.
grep -o '<spectrum [^>]*' "$IN" | sed 's/.*[[:space:]]id="\([^"]*\)".*/\1/' > "$TMP/order"
[ -s "$TMP/order" ] || fail "no spectrum IDs read from $IN"
{
  head -1 "$TMP/3.tsv"
  awk -F'\t' 'FILENAME == ARGV[1] { order[++n] = $0; next }
              FNR == 1 { next }
              { rows[FILENAME, $1] = rows[FILENAME, $1] $0 "\n" }
              END { for (i = 1; i <= n; ++i)
                      for (f = 2; f < ARGC; ++f) printf "%s", rows[ARGV[f], order[i]] }' \
      "$TMP/order" "$TMP/3.tsv" "$TMP/4.tsv" "$TMP/5.tsv"
} > "$TMP/expected.tsv"
cmp -s "$TMP/expected.tsv" "$TMP/multi.tsv" \
  || fail "file mode: the multi-length TSV is not the per-spectrum concatenation of the single-length runs"

# ---------------------------------------------------------------------- stream
# Two blocks: synthetic b/y ladders of PEPTIDEK and VGAHAGEYGAEALER.
BLOCKS="$TMP/blocks"
{
  echo "spectrum pep1 464.73474 2"
  i=0
  for mz in 98.06004 147.11280 227.10263 276.15540 324.15540 391.18234 425.20308 504.26640 \
            538.28714 605.31408 653.31408 702.36685 782.35668 831.40944; do
    i=$((i + 1)); echo "$mz $((100 + (i * 37) % 90))"
  done
  echo
  echo "spectrum pep2 765.37079 2"
  for mz in 100.0757 157.0972 175.1190 228.1343 304.1615 365.1932 417.2456 436.2303 488.2827 \
            493.2518 617.3253 622.2944 688.3624 745.3839 785.3577 842.3791 908.4472 913.4163 \
            1037.4898 1042.4588 1094.5113 1113.4960 1165.5484 1226.5800 1302.6073 1355.6226 \
            1373.6444 1430.6659; do
    i=$((i + 1)); echo "$mz $((100 + (i * 37) % 90))"
  done
  echo
} > "$BLOCKS"
SARGS=(-stream -fragment_tolerance 0.02 -fragment_tolerance_unit Da)
"$BIN" "${SARGS[@]}" -tag_lengths 3 4 < "$BLOCKS" > "$TMP/s.multi" 2>/dev/null || fail "multi-length -stream failed"
"$BIN" "${SARGS[@]}" -tag_length 3 < "$BLOCKS" > "$TMP/s.3" 2>/dev/null || fail "-stream -tag_length 3 failed"
"$BIN" "${SARGS[@]}" -tag_length 4 < "$BLOCKS" > "$TMP/s.4" 2>/dev/null || fail "-stream -tag_length 4 failed"
grep -q '^#end pep2 [1-9]' "$TMP/s.4" || fail "-stream -tag_length 4 tagged nothing; the check would prove nothing"
{
  head -1 "$TMP/s.3"
  awk 'FNR == 1 { ++f; b = 0; next }
       /^#end / { id[b] = $2; n[f, b] = $3; ++b; if (b > nb) nb = b; next }
       { rows[f, b] = rows[f, b] $0 "\n" }
       END { for (i = 0; i < nb; ++i) printf "%s%s#end %s %d\n", rows[1, i], rows[2, i], id[i], n[1, i] + n[2, i] }' \
      "$TMP/s.3" "$TMP/s.4"
} > "$TMP/s.expected"
cmp -s "$TMP/s.expected" "$TMP/s.multi" \
  || fail "-stream: the multi-length output is not each block's single-length rows concatenated"

echo "multilength_test: all checks passed ($(($(wc -l < "$TMP/multi.tsv") - 1)) file rows)"
