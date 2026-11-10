#!/usr/bin/env bash
# 1.13 (backlog #14) -check_header_charge against the real binary, on the
# vendored MGF (139 spectra: 97 2+, 33 3+, 9 4+) and on a copy whose 3+ and 4+
# precursors are all given as 2+ (42 wrong header charges):
#   - off spelled out and warn leave every output byte-identical to the
#     options absent (tags, recon, delta, digest, label, massgap, census and
#     its summary); off writes no check row and no summary line;
#   - warn writes one -check_header_out row per header-charged spectrum, the
#     summary line, and the check rows of the census summary; on the wrong
#     copy (default margin 6) it calls a disagreement on at least 10 of the
#     42 wrong headers (10 measured) and on at most 2 of the 97 right ones
#     (2 measured), at most 3 of 139 on the right copy, and every disagreement on a wrong
#     header calls a charge above 2;
#   - both on the wrong copy tags exactly the disagreeing spectra under the
#     header charge and the charge the check found (charge_src check_call,
#     not selected); the header rows equal warn's (E-values doubled, so a
#     subset, on a flagged spectrum); on the
#     right copy it adds rows to no more spectra than warn flags there;
#   - a smaller -check_header_margin (2) calls every disagreement of the
#     default and at least as many;
#   - warn and both write the same bytes at 1, 3 and 8 threads;
#   - refusals: an unknown mode, -stream, -dump_spectrum with both; the
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

# -check_header_out columns by name (flag_charge, verdict, tagged_charge).
FC=16; VC=17; TC=18
# ---- off and warn leave every output as it was ------------------------------
for in in right wrong; do
  full "$TMP/${in}_absent" "$TMP/$in.mgf" -threads 2
  full "$TMP/${in}_off" "$TMP/$in.mgf" -threads 2 -check_header_charge off -check_header_margin 6
  full "$TMP/${in}_warn" "$TMP/$in.mgf" -threads 2 -check_header_charge warn -check_header_out "$TMP/${in}_warn/hc.tsv"
  for x in "${OUTS[@]}"; do
    [ -s "$TMP/${in}_absent/t.$x" ] || fail "$in: no t.$x"
    cmp -s "$TMP/${in}_absent/t.$x" "$TMP/${in}_off/t.$x" || fail "$in: -check_header_charge off changed t.$x"
    if [ "$x" = census_summary.tsv ]; then
      # warn appends its run rows after the #6 rows; every other row is unchanged.
      grep -v -E '^run	(check_header_charge|header_charge_[a-z]*)	' "$TMP/${in}_warn/t.$x" \
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
  for k in agree disagree ambiguous nocall both; do
    grep -q "^run	header_charge_$k	[0-9]*	139	" "$TMP/${in}_warn/t.census_summary.tsv" \
      || fail "$in: no header_charge_$k row of 139"
  done
  [ "$(wc -l < "$TMP/${in}_warn/hc.tsv" | tr -d ' ')" = 140 ] || fail "$in: -check_header_out does not have 139 rows"
  [ "$(head -1 "$TMP/${in}_warn/hc.tsv")" = "$(printf 'index\tnative_id\tprecursor_mz\theader_charge\tcall_charge\tcall_src\tbasis\trunner_up\theader_excess\tcall_excess\theader_ruled_out\theader_peaks_above\tms1_charge\tms1_peaks\tflag_basis\tflag_charge\tverdict\ttagged_charge')" ] \
    || fail "$in: -check_header_out header"
  # warn tags at the header: tagged_charge is the header charge everywhere.
  awk -F'\t' -v T=$TC 'NR > 1 && $T != $4 { bad++ } END { exit bad > 0 }' "$TMP/${in}_warn/hc.tsv" \
    || fail "$in: warn reports a tagged charge other than the header"
  # The summary counts equal the rows.
  for k in agree disagree ambiguous nocall; do
    n=$(awk -F'\t' -v k=$k -v V=$VC 'NR > 1 && $V == k' "$TMP/${in}_warn/hc.tsv" | wc -l | tr -d ' ')
    grep -q "^run	header_charge_$k	$n	" "$TMP/${in}_warn/t.census_summary.tsv" \
      || fail "$in: header_charge_$k row is not the $n rows of -check_header_out"
  done
done

# ---- warn on the wrong headers: recall and false calls -------------------------
H=$TMP/wrong_warn/hc.tsv
cut -f$VC,5 "$H" | tail -n +2 > "$TMP/wrong_calls.txt"   # call_charge \t verdict
paste "$TMP/truth.txt" "$TMP/wrong_calls.txt" > "$TMP/wrong_scored.txt"  # truth call verdict
caught=$(awk '$1 >= 3 && $3 == "disagree"' "$TMP/wrong_scored.txt" | wc -l | tr -d ' ')
false_w=$(awk '$1 == 2 && $3 == "disagree"' "$TMP/wrong_scored.txt" | wc -l | tr -d ' ')
bad_dir=$(awk '$1 >= 3 && $3 == "disagree" && $2 <= 2' "$TMP/wrong_scored.txt" | wc -l | tr -d ' ')
right_dis=$(awk -F'\t' -v V=$VC 'NR > 1 && $V == "disagree"' "$TMP/right_warn/hc.tsv" | wc -l | tr -d ' ')
echo "header_charge_cli_test: wrong headers caught $caught of 42; false disagreements $false_w of 97 (wrong copy), $right_dis of 139 (right copy)"
[ "$caught" -ge 10 ] || fail "warn caught only $caught of the 42 wrong header charges (need >= 10)"
[ "$false_w" -le 2 ] || fail "warn called $false_w of the 97 right 2+ headers wrong (allowed <= 2)"
[ "$right_dis" -le 3 ] || fail "warn called $right_dis of 139 right headers wrong (allowed <= 3)"
[ "$bad_dir" = 0 ] || fail "$bad_dir disagreements on a wrong 2+ header call 2 or lower"

# ---- both ------------------------------------------------------------------------
full "$TMP/wrong_both" "$TMP/wrong.mgf" -threads 2 -check_header_charge both -check_header_out "$TMP/wrong_both/hc.tsv"
O=$TMP/wrong_both
[ "$(head -1 "$O/t.tsv" | cut -f13-)" = "$(printf 'prec_charge\tcharge_src\tiso_offset\tselected')" ] \
  || fail "both: the hypothesis columns are missing"
cut -f1-$VC "$O/hc.tsv" | cmp -s - <(cut -f1-$VC "$H") || fail "both: the check rows differ from warn's"
# tagged_charge: "lo,hi" of header and flagged charge on a disagreement, else the header.
awk -F'\t' -v V=$VC -v T=$TC -v F=$FC 'NR > 1 { want = $4
              if ($V == "disagree") want = ($F < $4) ? $F "," $4 : $4 "," $F
              if ($T != want) bad++ } END { exit bad > 0 }' "$O/hc.tsv" \
  || fail "both: tagged_charge is not header,flagged charge (disagree) or the header"
# Every row is a selected header row at the header charge, or an unselected
# check_call row at the flagged charge of a disagreeing spectrum.
rows_ok() {  # tags.tsv
  awk -F'\t' -v V=$VC -v F=$FC 'NR == FNR { if (FNR > 1) { h["index=" $1] = $4; f["index=" $1] = ($V == "disagree") ? $F : 0 } next }
       FNR > 1 && !(($14 == "header" && $13 == h[$1] && $16 == 1) || ($14 == "check_call" && $13 == f[$1] && $16 == 0)) { bad++ }
       END { exit bad > 0 }' "$O/hc.tsv" "$1"
}
rows_ok "$O/t.tsv" || fail "both: a row is neither a selected header row nor a check_call row at the flagged charge"
# The header rows are warn's rows (first 12 columns). A spectrum tagged under
# both charges has H = 2 hypotheses: its E-values are doubled before
# -max_evalue and -max_tags, so its header rows are a subset of warn's.
awk -F'\t' -v V=$VC 'FILENAME == ARGV[1] { if (FNR > 1 && $V == "disagree") d["index=" $1] = 1; next }
     { k = $1; for (i = 2; i <= 12; i++) if (i != 9) k = k "\t" $i }
     FILENAME == ARGV[2] { if (FNR > 1) w[k] = $9; next }
     FNR > 1 && $14 == "header" {
       if (!(k in w)) { bad++; next }
       r = $9 / w[k]; f = ($1 in d) ? 2 : 1
       if (r < f * 0.9999 || r > f * 1.0001) bad++
       if (!($1 in d)) same++ }
     END { exit bad > 0 || same == 0 }' "$O/hc.tsv" "$TMP/wrong_warn/t.tsv" "$O/t.tsv" \
  || fail "both changed the rows tagged under the header charge (beyond the doubled E-values of a flagged spectrum)"
awk -F'\t' -v V=$VC 'FILENAME == ARGV[1] { if (FNR > 1 && $V == "disagree") d["index=" $1] = 1; next }
     FNR > 1 && !($1 in d)' "$O/hc.tsv" "$O/t.tsv" | cut -f1-12 \
  | cmp -s - <(awk -F'\t' -v V=$VC 'FILENAME == ARGV[1] { if (FNR > 1 && $V == "disagree") d["index=" $1] = 1; next }
     FNR > 1 && !($1 in d)' "$O/hc.tsv" "$TMP/wrong_warn/t.tsv" | cut -f1-12) \
  || fail "both changed the rows of a spectrum it did not flag"
# Without -fasta every tagged row is written.
"$BIN" -in "$TMP/wrong.mgf" -out "$TMP/nf.tsv" -tag_length 4 -extension 1 -fragment_tolerance 0.3 \
  -fragment_tolerance_unit Da -complement_tolerance 0.3 -check_header_charge both -threads 2 > "$TMP/nf.log" 2>&1 \
  || { cat "$TMP/nf.log" >&2; fail "both without -fasta failed"; }
rows_ok "$TMP/nf.tsv" || fail "both (no -fasta): a row is neither a header row nor a check_call row"
nboth=$(awk -F'\t' 'NR > 1 && $14 == "check_call" { print $1 }' "$TMP/nf.tsv" | sort -u | wc -l | tr -d ' ')
grep -q "disagreeing spectra were tagged under both charges" "$O/log" || fail "both: no summary line"
grep -q "check_header_charge both is experimental" "$O/log" || fail "both: no experimental warning"
grep -q "both is experimental" "$TMP/wrong_warn/log" && fail "warn printed the both warning"
ndis=$(awk -F'\t' -v V=$VC 'NR > 1 && $V == "disagree"' "$O/hc.tsv" | wc -l | tr -d ' ')
[ "$nboth" -ge 8 ] && [ "$nboth" -le "$ndis" ] && [ $((nboth * 10)) -ge $((ndis * 8)) ] \
  || fail "both: $nboth spectra have check_call rows, $ndis disagree"
grep -q "^run	header_charge_both	$ndis	139	" "$O/t.census_summary.tsv" \
  || fail "both: header_charge_both is not the disagreement count $ndis"
# The census keeps the header charge (the selected hypothesis).
awk -F'\t' 'NR > 1 && $6 != 2 { bad++ } END { exit bad > 0 }' "$O/t.census.tsv" || fail "both: a census charge_used is not the header"
# True charges among the check_call rows.
awk -F'\t' 'NR > 1 && $14 == "check_call" { print substr($1, 7) + 1 "\t" $13 }' "$TMP/nf.tsv" | sort -u > "$TMP/both_calls.txt"
right_both=$(awk 'NR == FNR { t[FNR] = $1; next } t[$1] == $2' "$TMP/truth.txt" "$TMP/both_calls.txt" | wc -l | tr -d ' ')
echo "header_charge_cli_test: both adds the true charge for $right_both of the 42 wrong headers ($nboth spectra with check_call rows)"
[ "$right_both" -ge 8 ] || fail "both added the true charge for only $right_both spectra"
full "$TMP/right_both" "$TMP/right.mgf" -threads 2 -check_header_charge both
nr=$(awk -F'\t' 'NR > 1 && $14 == "check_call" { print $1 }' "$TMP/right_both/t.tsv" | sort -u | wc -l | tr -d ' ')
[ "$nr" -le "$right_dis" ] || fail "both added rows to $nr spectra of the right copy, warn flagged $right_dis"

# ---- margin --------------------------------------------------------------------
"$BIN" -in "$TMP/wrong.mgf" -out "$TMP/m2.tsv" "${COMMON[@]}" -check_header_charge warn -check_header_margin 2 \
  -check_header_out "$TMP/m2.hc.tsv" -threads 2 > "$TMP/m2.log" 2>&1 || { cat "$TMP/m2.log" >&2; fail "margin 2 failed"; }
n2=$(awk -F'\t' -v V=$VC 'NR > 1 && $V == "disagree"' "$TMP/m2.hc.tsv" | wc -l | tr -d ' ')
n6=$(awk -F'\t' -v V=$VC 'NR > 1 && $V == "disagree"' "$H" | wc -l | tr -d ' ')
[ "$n6" -le "$n2" ] || fail "the default margin called more disagreements ($n6) than margin 2 ($n2)"
awk -F'\t' -v V=$VC 'NR == FNR { if (FNR > 1 && $V == "disagree") d[$1] = 1; next }
            FNR > 1 && $V == "disagree" && !($1 in d) { bad++ } END { exit bad > 0 }' "$TMP/m2.hc.tsv" "$H" \
  || fail "the default margin called a disagreement margin 2 did not"
echo "header_charge_cli_test: margin 2 calls $n2 disagreements, the default $n6"

# ---- threads -------------------------------------------------------------------
for m in warn both; do
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
"$BIN" -in "$TMP/right.mgf" -dump_spectrum index=0 -check_header_charge both > "$TMP/r3.log" 2>&1 \
  && fail "-dump_spectrum with -check_header_charge both was accepted"
grep -q "check_header_charge both" "$TMP/r3.log" || { cat "$TMP/r3.log" >&2; fail "-dump_spectrum refusal message"; }
"$BIN" -in "$TMP/right.mgf" -out "$TMP/r4.tsv" -check_header_out "$TMP/r4.hc.tsv" -threads 2 > "$TMP/r4.log" 2>&1 \
  || { cat "$TMP/r4.log" >&2; fail "-check_header_out without the check failed"; }
grep -q -- "check_header_out" "$TMP/r4.log" || fail "no ignored-option warning for -check_header_out"
[ -e "$TMP/r4.hc.tsv" ] && fail "-check_header_out was written without the check"
echo "header_charge_cli_test: all checks passed"
