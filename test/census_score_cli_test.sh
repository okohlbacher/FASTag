#!/usr/bin/env bash
# -census_score, -census_sorted_out and -census_ids_exact (FASTag 1.16 item 4) against the real binary.
#   (a) the tag TSV and the 1.12 census columns are unchanged by -census_score; it adds pre_best_evalue,
#       pre_best_len, pre_best_mean_conf, pre_tag_cover and ident_score; every row (every status) has a score
#   (b) the score's features are taken before database filters: with -fasta (some spectra become `filtered`)
#       the pre_* columns and ident_score are identical to the run without -fasta
#   (c) -census_sorted_out holds the census rows ordered by ident_score (non-increasing, ties in input order),
#       ranks 1..n
#   (d) with -census_ids, ident_score precedes identified and triage (still the last two columns)
#   (e) the Python model (tools/census_ident.py check with tools/census_ident_model.json) reproduces
#       ident_score, and that JSON is the model frozen in src/CensusScore.cpp
#   (f) -census_score without -census and -census_sorted_out without -census_score are ignored with a warning
#   (g) -census_ids_exact: a clean file gives the same identified column as the default join and adds the
#       exact summary rows; a wrong-run file is refused before any output; scan-only references, foreign
#       references (below the default 50% refusal) and hits without target/decoy annotation are refused
set -u
BIN="$1"
HELPER="$2"   # census_ids_test (fixture writer)
IN="$3"       # Ecoli_MS2_small.mzML
DB="$4"       # Ecoli_MS2_small.fasta
SRC="$5"      # source root (tools/, data/, src/)

if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-census-score.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
ARGS=(-fragment_tolerance 0.3 -fragment_tolerance_unit Da -threads 2)
run() { local log="$1"; shift; "$BIN" "$@" >"$log" 2>&1 || { cat "$log" >&2; fail "run failed: $*"; }; }
col() { head -1 "$1" | tr '\t' '\n' | grep -nx -- "$2" | head -1 | cut -d: -f1; }
val() { awk -F'\t' -v s="$2" -v k="$3" '$1 == s && $2 == k { print $3; f = 1 } END { if (!f) print "MISSING" }' "$1"; }

# ---- (a) ---------------------------------------------------------------------------------------------------
mkdir -p "$TMP/plain" "$TMP/s"
run "$TMP/plain/log" -in "$IN" -out "$TMP/plain/tags.tsv" -census ${ARGS[@]+"${ARGS[@]}"}
run "$TMP/s/log" -in "$IN" -out "$TMP/s/tags.tsv" -census -census_score -census_sorted_out "$TMP/s/sorted.tsv" \
  ${ARGS[@]+"${ARGS[@]}"}
P="$TMP/plain/tags.census.tsv"; C="$TMP/s/tags.census.tsv"
NC=$(head -1 "$P" | tr '\t' '\n' | wc -l | tr -d ' ')
cmp -s "$TMP/plain/tags.tsv" "$TMP/s/tags.tsv" || fail "(a) the tag TSV differs with -census_score"
cmp -s "$P" <(cut -f1-"$NC" "$C") || fail "(a) the census columns differ with -census_score"
[ "$(head -1 "$C" | cut -f$((NC + 1))-)" = "$(printf 'pre_best_evalue\tpre_best_len\tpre_best_mean_conf\tpre_tag_cover\tident_score')" ] \
  || fail "(a) score columns: $(head -1 "$C" | cut -f$((NC + 1))-)"
NS=$((NC + 5))
awk -F'\t' -v n=$NS 'NF != n || (NR > 1 && $n !~ /^[01]\.[0-9][0-9][0-9][0-9][0-9][0-9]$/) { print "row " NR ": " $n; bad = 1 } END { exit bad }' "$C" \
  || fail "(a) a row lacks a score or has not $NS fields"
ST=$(col "$C" status)
# every status: census_edge.mzML (the census_cli_test fixture) has a spectrum of each
EDGE="$(dirname "$IN")/census_edge.mzML"
mkdir -p "$TMP/e"
run "$TMP/e/log" -in "$EDGE" -out "$TMP/e/tags.tsv" -census -census_score ${ARGS[@]+"${ARGS[@]}"}
E="$TMP/e/tags.census.tsv"
[ "$(tail -n +2 "$E" | cut -f"$ST" | sort -u | wc -l | tr -d ' ')" -ge 6 ] || fail "(a) census_edge has too few statuses"
awk -F'\t' -v n=$NS 'NF != n || (NR > 1 && $n !~ /^[01]\.[0-9][0-9][0-9][0-9][0-9][0-9]$/) { bad = 1 } END { exit bad }' "$E" \
  || fail "(a) census_edge: a status without a score"
[ "$(val "$TMP/s/tags.census_summary.tsv" census_score ident_rows)" = "$(tail -n +2 "$C" | wc -l | tr -d ' ')" ] \
  || fail "(a) summary ident_rows"
# a spectrum without a pre-filter tag has empty pre_* fields; one with a tag has all four
awk -F'\t' -v a=$((NC + 1)) 'NR > 1 { e = ($a == ""); for (i = a; i < a + 4; i++) if (($i == "") != e) bad = 1 } END { exit bad }' "$C" \
  || fail "(a) pre_* fields are set together"

# ---- (b) ---------------------------------------------------------------------------------------------------
# (-tag_length 4: the fixture database needs 4-residue tags for -fasta)
mkdir -p "$TMP/f" "$TMP/nf"
run "$TMP/nf/log" -in "$IN" -out "$TMP/nf/tags.tsv" -tag_length 4 -census -census_score ${ARGS[@]+"${ARGS[@]}"}
run "$TMP/f/log" -in "$IN" -out "$TMP/f/tags.tsv" -tag_length 4 -fasta "$DB" -census -census_score ${ARGS[@]+"${ARGS[@]}"}
NF4="$TMP/nf/tags.census.tsv"; F="$TMP/f/tags.census.tsv"
[ "$(awk -F'\t' -v s=$ST '$s == "filtered"' "$F" | wc -l | tr -d ' ')" -gt 0 ] || fail "(b) -fasta filtered no spectrum"
cmp -s <(cut -f$((NC + 1))-"$NS" "$NF4") <(cut -f$((NC + 1))-"$NS" "$F") \
  || fail "(b) pre_* or ident_score change with -fasta"
cmp -s <(cut -f1-"$NC" "$NF4") <(cut -f1-"$NC" "$F") && fail "(b) -fasta changed no census column (test not sensitive)"

# ---- (c) ---------------------------------------------------------------------------------------------------
S="$TMP/s/sorted.tsv"
[ "$(head -1 "$S")" = "$(printf 'ident_rank\t%s' "$(head -1 "$C")")" ] || fail "(c) sorted header"
cmp -s <(tail -n +2 "$C" | sort) <(tail -n +2 "$S" | cut -f2- | sort) || fail "(c) sorted rows are not the census rows"
awk -F'\t' -v n=$((NS + 1)) 'NR > 1 { if ($1 != NR - 1) bad = 1; if (NR > 2 && ($n > p || ($n == p && $2 + 0 < pi + 0))) bad = 1; p = $n; pi = $2 }
     END { exit bad }' "$S" || fail "(c) order: non-increasing score, ties by input index, ranks 1..n"

# ---- (d) ---------------------------------------------------------------------------------------------------
for v in good wrongrun scan fewforeign notd; do
  "$HELPER" --write-ids "$IN" "$TMP/$v.idXML" "$v" "$TMP/$v.want" || fail "helper $v"
done
mkdir -p "$TMP/i" "$TMP/ix"
run "$TMP/i/log" -in "$IN" -out "$TMP/i/tags.tsv" -census -census_score -census_ids "$TMP/good.idXML" ${ARGS[@]+"${ARGS[@]}"}
I="$TMP/i/tags.census.tsv"
[ "$(col "$I" ident_score)" = "$NS" ] && [ "$(col "$I" identified)" = $((NS + 1)) ] && [ "$(col "$I" triage)" = $((NS + 2)) ] \
  || fail "(d) column order: $(head -1 "$I" | cut -f$NS-)"
cmp -s "$C" <(cut -f1-"$NS" "$I") || fail "(d) the scored columns differ with -census_ids"

# ---- (e) ---------------------------------------------------------------------------------------------------
if command -v python3 >/dev/null 2>&1; then
  python3 -I "$SRC/tools/census_ident.py" check --census "$C" --model "$SRC/tools/census_ident_model.json" > "$TMP/check.json" \
    || fail "(e) the Python model does not reproduce ident_score: $(cat "$TMP/check.json")"
  python3 -I - "$SRC/tools/census_ident_model.json" "$SRC/src/CensusScore.cpp" <<'EOF' || fail "(e) model JSON and C++ block differ"
import json, re, sys
m = json.load(open(sys.argv[1]))
s = open(sys.argv[2]).read()
b = re.search(r'static const Model m\{"([^"]*)", ([-0-9.e]+),\s*\{([^}]*)\}\};', s)
assert b, "no frozen block"
coef = [float(x) for x in b.group(3).split(",")]
assert b.group(1) == m["id"], (b.group(1), m["id"])
assert float(b.group(2)) == m["intercept"] and coef == m["coef"], "coefficients"
EOF
else
  echo "note: python3 not found, (e) skipped" >&2
fi

# ---- (f) ---------------------------------------------------------------------------------------------------
mkdir -p "$TMP/o"
run "$TMP/o/log" -in "$IN" -out "$TMP/o/tags.tsv" -census_score ${ARGS[@]+"${ARGS[@]}"}
grep -q -- "-census_score is only read for -census" "$TMP/o/log" || fail "(f) no warning for -census_score alone"
run "$TMP/o/log2" -in "$IN" -out "$TMP/o/t2.tsv" -census -census_sorted_out "$TMP/o/x.tsv" ${ARGS[@]+"${ARGS[@]}"}
grep -q -- "-census_sorted_out is only read for -census_score" "$TMP/o/log2" || fail "(f) no warning for -census_sorted_out alone"
[ ! -e "$TMP/o/x.tsv" ] || fail "(f) -census_sorted_out without -census_score wrote a file"

# ---- (g) ---------------------------------------------------------------------------------------------------
run "$TMP/ix/log" -in "$IN" -out "$TMP/ix/tags.tsv" -census -census_score -census_ids "$TMP/good.idXML" -census_ids_exact \
  ${ARGS[@]+"${ARGS[@]}"}
cmp -s "$I" "$TMP/ix/tags.census.tsv" || fail "(g) exact join of a clean file differs from the default join"
XS="$TMP/ix/tags.census_summary.tsv"
[ "$(val "$XS" census_ids ids_exact)" = 1 ] || fail "(g) ids_exact"
N0=$(val "$XS" census_ids identified_0)
[ $(( $(val "$XS" census_ids unidentified_with_psm) + $(val "$XS" census_ids unidentified_no_psm) )) = "$N0" ] \
  || fail "(g) unidentified split does not add up to identified_0 ($N0)"
[ "$(val "$TMP/i/tags.census_summary.tsv" census_ids ids_exact)" = MISSING ] || fail "(g) ids_exact without the flag"
# no reference names a sixth of the spectra (fixture pattern k % 6 == 4)
[ "$(val "$XS" census_ids unidentified_no_psm)" -gt 0 ] || fail "(g) the fixture has no spectrum without a reference"
refused() {  # name variant pattern before_output
  local d="$TMP/$1"; mkdir -p "$d"
  "$BIN" -in "$IN" -out "$d/tags.tsv" -census -census_ids "$TMP/$2.idXML" -census_ids_exact ${ARGS[@]+"${ARGS[@]}"} > "$d/log" 2>&1 \
    && fail "(g) $2 was not refused"
  grep -q -- "$3" "$d/log" || { cat "$d/log" >&2; fail "(g) $2: no message '$3'"; }
  [ ! -e "$d/tags.census.tsv" ] || fail "(g) $2: a census was written"
  if [ "$4" = before ]; then [ ! -e "$d/tags.tsv" ] || fail "(g) $2: output written before the refusal"
  else cmp -s "$TMP/plain/tags.tsv" "$d/tags.tsv" || fail "(g) $2: the other outputs are not complete"; fi
}
refused wr wrongrun "names the run 'other_run'" before
refused nt notd "no target/decoy annotation" before
refused sc scan "name no MS2 spectrum of -in" after
refused ff fewforeign "name no MS2 spectrum of -in" after
# the default join only warns for few foreign references
mkdir -p "$TMP/ffl"
run "$TMP/ffl/log" -in "$IN" -out "$TMP/ffl/tags.tsv" -census -census_ids "$TMP/fewforeign.idXML" ${ARGS[@]+"${ARGS[@]}"}
[ -e "$TMP/ffl/tags.census.tsv" ] || fail "(g) the default join refused few foreign references"
"$BIN" -in "$IN" -out "$TMP/sub.tsv" -census -census_ids "$TMP/good.idXML" -census_ids_exact -subsample_fraction 0.5 \
  ${ARGS[@]+"${ARGS[@]}"} > "$TMP/sub.log" 2>&1 && fail "(g) exact join under subsampling was not refused"
grep -q "cannot be combined with subsampling" "$TMP/sub.log" || fail "(g) subsampling message"

echo "census_score_cli_test: all checks passed"
