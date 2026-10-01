#!/usr/bin/env bash
# -tag_lengths against the real binary. A multi-length run must write, for each
# spectrum, the rows the single-length runs write, in ascending length, except
# that a tag several lengths report -- same tag, charge, flanking masses and
# gapped flag -- is kept only from the length whose best E-value for it is
# lowest (ties to the shorter), with all of that length's rows for it. Checked
# in file mode (with extension, so the realised lengths of different seeds
# overlap and the `length` column cannot reconstruct the order), with -fasta
# and -recon_out, and in -stream, where each block's #end count is the rows
# written. A single length gives exactly -tag_length's output, and a length
# whose own run is refused refuses the whole run.
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

# merge ORDER STATS FILE... : the rows a multi-length run must write, from the
# single-length runs' outputs given in ascending length (the header is the
# first file's). ORDER lists the spectrum IDs in input order. -stream outputs
# work too: their #end sentinels are skipped on input, and with ENDS=1 each
# spectrum's rows are followed by "#end <id> <rows>". Writes to STATS:
#   dropped   rows a shorter or better-scoring length already reports
#   repeated  kept keys one length reports more than once
#   unsure    keys the printed values cannot decide: several lengths report
#             them, and either their lowest best E-values tie in print, or one
#             length reports the key twice -- the tagger never reports one
#             (tag, charge, masses) twice in a length, so two such rows are
#             distinct tags whose masses differ beyond the printed decimals
# and, per kept or dropped row, "<file index> <spectrum> <tag> K|D" to
# STATS.rows for the recon check.
merge() {
  local order="$1" stats="$2"; shift 2
  head -1 "$1"
  awk -F'\t' -v stats="$stats" -v ends="${ENDS:-0}" '
    FILENAME == ARGV[1] { order[++n] = $0; next }
    FNR == 1 { ++nf; next }
    /^#/ { next }
    { k = $1 SUBSEP $2 SUBSEP $4 SUBSEP $5 SUBSEP $6 SUBSEP $8
      i = ++nr[nf, $1]; row[nf, $1, i] = $0; key[nf, $1, i] = k; tag[nf, $1, i] = $2
      if (++cnt[nf, k] == 1 || $9 + 0 < best[nf, k]) best[nf, k] = $9 + 0 }
    END {
      for (s = 1; s <= n; ++s) {
        id = order[s]; kept = 0
        for (f = 1; f <= nf; ++f)
          for (i = 1; i <= nr[f, id]; ++i) {
            k = key[f, id, i]
            if (!(k in win)) {
              w = 0; lens = 0; rep = 0
              for (g = 1; g <= nf; ++g) {
                if (!((g, k) in best)) continue
                ++lens; if (cnt[g, k] > 1) rep = 1
                if (!w || best[g, k] < best[w, k]) w = g
              }
              ties = 0
              for (g = 1; g <= nf; ++g) if (((g, k) in best) && best[g, k] == best[w, k]) ++ties
              win[k] = w
              if (lens > 1 && (ties > 1 || rep)) ++unsure
              if (cnt[w, k] > 1) ++repeated
            }
            fate = win[k] == f ? "K" : "D"
            if (fate == "K") { print row[f, id, i]; ++kept } else ++dropped
            print f "\t" id "\t" tag[f, id, i] "\t" fate > (stats ".rows")
          }
        if (ends) print "#end " id " " kept
      }
      print "dropped", dropped + 0 > stats
      print "repeated", repeated + 0 > stats
      print "unsure", unsure + 0 > stats
    }' "$order" "$@"
}
count() { awk -v k="$2" '$1 == k { print $2 }' "$1"; }

# merge_recon ORDER STATS RECON... : the -recon_out rows a multi-length run
# must write, from the single-length runs' recon files (ascending length, as
# given to merge, whose STATS.rows says which tag rows were kept). A recon row
# names its tag by sequence only, so its rows go with the fate of that
# sequence's tag rows in the spectrum and length; a sequence with kept and
# dropped rows there cannot be split and counts as "mixed" in STATS.recon.
merge_recon() {
  local order="$1" stats="$2"; shift 2
  head -1 "$1"
  awk -F'\t' -v stats="$stats.recon" '
    FILENAME == ARGV[1] { order[++n] = $0; next }
    FILENAME == ARGV[2] { k = $1 SUBSEP $2 SUBSEP $3; fate[k] = (k in fate && fate[k] != $4) ? "M" : $4; next }
    FNR == 1 { ++nf; next }
    { i = ++nr[nf, $1]; row[nf, $1, i] = $0; tag[nf, $1, i] = $2 }
    END {
      for (s = 1; s <= n; ++s)
        for (f = 1; f <= nf; ++f)
          for (i = 1; i <= nr[f, order[s]]; ++i) {
            k = f SUBSEP order[s] SUBSEP tag[f, order[s], i]
            if (!(k in fate)) { ++orphan; continue }
            if (fate[k] == "M") ++mixed
            else if (fate[k] == "K") print row[f, order[s], i]
            else ++dropped
          }
      print "dropped", dropped + 0 > stats
      print "mixed", mixed + 0 > stats
      print "orphan", orphan + 0 > stats
    }' "$order" "$stats.rows" "$@"
}

# The printed values must decide every key the check meets, the dedup must
# drop something and a key one length reports twice must be kept whole, or
# the comparison would prove little.
decisive() {
  [ "$(count "$1" unsure)" = 0 ] \
    || fail "$2: $(count "$1" unsure) keys the printed values cannot decide; the check would guess"
  [ "$(count "$1" dropped)" -gt 0 ] || fail "$2: no row dropped; the check would prove nothing"
}

# ------------------------------------------------------------------ file mode
ARGS=(-extension 2 -fragment_tolerance 0.3 -fragment_tolerance_unit Da -threads 2)
# Unsorted and with a duplicate: the run must still use 3, 4, 5 in that order.
"$BIN" -in "$IN" -out "$TMP/multi.tsv" -tag_lengths 5 3 4 3 "${ARGS[@]}" >"$TMP/multi.log" 2>&1 \
  || fail "multi-length run exited $? ($(tail -1 "$TMP/multi.log"))"
for L in 3 4 5; do
  "$BIN" -in "$IN" -out "$TMP/$L.tsv" -tag_length "$L" "${ARGS[@]}" >/dev/null 2>&1 \
    || fail "-tag_length $L run failed"
  [ "$(wc -l < "$TMP/$L.tsv")" -gt 1 ] || fail "-tag_length $L wrote no rows; the check would prove nothing"
done

# Spectrum IDs in input order.
grep -o '<spectrum [^>]*' "$IN" | sed 's/.*[[:space:]]id="\([^"]*\)".*/\1/' > "$TMP/order"
[ -s "$TMP/order" ] || fail "no spectrum IDs read from $IN"
merge "$TMP/order" "$TMP/stats" "$TMP/3.tsv" "$TMP/4.tsv" "$TMP/5.tsv" > "$TMP/expected.tsv"
decisive "$TMP/stats" "file mode"
[ "$(count "$TMP/stats" repeated)" -gt 0 ] \
  || fail "file mode: no kept key that one length reports twice; the check would prove nothing"
same "$TMP/expected.tsv" "$TMP/multi.tsv" "file mode: the multi-length TSV is not the single-length runs' rows with cross-length repeats dropped"

# One length is exactly -tag_length.
"$BIN" -in "$IN" -out "$TMP/one.tsv" -tag_lengths 4 "${ARGS[@]}" >/dev/null 2>&1 || fail "-tag_lengths 4 run failed"
same "$TMP/4.tsv" "$TMP/one.tsv" "-tag_lengths 4 does not write what -tag_length 4 writes"

# ------------------------------------------------------- -fasta and -recon_out
# The small database's derived floor (4 residues) lies inside length 3's reach
# (3 + 2*2), so the one shared index must cover length 3's realised range, not
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
merge "$TMP/order" "$TMP/fstats" "$TMP/f3.tsv" "$TMP/f4.tsv" "$TMP/f5.tsv" > "$TMP/fexpected.tsv"
decisive "$TMP/fstats" "-fasta"
same "$TMP/fexpected.tsv" "$TMP/fmulti.tsv" "-fasta: the multi-length TSV is not the single-length runs' rows with cross-length repeats dropped"
merge_recon "$TMP/order" "$TMP/fstats" "$TMP/f3.recon.tsv" "$TMP/f4.recon.tsv" "$TMP/f5.recon.tsv" \
  > "$TMP/fexpected.recon.tsv"
[ "$(count "$TMP/fstats.recon" mixed)" = 0 ] && [ "$(count "$TMP/fstats.recon" orphan)" = 0 ] \
  || fail "-recon_out: $(count "$TMP/fstats.recon" mixed) recon rows of a partly dropped sequence, $(count "$TMP/fstats.recon" orphan) of no tag row; the check would guess"
[ "$(count "$TMP/fstats.recon" dropped)" -gt 0 ] \
  || fail "-recon_out: no recon row dropped; the check would prove nothing"
same "$TMP/fexpected.recon.tsv" "$TMP/fmulti.recon.tsv" "-recon_out: the multi-length recon TSV does not place exactly the kept tag rows"

# Length 3 reaches at most 3 + 2*2 = 7 residues, short of a floor of 8: its own
# run is refused, so the multi-length run must be too, with the same exit code.
"$BIN" -in "$IN" -out "$TMP/r.tsv" -tag_length 3 -min_filter_length 8 "${FARGS[@]}" >/dev/null 2>&1
rc_one=$?
"$BIN" -in "$IN" -out "$TMP/r.tsv" -tag_lengths 3 5 -min_filter_length 8 "${FARGS[@]}" >/dev/null 2>&1
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
# No gaps: on these ideal ladders, gap readings put distinct tags on the same
# printed masses, which the printed values cannot tell apart.
SARGS=(-stream -extension 1 -gaps 0 -fragment_tolerance 0.02 -fragment_tolerance_unit Da)
"$BIN" "${SARGS[@]}" -tag_lengths 3 4 < "$BLOCKS" > "$TMP/s.multi" 2>/dev/null || fail "multi-length -stream failed"
"$BIN" "${SARGS[@]}" -tag_length 3 < "$BLOCKS" > "$TMP/s.3" 2>/dev/null || fail "-stream -tag_length 3 failed"
"$BIN" "${SARGS[@]}" -tag_length 4 < "$BLOCKS" > "$TMP/s.4" 2>/dev/null || fail "-stream -tag_length 4 failed"
grep -q '^#end pep2 [1-9]' "$TMP/s.4" || fail "-stream -tag_length 4 tagged nothing; the check would prove nothing"
awk '/^#end / { print $2 }' "$TMP/s.3" > "$TMP/s.order"
ENDS=1 merge "$TMP/s.order" "$TMP/sstats" "$TMP/s.3" "$TMP/s.4" > "$TMP/s.expected"
decisive "$TMP/sstats" "-stream"
same "$TMP/s.expected" "$TMP/s.multi" "-stream: the multi-length output is not each block's single-length rows with cross-length repeats dropped, counted in #end"

echo "multilength_test: all checks passed ($(($(wc -l < "$TMP/multi.tsv") - 1)) file rows," \
     "$(count "$TMP/stats" dropped) dropped, $(count "$TMP/stats" repeated) repeated keys kept)"
