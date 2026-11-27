#!/usr/bin/env bash
# -label_format (1.17 silac2) against the real binary on the vendored fixture:
# format 1 is the default byte for byte; format 2 leaves the tag TSV, the
# digest report and every 1.16 -label_out row unchanged (a byte prefix) and
# appends the route and silac2 sections; the route counts agree with a
# recount of the full-precision tag TSV; a Da run is no_call low_resolution;
# the option is ignored with a warning without -label_out and refuses other
# values.
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

TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-label-format-test.XXXXXX") || exit 1
command -v cygpath >/dev/null 2>&1 && TMP=$(cygpath -m "$TMP")
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
same() {
  tr -d '\r' < "$1" > "$1.lf" && tr -d '\r' < "$2" > "$2.lf" || fail "cannot read $1 or $2"
  cmp -s "$1.lf" "$2.lf" && return
  diff "$1.lf" "$2.lf" | head -8 | sed -n l >&2
  fail "$3"
}
run() { "$BIN" -threads 2 "$@" > "$TMP/log" 2>&1 || { cat "$TMP/log" >&2; fail "FASTag $*"; }; }
val() { tr -d '\r' < "$1" | awk -F'\t' -v s="$2" -v k="$3" '$1 == s && $2 == k { print $3; exit }'; }

# The fixture's MS2 is ion trap: Da is where its tags pass E <= 1.
COMMON=(-in "$IN" -tag_length 4 -fragment_tolerance 0.5 -fragment_tolerance_unit Da -complement_tolerance_unit Da -tolerance_by_analyzer off)

# ---- format 1 is the default, byte for byte
run "${COMMON[@]}" -out "$TMP/t0.tsv" -digest_out "$TMP/d0.tsv" -label_out "$TMP/l0.tsv"
run "${COMMON[@]}" -out "$TMP/t1.tsv" -digest_out "$TMP/d1.tsv" -label_out "$TMP/l1.tsv" -label_format 1
cmp -s "$TMP/l0.tsv" "$TMP/l1.tsv" || fail "-label_format 1 is not the default -label_out"
cmp -s "$TMP/t0.tsv" "$TMP/t1.tsv" || fail "-label_format 1 changed the tag TSV"
cmp -s "$TMP/d0.tsv" "$TMP/d1.tsv" || fail "-label_format 1 changed -digest_out"
tr -d '\r' < "$TMP/l1.tsv" | cut -f1 | grep -qx -e route -e silac2 && fail "format 1 has format-2 rows"

# ---- format 2: the 1.16 rows a byte prefix, the other outputs unchanged
FASTAG_FULL_PRECISION=1 run "${COMMON[@]}" -out "$TMP/full0.tsv" -label_out "$TMP/lf0.tsv"
FASTAG_FULL_PRECISION=1 run "${COMMON[@]}" -out "$TMP/full.tsv" -digest_out "$TMP/d2.tsv" -label_out "$TMP/l2.tsv" -label_format 2
cmp -s "$TMP/full0.tsv" "$TMP/full.tsv" || fail "-label_format 2 changed the tag TSV"
run "${COMMON[@]}" -out "$TMP/t2.tsv" -digest_out "$TMP/d2.tsv" -label_out "$TMP/l2.tsv" -label_format 2
cmp -s "$TMP/t0.tsv" "$TMP/t2.tsv" || fail "-label_format 2 changed the tag TSV"
cmp -s "$TMP/d0.tsv" "$TMP/d2.tsv" || fail "-label_format 2 changed -digest_out"
n0=$(wc -l < "$TMP/l0.tsv" | tr -d ' ')
head -n "$n0" "$TMP/l2.tsv" > "$TMP/l2.head"
cmp -s "$TMP/l0.tsv" "$TMP/l2.head" || fail "-label_format 2: the 1.16 rows are not a byte prefix"
tail -n +"$((n0 + 1))" "$TMP/l2.tsv" | tr -d '\r' > "$TMP/l2.new"
[ "$(wc -l < "$TMP/l2.new" | tr -d ' ')" = 72 ] || fail "-label_format 2 appended $(wc -l < "$TMP/l2.new") rows, not 72"
awk -F'\t' 'NF != 5 || $5 == "" { bad = 1 } END { exit bad }' "$TMP/l2.new" || fail "format 2: a row without five fields"
[ "$(head -1 "$TMP/l2.new" | cut -f1-3)" = "$(printf 'route\tformat\t2')" ] || fail "format 2: the first new row is not route format 2"
[ "$(cut -f1 "$TMP/l2.new" | uniq | tr '\n' ' ')" = "route silac2 " ] || fail "format 2: sections are not route then silac2"
[ "$(awk -F'\t' '$1 == "silac2" && $2 !~ /\./ { printf "%s ", $2 }' "$TMP/l2.new")" = "status silac reason " ] \
  || fail "format 2: silac2 does not end with status, silac, reason"
for L in Lys4 Arg6 Lys8 Arg10; do
  for k in route count share ci_low ci_high call reason; do
    [ -n "$(val "$TMP/l2.tsv" silac2 "$L.$k")" ] || fail "format 2: no silac2 $L.$k"
  done
done
[ "$(val "$TMP/l2.tsv" route R+10.alias) $(val "$TMP/l2.tsv" route W.alias) $(val "$TMP/l2.tsv" route K+8.alias)" = "AL GF -" ] \
  || fail "format 2: the alias rows"
[ "$(val "$TMP/l2.tsv" silac2 Arg10.route) $(val "$TMP/l2.tsv" silac2 Lys8.route)" = "y y+b" ] || fail "format 2: the label routes"
# a Da run: no call, every label low_resolution
[ "$(val "$TMP/l2.tsv" silac2 status) $(val "$TMP/l2.tsv" silac2 reason)" = "no_call low_resolution" ] \
  || fail "format 2: a Da run is not no_call low_resolution"
[ "$(val "$TMP/l2.tsv" silac2 Lys8.reason)" = low_resolution ] || fail "format 2: Lys8 on a Da run is not low_resolution"

# ---- the route counts are a recount of the full-precision tag TSV
recount=$(tr -d '\r' < "$TMP/full.tsv" | awk -F'\t' -v w=0.008 '
  BEGIN {
    K = 128.09496; R = 156.10111; h = 18.010565
    nk = split("K K+4 K+8 R R+6 R+10 W", name, " ")
    m[1] = K; m[2] = K + 4.025107; m[3] = K + 8.014199; m[4] = R; m[5] = R + 6.020129; m[6] = R + 10.008269; m[7] = 186.07931
    al[6] = (71.03711 + 113.08406) - h; al[7] = (57.02146 + 147.06841) - h   # A+L, G+F less H2O
  }
  function near(v, x) { return v >= x - w && v <= x + w }
  NR > 1 && $8 == "0" && $9 + 0 <= 1 {
    for (i = 1; i <= nk; i++) {
      if (near($6, m[i])) { y[i]++; if ((i in al) && near($6, al[i])) ya[i]++ }
      if (near($5, m[i] + h)) { b[i]++; if ((i in al) && near($5 - h, al[i])) ba[i]++ }
    }
  }
  END { for (i = 1; i <= nk; i++) printf "%s %d %d %d %d\n", name[i], y[i], b[i], ya[i], ba[i] }')
report=$(for k in K K+4 K+8 R R+6 R+10 W; do
  echo "$k $(val "$TMP/l2.tsv" route "$k.y") $(val "$TMP/l2.tsv" route "$k.b") $(val "$TMP/l2.tsv" route "$k.y_alias") $(val "$TMP/l2.tsv" route "$k.b_alias")"
done)
[ "$recount" = "$report" ] || { echo "recount:"; echo "$recount"; echo "report:"; echo "$report"; fail "route counts differ from the recount"; } >&2
# the 1.16 pooled count is the two routes added (res = c_near + n_h2o)
[ "$(val "$TMP/l2.tsv" heavy R.tags)" = "$(( $(val "$TMP/l2.tsv" route R.y) + $(val "$TMP/l2.tsv" route R.b) + $(val "$TMP/l2.tsv" route R+10.y) + $(val "$TMP/l2.tsv" route R+10.b) ))" ] \
  || fail "heavy R.tags is not R and R+10 on both routes"

# ---- a ppm run: no filtered tag reaches y1, so no_call no_y1_ends
run -in "$IN" -tag_length 4 -tolerance_by_analyzer off -out "$TMP/p.tsv" -label_out "$TMP/p2.tsv" -label_format 2
[ "$(val "$TMP/p2.tsv" route y.gate) $(val "$TMP/p2.tsv" silac2 status) $(val "$TMP/p2.tsv" silac2 reason)" = "no no_call no_y1_ends" ] \
  || fail "format 2 at 20 ppm: not no_call no_y1_ends"

# ---- ignored without -label_out, refused for another value
run "${COMMON[@]}" -out "$TMP/w.tsv" -label_format 2
grep -q -- "-label_format is only read for -label_out" "$TMP/log" || fail "no warning for -label_format without -label_out"
cmp -s "$TMP/t0.tsv" "$TMP/w.tsv" || fail "-label_format without -label_out changed the tag TSV"
if "$BIN" "${COMMON[@]}" -out "$TMP/x.tsv" -label_out "$TMP/x.label.tsv" -label_format 3 > "$TMP/log" 2>&1; then
  fail "-label_format 3 was accepted"
fi

echo "label_format_cli_test: all checks passed"
