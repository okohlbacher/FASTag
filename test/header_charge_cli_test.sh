#!/usr/bin/env bash
# 1.13 (backlog #14) -check_header_charge against the real binary, on the
# vendored MGF (139 spectra: 97 2+, 33 3+, 9 4+) and on a copy whose 3+ and 4+
# precursors are all given as 2+ (42 wrong header charges):
#   - off spelled out and warn leave every output byte-identical to the
#     options absent (tags, recon, delta, digest, label, massgap, census and
#     its summary); off writes no check row and no summary line;
#   - warn writes one -check_header_out row per header-charged spectrum, the
#     summary line, and the check rows of the census summary; on the wrong
#     copy it calls a disagreement on at least half of the 42 wrong headers
#     and on few of the 97 right ones, and every disagreement on a wrong
#     header calls a charge above 2;
#   - override on the wrong copy tags exactly the disagreeing spectra at the
#     call (charge_src overridden, prec_charge = the call = tagged_charge),
#     every other spectrum's rows equal warn's, and it recovers more correct
#     charges than the header gave; on the right copy it changes fewer
#     spectra than warn calls wrong headers on the wrong copy;
#   - a larger -check_header_margin never calls more disagreements;
#   - warn and override write the same bytes at 1, 3 and 8 threads;
#   - refusals: an unknown mode, -stream, -dump_spectrum with override; the
#     ignored-option warning for -check_header_out without the check.
# Exits 77 (ctest SKIP) when the binary cannot start.
set -u
BIN="$1"
MGF="$2"      # test/fixtures/Ecoli_MS2_small.mgf
DB="$3"       # test/fixtures/Ecoli_MS2_small.fasta
DATA="$4"     # data/digest

if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi
export FASTAG_DIGEST_DIR="$DATA"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-hdrcharge-cli.XXXXXX") || exit 1
[ "${FASTAG_TEST_KEEP:-0}" = 1 ] && echo "work directory kept: $TMP" || trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
cp "$DB" "$TMP/db.fasta" || exit 1
cd "$TMP" || exit 1
DB=db.fasta

tr -d '\r' < "$MGF" > "$TMP/right.mgf"
tr -d '\r' < "$MGF" | sed -n 's/^CHARGE=\([0-9]*\)+$/\1/p' > "$TMP/truth.txt"
sed -E 's/^CHARGE=[34]\+$/CHARGE=2+/' "$TMP/right.mgf" > "$TMP/wrong.mgf"
[ "$(wc -l < "$TMP/truth.txt" | tr -d ' ')" = 139 ] && [ "$(grep -c '^CHARGE=2+$' "$TMP/wrong.mgf")" = 139 ] \
  && [ "$(awk '$1 >= 3' "$TMP/truth.txt" | wc -l | tr -d ' ')" = 42 ] \
  || fail "the fixture is not the 139-spectrum MGF this test expects"

COMMON=(-tag_length 4 -extension 1 -fragment_tolerance 0.3 -fragment_tolerance_unit Da -complement_tolerance 0.3
        -fasta "$DB")
OUTS=(tsv recon.tsv delta.tsv digest.tsv label.tsv massgap.tsv census.tsv census_summary.tsv)
full() {  # dir input args...
  local d=$1 in=$2; shift 2; mkdir -p "$d"
  "$BIN" -in "$in" -out "$d/t.tsv" "${COMMON[@]}" -recon_out "$d/t.recon.tsv" -delta_out "$d/t.delta.tsv" \
    -digest_out "$d/t.digest.tsv" -label_out "$d/t.label.tsv" -massgap_out "$d/t.massgap.tsv" -census "$@" \
    > "$d/log" 2>&1 || { cat "$d/log" >&2; fail "run $d failed"; }
}

# ---- off and warn leave every output as it was ------------------------------
for in in right wrong; do
  full "$TMP/${in}_absent" "$TMP/$in.mgf" -threads 2
  full "$TMP/${in}_off" "$TMP/$in.mgf" -threads 2 -check_header_charge off -check_header_margin 2
  full "$TMP/${in}_warn" "$TMP/$in.mgf" -threads 2 -check_header_charge warn -check_header_out "$TMP/${in}_warn/hc.tsv"
  for x in "${OUTS[@]}"; do
    [ -s "$TMP/${in}_absent/t.$x" ] || fail "$in: no t.$x"
    cmp -s "$TMP/${in}_absent/t.$x" "$TMP/${in}_off/t.$x" || fail "$in: -check_header_charge off changed t.$x"
    if [ "$x" = census_summary.tsv ]; then
      # warn appends its run rows after the #6 rows; every other row is unchanged.
      grep -v -E '^run	(check_header_charge|header_charge_[a-z]*|charge_overridden)	' "$TMP/${in}_warn/t.$x" \
        | cmp -s "$TMP/${in}_absent/t.$x" - || fail "$in: warn changed a census summary row"
    else
      cmp -s "$TMP/${in}_absent/t.$x" "$TMP/${in}_warn/t.$x" || fail "$in: -check_header_charge warn changed t.$x"
    fi
  done
  grep -q 'Header charge check' "$TMP/${in}_off/log" && fail "$in: off wrote a header check summary"
  grep -q '^run	check_header_charge	' "$TMP/${in}_off/t.census_summary.tsv" && fail "$in: off wrote a check row"
  grep -q 'Header charge check (-check_header_charge warn): 139 of 139 MS2 spectra carry a precursor charge' \
    "$TMP/${in}_warn/log" || { cat "$TMP/${in}_warn/log" >&2; fail "$in: no warn summary line"; }
  grep -q '^run	check_header_charge	warn	' "$TMP/${in}_warn/t.census_summary.tsv" || fail "$in: no check row"
  for k in agree disagree ambiguous nocall overridden; do
    grep -q "^run	header_charge_$k	[0-9]*	139	" "$TMP/${in}_warn/t.census_summary.tsv" \
      || fail "$in: no header_charge_$k row of 139"
  done
  [ "$(wc -l < "$TMP/${in}_warn/hc.tsv" | tr -d ' ')" = 140 ] || fail "$in: -check_header_out does not have 139 rows"
  [ "$(head -1 "$TMP/${in}_warn/hc.tsv")" = "$(printf 'index\tnative_id\tprecursor_mz\theader_charge\tcall_charge\tcall_src\tbasis\trunner_up\theader_excess\tcall_excess\theader_ruled_out\tverdict\ttagged_charge')" ] \
    || fail "$in: -check_header_out header"
  # warn tags at the header: tagged_charge is the header charge everywhere.
  awk -F'\t' 'NR > 1 && $13 != $4 { bad++ } END { exit bad > 0 }' "$TMP/${in}_warn/hc.tsv" \
    || fail "$in: warn reports a tagged charge other than the header"
  # The summary counts equal the rows.
  for k in agree disagree ambiguous nocall; do
    n=$(awk -F'\t' -v k=$k 'NR > 1 && $12 == k' "$TMP/${in}_warn/hc.tsv" | wc -l | tr -d ' ')
    grep -q "^run	header_charge_$k	$n	" "$TMP/${in}_warn/t.census_summary.tsv" \
      || fail "$in: header_charge_$k row is not the $n rows of -check_header_out"
  done
done

# ---- warn on the wrong headers: recall and false calls -------------------------
H=$TMP/wrong_warn/hc.tsv
cut -f12,5 "$H" | tail -n +2 > "$TMP/wrong_calls.txt"   # call_charge \t verdict
paste "$TMP/truth.txt" "$TMP/wrong_calls.txt" > "$TMP/wrong_scored.txt"  # truth call verdict
caught=$(awk '$1 >= 3 && $3 == "disagree"' "$TMP/wrong_scored.txt" | wc -l | tr -d ' ')
false_w=$(awk '$1 == 2 && $3 == "disagree"' "$TMP/wrong_scored.txt" | wc -l | tr -d ' ')
bad_dir=$(awk '$1 >= 3 && $3 == "disagree" && $2 <= 2' "$TMP/wrong_scored.txt" | wc -l | tr -d ' ')
right_dis=$(awk -F'\t' 'NR > 1 && $12 == "disagree"' "$TMP/right_warn/hc.tsv" | wc -l | tr -d ' ')
echo "header_charge_cli_test: wrong headers caught $caught of 42; false disagreements $false_w of 97 (wrong copy), $right_dis of 139 (right copy)"
[ "$caught" -ge 21 ] || fail "warn caught only $caught of the 42 wrong header charges (need >= 21)"
[ "$false_w" -le 10 ] || fail "warn called $false_w of the 97 right 2+ headers wrong (allowed <= 10)"
[ "$right_dis" -le 14 ] || fail "warn called $right_dis of 139 right headers wrong (allowed <= 14)"
[ "$bad_dir" = 0 ] || fail "$bad_dir disagreements on a wrong 2+ header call 2 or lower"

# ---- override ----------------------------------------------------------------
full "$TMP/wrong_ovr" "$TMP/wrong.mgf" -threads 2 -check_header_charge override -check_header_out "$TMP/wrong_ovr/hc.tsv"
O=$TMP/wrong_ovr
[ "$(head -1 "$O/t.tsv" | cut -f13-)" = "$(printf 'prec_charge\tcharge_src\tiso_offset\tselected')" ] \
  || fail "override: the hypothesis columns are missing"
cut -f1-12 "$O/hc.tsv" | cmp -s - <(cut -f1-12 "$H") || fail "override: the check rows differ from warn's"
awk -F'\t' 'NR > 1 && $12 == "disagree" && $13 != $5 { bad++ } NR > 1 && $12 != "disagree" && $13 != $4 { bad++ }
            END { exit bad > 0 }' "$O/hc.tsv" || fail "override: tagged_charge is not the call (disagree) or the header"
# index -> tagged charge; every TSV row's prec_charge and charge_src follow it.
awk -F'\t' 'NR > 1 { print "index=" $1 "\t" $13 "\t" ($12 == "disagree" ? "overridden" : "header") }' "$O/hc.tsv" > "$TMP/ovr_map.tsv"
awk -F'\t' 'NR == FNR { z[$1] = $2; s[$1] = $3; next }
            FNR > 1 && ($13 != z[$1] || $14 != s[$1] || $16 != 1) { bad++ } END { exit bad > 0 }' \
  "$TMP/ovr_map.tsv" "$O/t.tsv" || fail "override: a row's prec_charge/charge_src is not its spectrum's verdict"
# Without -fasta every tagged row is written: the disagreeing spectra with
# rows are exactly those with overridden rows.
"$BIN" -in "$TMP/wrong.mgf" -out "$TMP/nf.tsv" -tag_length 4 -extension 1 -fragment_tolerance 0.3 \
  -fragment_tolerance_unit Da -complement_tolerance 0.3 -check_header_charge override -threads 2 > "$TMP/nf.log" 2>&1 \
  || { cat "$TMP/nf.log" >&2; fail "override without -fasta failed"; }
awk -F'\t' 'NR == FNR { z[$1] = $2; s[$1] = $3; next }
            FNR > 1 && ($13 != z[$1] || $14 != s[$1]) { bad++ } END { exit bad > 0 }' \
  "$TMP/ovr_map.tsv" "$TMP/nf.tsv" || fail "override (no -fasta): a row's prec_charge/charge_src is not its verdict"
novr=$(awk -F'\t' 'NR > 1 && $14 == "overridden" { print $1 }' "$TMP/nf.tsv" | sort -u | wc -l | tr -d ' ')
grep -q "disagreeing spectra were tagged at the supported charge" "$O/log" || fail "override: no summary line"
ndis=$(awk -F'\t' 'NR > 1 && $12 == "disagree"' "$O/hc.tsv" | wc -l | tr -d ' ')
[ "$novr" -ge 15 ] && [ "$novr" -le "$ndis" ] && [ $((novr * 10)) -ge $((ndis * 8)) ] \
  || fail "override: $novr spectra have overridden rows, $ndis disagree"
grep -q "^run	header_charge_overridden	$ndis	139	" "$O/t.census_summary.tsv" \
  || fail "override: header_charge_overridden is not the disagreement count $ndis"
grep -q "^run	charge_overridden	$ndis	" "$O/t.census_summary.tsv" \
  || fail "override: charge_overridden is not the disagreement count $ndis"
# Rows of non-disagreeing spectra equal warn's (first 12 columns).
awk -F'\t' 'NR > 1 && $12 != "disagree" { print "index=" $1 }' "$O/hc.tsv" | sort > "$TMP/keep.ids"
sel() { awk -F'\t' 'NR == FNR { k[$1] = 1; next } FNR > 1 && ($1 in k)' "$TMP/keep.ids" "$1" | cut -f1-12; }
sel "$TMP/wrong_warn/t.tsv" | cmp -s - <(sel "$O/t.tsv") || fail "override changed the rows of a non-disagreeing spectrum"
# Correct charges: the census charge_used against the truth, override vs the header.
right_hdr=$(awk '$1 == 2' "$TMP/truth.txt" | wc -l | tr -d ' ')
awk -F'\t' 'NR > 1 { print $6 }' "$O/t.census.tsv" | paste "$TMP/truth.txt" - > "$TMP/ovr_used.txt"
right_ovr=$(awk '$1 == $2' "$TMP/ovr_used.txt" | wc -l | tr -d ' ')
echo "header_charge_cli_test: override tags $right_ovr of 139 at the true charge (header: $right_hdr)"
[ "$right_ovr" -gt "$right_hdr" ] || fail "override recovered no charge ($right_ovr vs $right_hdr)"
full "$TMP/right_ovr" "$TMP/right.mgf" -threads 2 -check_header_charge override
nr=$(awk -F'\t' 'NR > 1 && $14 == "overridden" { print $1 }' "$TMP/right_ovr/t.tsv" | sort -u | wc -l | tr -d ' ')
[ "$nr" -le "$right_dis" ] || fail "override changed $nr spectra of the right copy, warn called $right_dis"

# ---- margin --------------------------------------------------------------------
"$BIN" -in "$TMP/wrong.mgf" -out "$TMP/m8.tsv" "${COMMON[@]}" -check_header_charge warn -check_header_margin 8 \
  -check_header_out "$TMP/m8.hc.tsv" -threads 2 > "$TMP/m8.log" 2>&1 || { cat "$TMP/m8.log" >&2; fail "margin 8 failed"; }
n8=$(awk -F'\t' 'NR > 1 && $12 == "disagree"' "$TMP/m8.hc.tsv" | wc -l | tr -d ' ')
n2=$(awk -F'\t' 'NR > 1 && $12 == "disagree"' "$H" | wc -l | tr -d ' ')
[ "$n8" -le "$n2" ] || fail "-check_header_margin 8 called more disagreements ($n8) than 2 ($n2)"
awk -F'\t' 'NR == FNR { if (FNR > 1 && $12 == "disagree") d[$1] = 1; next }
            FNR > 1 && $12 == "disagree" && !($1 in d) { bad++ } END { exit bad > 0 }' "$H" "$TMP/m8.hc.tsv" \
  || fail "-check_header_margin 8 called a disagreement margin 2 did not"

# ---- threads -------------------------------------------------------------------
for m in warn override; do
  for t in 1 3 8; do
    "$BIN" -in "$TMP/wrong.mgf" -out "$TMP/th_${m}_$t.tsv" "${COMMON[@]}" -check_header_charge $m \
      -check_header_out "$TMP/th_${m}_$t.hc.tsv" -threads $t > "$TMP/th_${m}_$t.log" 2>&1 \
      || { cat "$TMP/th_${m}_$t.log" >&2; fail "$m at $t threads failed"; }
  done
  for t in 3 8; do
    cmp -s "$TMP/th_${m}_1.tsv" "$TMP/th_${m}_$t.tsv" || fail "$m: tags differ between 1 and $t threads"
    cmp -s "$TMP/th_${m}_1.hc.tsv" "$TMP/th_${m}_$t.hc.tsv" || fail "$m: -check_header_out differs between 1 and $t threads"
  done
done

# ---- refusals and warnings ----------------------------------------------------
"$BIN" -in "$TMP/right.mgf" -out "$TMP/r1.tsv" -check_header_charge maybe > "$TMP/r1.log" 2>&1 \
  && fail "an unknown -check_header_charge value was accepted"
"$BIN" -in "$TMP/right.mgf" -out "$TMP/r2.tsv" -stream -check_header_charge warn > "$TMP/r2.log" 2>&1 \
  && fail "-stream with -check_header_charge was accepted"
"$BIN" -in "$TMP/right.mgf" -dump_spectrum index=0 -check_header_charge override > "$TMP/r3.log" 2>&1 \
  && fail "-dump_spectrum with -check_header_charge override was accepted"
grep -q "check_header_charge override" "$TMP/r3.log" || { cat "$TMP/r3.log" >&2; fail "-dump_spectrum refusal message"; }
"$BIN" -in "$TMP/right.mgf" -out "$TMP/r4.tsv" -check_header_out "$TMP/r4.hc.tsv" -threads 2 > "$TMP/r4.log" 2>&1 \
  || { cat "$TMP/r4.log" >&2; fail "-check_header_out without the check failed"; }
grep -q -- "check_header_out" "$TMP/r4.log" || fail "no ignored-option warning for -check_header_out"
[ -e "$TMP/r4.hc.tsv" ] && fail "-check_header_out was written without the check"
echo "header_charge_cli_test: all checks passed"
