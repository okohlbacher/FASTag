#!/usr/bin/env bash
# -tag_lengths against the real binary. A multi-length run must write, for each
# spectrum, exactly the rows the single-length runs write, concatenated in
# ascending length: in file mode (with extension, so the realised lengths of
# different seeds overlap and the `length` column cannot reconstruct the
# order), with -fasta and -recon_out, and in -stream, where each block's #end
# count is the sum. A length whose own run is refused refuses the whole run.
# Exits 77 (ctest SKIP) when the binary cannot start.
set -u
BIN="$1"
IN="$2"
DB="$3"  # proteins that tags from $IN place in

if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi

TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-multilength-test.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
# same EXPECTED ACTUAL MESSAGE: compare line endings aside -- on Windows the
# binary writes CRLF and awk drops the CR, so only the expectations built with
# awk lack it. On a mismatch, show the first differing lines before failing.
same() {
  tr -d '\r' < "$1" > "$1.lf" && tr -d '\r' < "$2" > "$2.lf" || fail "cannot read $1 or $2"
  cmp -s "$1.lf" "$2.lf" && return
  echo "$(wc -l < "$1.lf") expected vs $(wc -l < "$2.lf") actual lines; $(cmp "$1.lf" "$2.lf" 2>&1 | head -1)" >&2
  diff "$1.lf" "$2.lf" | head -8 | sed -n l >&2
  fail "$3"
}

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

# Spectrum IDs in input order. join_rows prints the first file's header, then
# each spectrum's rows from every file in turn (the single-length runs, in
# ascending length).
grep -o '<spectrum [^>]*' "$IN" | sed 's/.*[[:space:]]id="\([^"]*\)".*/\1/' > "$TMP/order"
[ -s "$TMP/order" ] || fail "no spectrum IDs read from $IN"
join_rows() {
  head -1 "$1"
  awk -F'\t' 'FILENAME == ARGV[1] { order[++n] = $0; next }
              FNR == 1 { next }
              { rows[FILENAME, $1] = rows[FILENAME, $1] $0 "\n" }
              END { for (i = 1; i <= n; ++i)
                      for (f = 2; f < ARGC; ++f) printf "%s", rows[ARGV[f], order[i]] }' \
      "$TMP/order" "$@"
}
join_rows "$TMP/3.tsv" "$TMP/4.tsv" "$TMP/5.tsv" > "$TMP/join.tsv"
same "$TMP/join.tsv" "$TMP/multi.tsv" "file mode: the multi-length TSV is not the per-spectrum concatenation of the single-length runs"

# ------------------------------------------------------- -fasta and -recon_out
# The small database's derived floor (4 residues) lies inside length 3's reach
# (3 + 2*1), so the one shared index must cover length 3's realised range, not
# only the longest seed's.
FARGS=(-fasta "$DB" "${ARGS[@]}")
"$BIN" -in "$IN" -out "$TMP/fmulti.tsv" -recon_out "$TMP/fmulti.recon.tsv" -tag_lengths 3 4 5 \
  "${FARGS[@]}" >"$TMP/fmulti.log" 2>&1 || fail "-fasta multi-length run exited $? ($(tail -1 "$TMP/fmulti.log"))"
for L in 3 4 5; do
  "$BIN" -in "$IN" -out "$TMP/f$L.tsv" -recon_out "$TMP/f$L.recon.tsv" -tag_length "$L" "${FARGS[@]}" \
    >/dev/null 2>&1 || fail "-fasta -tag_length $L run failed"
  [ "$(wc -l < "$TMP/f$L.recon.tsv")" -gt 1 ] || fail "-recon_out -tag_length $L placed nothing; the check would prove nothing"
done
awk -F'\t' 'NR > 1 && $3 < 5 { found = 1 } END { exit !found }' "$TMP/f3.tsv" \
  || fail "-fasta -tag_length 3 reported no tag shorter than 5 residues; the check would prove nothing"
join_rows "$TMP/f3.tsv" "$TMP/f4.tsv" "$TMP/f5.tsv" > "$TMP/fjoin.tsv"
same "$TMP/fjoin.tsv" "$TMP/fmulti.tsv" "-fasta: the multi-length TSV is not the per-spectrum concatenation of the single-length runs"
join_rows "$TMP/f3.recon.tsv" "$TMP/f4.recon.tsv" "$TMP/f5.recon.tsv" > "$TMP/fjoin.recon.tsv"
same "$TMP/fjoin.recon.tsv" "$TMP/fmulti.recon.tsv" "-recon_out: the multi-length recon TSV is not the per-spectrum concatenation of the single-length runs"

# Length 3 reaches at most 3 + 2*1 = 5 residues, short of a floor of 6: its own
# run is refused, so the multi-length run must be too, with the same exit code.
"$BIN" -in "$IN" -out "$TMP/r.tsv" -tag_length 3 -min_filter_length 6 "${FARGS[@]}" >/dev/null 2>&1
rc_one=$?
"$BIN" -in "$IN" -out "$TMP/r.tsv" -tag_lengths 3 5 -min_filter_length 6 "${FARGS[@]}" >/dev/null 2>&1
rc_multi=$?
[ "$rc_one" -ne 0 ] && [ "$rc_multi" -eq "$rc_one" ] \
  || fail "a length below the filter floor: its own run exited $rc_one, the multi-length run $rc_multi"

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
same "$TMP/s.expected" "$TMP/s.multi" "-stream: the multi-length output is not each block's single-length rows concatenated"

echo "multilength_test: all checks passed ($(($(wc -l < "$TMP/multi.tsv") - 1)) file rows)"
