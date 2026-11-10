#!/usr/bin/env bash
# tools/census_triage_eval.py (1.13 item 7) on a real -census -census_ids run of the fixture:
#   * the counts it reports (U, triage, rest, second-search hits in each) equal an awk recount of the census
#     table, with the columns found by name, against a second-search table written here (every second
#     spectrum of the census a target at q 0.001, the others a decoy, one a target at q 0.02);
#   * two copies of the run pool to twice the counts, and rr is unchanged;
#   * a second search naming another mzML, and a census without -census_ids, are refused (exit 2).
# Exits 77 (ctest SKIP) when the binary cannot start or python3 is missing.
set -u
BIN="$1"
HELPER="$2"   # census_ids_test (writes the identification file)
IN="$3"       # Ecoli_MS2_small.mzML
EVAL="$4"     # tools/census_triage_eval.py
PY=${FASTAG_PYTHON:-python3}

if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi
command -v "$PY" >/dev/null 2>&1 || { echo "SKIP: no $PY" >&2; exit 77; }
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-census-triage.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
ARGS=(-fragment_tolerance 0.3 -fragment_tolerance_unit Da -threads 2)
MZ=$(basename "$IN")

"$HELPER" --write-ids "$IN" "$TMP/good.idXML" good "$TMP/good.want" || fail "helper failed"
"$BIN" -in "$IN" -out "$TMP/tags.tsv" -census -census_ids "$TMP/good.idXML" ${ARGS[@]+"${ARGS[@]}"} >"$TMP/log" 2>&1 \
  || { cat "$TMP/log" >&2; fail "FASTag -census -census_ids failed"; }
"$BIN" -in "$IN" -out "$TMP/plain.tsv" -census ${ARGS[@]+"${ARGS[@]}"} >"$TMP/log2" 2>&1 || fail "FASTag -census failed"
C="$TMP/tags.census.tsv"

# second search: row k (0-based) of the census a target at q 0.001 when k is even, else a decoy; row 1 a target at
# q 0.02 instead (not a hit at 0.01)
awk -F'\t' -v mz="$MZ" 'NR == 1 { for (i = 1; i <= NF; i++) h[$i] = i; print "psm_id\tfilename\tscannr\trank\tlabel\tspectrum_q"; next }
  { k = NR - 2; lab = (k % 2 == 0) ? 1 : -1; q = 0.001; if (k == 1) { lab = 1; q = 0.02 }
    print k + 1 "\t" mz "\t" $h["spectrum"] "\t1\t" lab "\t" q }' "$C" > "$TMP/sage.tsv"

# awk recount
read -r NU NTRI TTRI TREST <<<"$(awk -F'\t' 'NR == 1 { for (i = 1; i <= NF; i++) h[$i] = i; next }
  { k = NR - 2; t = (k % 2 == 0) ? 1 : 0
    if ($h["identified"] == "0") { nu++; if ($h["triage"] == "1") { ntri++; ttri += t } else trest += t } }
  END { print nu + 0, ntri + 0, ttri + 0, trest + 0 }' "$C")"
[ "$NU" -gt 0 ] && [ "$NTRI" -gt 0 ] && [ "$NTRI" -lt "$NU" ] || fail "fixture gives no contrast: U=$NU triage=$NTRI"

printf 'run\tcensus\tsecond\tmzml\nA\t%s\t%s\t%s\n' "$C" "$TMP/sage.tsv" "$MZ" > "$TMP/runs1.tsv"
printf 'run\tcensus\tsecond\tmzml\nA\t%s\t%s\t%s\nB\t%s\t%s\t%s\n' "$C" "$TMP/sage.tsv" "$MZ" "$C" "$TMP/sage.tsv" "$MZ" \
  > "$TMP/runs2.tsv"
"$PY" "$EVAL" "$TMP/runs1.tsv" --boot 0 --out "$TMP/e1.tsv" || fail "scorer failed"
"$PY" "$EVAL" "$TMP/runs2.tsv" --boot 200 --out "$TMP/e2.tsv" || fail "scorer failed (2 runs)"
v() { awk -F'\t' -v s="$2" -v k="$3" '$1 == s && $2 == k { print $3; f = 1 } END { if (!f) print "MISSING" }' "$1"; }
[ "$(v "$TMP/e1.tsv" A n_u)" = "$NU" ] || fail "n_u $(v "$TMP/e1.tsv" A n_u) != $NU"
[ "$(v "$TMP/e1.tsv" A n_triage)" = "$NTRI" ] || fail "n_triage"
[ "$(v "$TMP/e1.tsv" A n_rest)" = "$((NU - NTRI))" ] || fail "n_rest"
[ "$(v "$TMP/e1.tsv" A t_triage)" = "$TTRI" ] || fail "t_triage $(v "$TMP/e1.tsv" A t_triage) != $TTRI"
[ "$(v "$TMP/e1.tsv" A t_rest)" = "$TREST" ] || fail "t_rest $(v "$TMP/e1.tsv" A t_rest) != $TREST"
[ "$(v "$TMP/e1.tsv" A n_unknown)" = 0 ] || fail "n_unknown"
[ "$(v "$TMP/e2.tsv" pooled n_triage)" = "$((2 * NTRI))" ] || fail "pooled n_triage"
[ "$(v "$TMP/e2.tsv" pooled t_rest)" = "$((2 * TREST))" ] || fail "pooled t_rest"
[ "$(v "$TMP/e2.tsv" pooled rr)" = "$(v "$TMP/e1.tsv" A rr)" ] || fail "pooled rr of two equal runs"
[ "$(v "$TMP/e2.tsv" pooled n_runs)" = 2 ] || fail "n_runs"

printf 'run\tcensus\tsecond\tmzml\nA\t%s\t%s\tother.mzML\n' "$C" "$TMP/sage.tsv" > "$TMP/runs3.tsv"
"$PY" "$EVAL" "$TMP/runs3.tsv" --boot 0 --out "$TMP/e3.tsv" 2>/dev/null; [ $? = 2 ] || fail "another mzML not refused"
printf 'run\tcensus\tsecond\nA\t%s\t%s\n' "$TMP/plain.census.tsv" "$TMP/sage.tsv" > "$TMP/runs4.tsv"
"$PY" "$EVAL" "$TMP/runs4.tsv" --boot 0 --out "$TMP/e4.tsv" 2>/dev/null; [ $? = 2 ] || fail "census without -census_ids not refused"
echo "PASS census_triage_eval_cli_test (U=$NU triage=$NTRI hits $TTRI/$TREST)"
