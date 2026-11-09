#!/usr/bin/env bash
# 1.13 digqual (backlog 23): -digest_quality against the real binary on the
# vendored fixture. Without the option -digest_out is unchanged; with it the
# 1.12 report is a byte prefix, the tag TSV is unchanged, the quality rows
# agree with a recount of the full-precision tag TSV, auto on a run without a
# call is not measured, and an unknown enzyme is refused.
# Exits 77 (ctest SKIP) when the binary cannot start.
set -u
BIN="$1"
IN="$2"
DATA="$3"   # data/digest

if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi
export FASTAG_DIGEST_DIR="$DATA"
unset FASTAG_FULL_PRECISION

TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-digqual-test.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
run() { "$BIN" -threads 2 "$@" > "$TMP/log" 2>&1 || { cat "$TMP/log" >&2; fail "FASTag $*"; }; }
val() { tr -d '\r' < "$1" | awk -F'\t' -v s="$2" -v k="$3" '$1 == s && $2 == k { print $3; exit }'; }

COMMON=(-in "$IN" -tag_length 4 -fragment_tolerance 0.5 -fragment_tolerance_unit Da)

# ---- off: unchanged; on: 1.12 rows a byte prefix, tag TSV unchanged. The
# fixture has 26 C-terminal tag ends, so -digest_tag_min 10 lets the C end be
# measured (the default 100 gives few_tags, checked below).
run "${COMMON[@]}" -out "$TMP/t0.tsv" -digest_out "$TMP/d0.tsv" -digest_tag_min 10
run "${COMMON[@]}" -out "$TMP/t1.tsv" -digest_out "$TMP/d1.tsv" -digest_quality Trypsin -digest_tag_min 10
cmp -s "$TMP/t0.tsv" "$TMP/t1.tsv" || fail "-digest_quality changed the tag TSV"
n0=$(wc -c < "$TMP/d0.tsv")
head -c "$n0" "$TMP/d1.tsv" | cmp -s - "$TMP/d0.tsv" || fail "the 1.12 rows are not a byte prefix of the report"
tail -c +"$((n0 + 1))" "$TMP/d1.tsv" | tr -d '\r' > "$TMP/q.rows"
[ -s "$TMP/q.rows" ] || fail "no quality rows"
awk -F'\t' '$1 != "quality" || NF != 5 || $5 == "" { bad = 1 } END { exit bad }' "$TMP/q.rows" \
  || fail "a row after the 1.12 rows is not a five-field quality row"
for k in enzyme basis status C.sites C.ends C.measured C.nonspecific_share C.nonspecific_mle C.mc_positions \
         C.mc_sites C.mc_site_share C.mc_background_share C.mc_retention; do
  grep -q "^quality	$k	" "$TMP/q.rows" || fail "no quality $k row"
done
[ "$(val "$TMP/d1.tsv" quality enzyme) $(val "$TMP/d1.tsv" quality basis) $(val "$TMP/d1.tsv" quality status)" = \
  "Trypsin named measured" ] || fail "enzyme/basis/status"
[ "$(val "$TMP/d1.tsv" quality C.sites)" = "K,R" ] || fail "Trypsin sites are not K,R"
[ "$(val "$TMP/d1.tsv" quality C.ends)" = "$(val "$TMP/d1.tsv" count n_c)" ] || fail "C.ends is not count.n_c"

# ---- recount from the full-precision tag TSV: ends at K (labelled K merged) and
# R, and their P2..P4 residues (y read: last three; reversed b read: first three)
FASTAG_FULL_PRECISION=1 run "${COMMON[@]}" -out "$TMP/full.tsv"
recount=$(tr -d '\r' < "$TMP/full.tsv" | awk -F'\t' -v w=0.008 '
  function near(v, m) { return v >= m - w && v <= m + w }
  function sites(s, from_end,   i, c, n) {
    for (i = 0; i < 3 && i < length(s); i++) {
      c = from_end ? substr(s, length(s) - i, 1) : substr(s, i + 1, 1)
      if (index("GASPVTCLNDQKEMHFRYW", c) > 0) { pos++; if (c == "K" || c == "R") site++ }
    }
  }
  NR > 1 && $8 == "0" && $9 + 0 <= 1 {
    seq = $2; gsub(/\[[^]]*\]|\([^)]*\)/, "", seq); gsub(/I/, "L", seq)
    K = 128.09496; R = 156.10111; H = 18.010565
    split(K " " K + 229.162932 " " K + 304.207146 " " K + 144.102063 " " K + 8.014199 " " R, m, " ")
    for (j = 1; j <= 6; j++) {
      if (near($6, m[j])) { spec++; sites(seq, 1) }
      if (near($5, m[j] + H)) { spec++; sites(seq, 0) }
    }
  } END { print spec + 0, pos + 0, site + 0 }')
want="$(tr -d '\r' < "$TMP/d1.tsv" | awk -F'\t' '$1 == "quality" && $2 == "C.ends" { print $5 }' | grep -oE ', [0-9]+ of them' | grep -oE '[0-9]+') $(val "$TMP/d1.tsv" quality C.mc_positions) $(val "$TMP/d1.tsv" quality C.mc_sites)"
[ "$recount" = "$want" ] || fail "recount (specific ends, positions, sites) $recount differs from the report ($want)"
[ "$(echo "$recount" | awk '{ print ($2 > 0) }')" = 1 ] || fail "the fixture gives no P2..P4 residue"
# retention = (sites / non-sites) / (b / (1 - b)), to 9 significant digits
awk -v o="$(val "$TMP/d1.tsv" quality C.mc_sites)" -v n="$(val "$TMP/d1.tsv" quality C.mc_positions)" \
    -v b="$(val "$TMP/d1.tsv" quality C.mc_background_share)" -v r="$(val "$TMP/d1.tsv" quality C.mc_retention)" \
    'BEGIN { e = (o / (n - o)) / (b / (1 - b)); d = e - r; if (d < 0) d = -d; exit !(d <= 1e-9 * (e > 0 ? e : 1)) }' \
  || fail "C.mc_retention is not the odds ratio of its rows"
awk -v s="$(val "$TMP/d1.tsv" quality C.nonspecific_share)" -v m="$(val "$TMP/d1.tsv" quality C.nonspecific_mle)" \
    'BEGIN { exit !(s >= 0 && s <= 1 && m >= 0 && m <= 1) }' || fail "non-specific share or MLE outside [0, 1]"

# ---- a synthetic table whose model cleaves after 12 residues: many sites, so the
# recount checks which tag residues are P2..P4 (last three of a y read, first
# three of a reversed b read) and the site set from the model
{
  printf 'model\tclass\tend\tresidue\tfreq\n'
  for e in C N; do for a in G A S P V T C L N D Q K E M H F R Y W; do printf 'background\t-\t%s\t%s\t1\n' $e $a; done; done
  for a in G A S P V T L N D Q K E; do printf 'Wide\tWide\tC\t%s\t1\n' $a; done
  printf 'Wide\tWide\tN\t*\t-\n'
  printf 'unspecific\tunspecific cleavage\tC\t*\t-\nunspecific\tunspecific cleavage\tN\t*\t-\n'
} > "$TMP/wide.tsv"
run "${COMMON[@]}" -out "$TMP/t7.tsv" -digest_out "$TMP/d7.tsv" -digest_models "$TMP/wide.tsv" -digest_quality Wide -digest_tag_min 10
[ "$(val "$TMP/d7.tsv" quality C.sites)" = "G,A,S,P,V,T,L,N,D,Q,K,E" ] || fail "Wide: sites are not the 12 model residues"
recount7=$(tr -d '\r' < "$TMP/full.tsv" | awk -F'\t' -v w=0.008 -v S="GASPVTLNDQKE" '
  function near(v, m) { return v >= m - w && v <= m + w }
  function sites(s, from_end,   i, c) {
    for (i = 0; i < 3 && i < length(s); i++) {
      c = from_end ? substr(s, length(s) - i, 1) : substr(s, i + 1, 1)
      if (index("GASPVTCLNDQKEMHFRYW", c) > 0) { pos++; if (index(S, c) > 0) site++ }
    }
  }
  BEGIN {
    n = split("G 57.02146 A 71.03711 S 87.03203 P 97.05276 V 99.06841 T 101.04768 L 113.08406 N 114.04293 D 115.02694 Q 128.05858 E 129.04259", t, " ")
    for (i = 1; i < n; i += 2) mass[t[i]] = t[i + 1]
    K = 128.09496
    mass["K"] = K; mass["K1"] = K + 229.162932; mass["K2"] = K + 304.207146; mass["K3"] = K + 144.102063; mass["K4"] = K + 8.014199
  }
  NR > 1 && $8 == "0" && $9 + 0 <= 1 {
    seq = $2; gsub(/\[[^]]*\]|\([^)]*\)/, "", seq); gsub(/I/, "L", seq)
    for (r in mass) {
      if (near($6, mass[r])) { spec++; sites(seq, 1) }
      if (near($5, mass[r] + 18.010565)) { spec++; sites(seq, 0) }
    }
  } END { print spec + 0, pos + 0, site + 0 }')
want7="$(tr -d '\r' < "$TMP/d7.tsv" | awk -F'\t' '$1 == "quality" && $2 == "C.ends" { print $5 }' | grep -oE ', [0-9]+ of them' | grep -oE '[0-9]+') $(val "$TMP/d7.tsv" quality C.mc_positions) $(val "$TMP/d7.tsv" quality C.mc_sites)"
[ "$recount7" = "$want7" ] || fail "Wide: recount (specific ends, positions, sites) $recount7 differs from the report ($want7)"
[ "$(echo "$recount7" | awk '{ print ($3 >= 10) }')" = 1 ] || fail "Wide: fewer than 10 sites, the check would be weak"

# ---- default -digest_tag_min 100: too few ends
run "${COMMON[@]}" -out "$TMP/t6.tsv" -digest_out "$TMP/d6.tsv" -digest_quality Trypsin
[ "$(val "$TMP/d6.tsv" quality status) $(val "$TMP/d6.tsv" quality reason) $(val "$TMP/d6.tsv" quality C.measured)" = \
  "not_measured few_tags no" ] || fail "26 ends against tag_min 100 are not few_tags"
[ "$(val "$TMP/d6.tsv" quality C.mc_retention)" = "" ] || fail "few_tags wrote a retention"

# ---- auto on a Da run (no call): not measured
run "${COMMON[@]}" -out "$TMP/t2.tsv" -digest_out "$TMP/d2.tsv" -digest_quality auto
[ "$(val "$TMP/d2.tsv" quality basis) $(val "$TMP/d2.tsv" quality status) $(val "$TMP/d2.tsv" quality reason)" = \
  "call not_measured no_call" ] || fail "auto without a call is not 'call not_measured no_call'"
[ "$(val "$TMP/d2.tsv" quality C.ends)" = "" ] || fail "auto without a call wrote end rows"

# ---- a named N-end enzyme of the shipped table measures the N end
run "${COMMON[@]}" -out "$TMP/t3.tsv" -digest_out "$TMP/d3.tsv" -digest_quality Asp-N
[ "$(val "$TMP/d3.tsv" quality N.sites)" = D ] || fail "Asp-N: N.sites is not D"
[ "$(val "$TMP/d3.tsv" quality C.sites)" = "" ] || fail "Asp-N: a C end was written"
run "${COMMON[@]}" -out "$TMP/t4.tsv" -digest_out "$TMP/d4.tsv" -digest_quality unspecific
[ "$(val "$TMP/d4.tsv" quality reason)" = no_specific_end ] || fail "unspecific: reason is not no_specific_end"

# ---- refusals and warnings
"$BIN" "${COMMON[@]}" -out "$TMP/x.tsv" -digest_out "$TMP/x.dig.tsv" -digest_quality Papain > "$TMP/log" 2>&1
rc=$?
[ "$rc" = 6 ] || fail "an unknown -digest_quality enzyme: exit $rc, not 6 (ILLEGAL_PARAMETERS)"
grep -q "is not a model of the protease table" "$TMP/log" || fail "no message for an unknown enzyme"
[ ! -e "$TMP/x.dig.tsv" ] && [ ! -e "$TMP/x.tsv" ] || fail "outputs written although the run was refused"
run "${COMMON[@]}" -out "$TMP/t5.tsv" -digest_quality Trypsin
grep -q -- "-digest_quality is only read for -digest_out" "$TMP/log" || fail "no warning for -digest_quality without -digest_out"
cmp -s "$TMP/t0.tsv" "$TMP/t5.tsv" || fail "-digest_quality without -digest_out changed the tag TSV"

echo "digest_quality_cli_test: all checks passed"
