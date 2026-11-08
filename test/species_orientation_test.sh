#!/usr/bin/env bash
# -species_orientation (1.12 #10): species lookup in both tag orientations on
# the fixture against the toy taxonomy index of species_call_test.sh.
#
#   * forward (the default) is byte-identical to the option absent, and with
#     FASTAG_BASELINE_BIN to the 1.11.0 binary;
#   * both writes log_pvalue and qvalue (the analytic, forward-background
#     columns 7 and 8) as NA and warns, also with -species_call decoy;
#   * exact counts: tools/species_orientation_recount.py (Python, not the C++
#     lookup) recomputes per genus the forward count, the reverse-only gains
#     and the ambiguity losses; the both count must equal forward + gains -
#     losses, and the forward count the forward report (FASTAG_FULL_PRECISION=1);
#   * at the default -max_evalue/-max_tags the absent genera gain at most the
#     predicted reverse-only gain, which is <= 2;
#   * both with -orientation forward is the same report; both is the same at
#     1, 3 and 8 threads; both with -species_call decoy keeps 15 fields,
#     columns 7 and 8 NA, a numeric decoy_qvalue (13), and its decoy_spectra equal the recount's decoy tags under the same rule;
#   * the ignored-option warning and the -stream refusal.
# Exits 77 (ctest SKIP) when the binary cannot start or python3 is missing.
set -u
BIN="$1"
BUILDTAXDB="$2"
IN="$3"       # test/fixtures/Ecoli_MS2_small.mzML
DB="$4"       # test/fixtures/Ecoli_MS2_small.fasta
TAXDIR="$5"   # data/taxonomy
RECOUNT="$6"  # tools/species_orientation_recount.py

if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi
command -v python3 >/dev/null 2>&1 || { echo "SKIP: no python3" >&2; exit 77; }
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-species-orient-test.XXXXXX") || exit 1
[ "${FASTAG_TEST_KEEP:-0}" = 1 ] && echo "work directory kept: $TMP" || trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

# ---- toy index (as species_call_test.sh) -----------------------------------
gen() {  # seed nprot len
  awk -v seed="$1" -v np="$2" -v len="$3" 'BEGIN {
    a = "ACDEFGHIKLMNPQRSTVWY"; x = seed
    for (p = 1; p <= np; ++p) {
      s = ""
      for (i = 0; i < len; ++i) { x = (x * 16807) % 2147483647; s = s substr(a, int(x / 2147483647 * 20) + 1, 1) }
      print ">syn" seed "_" p; print s
    } }'
}
mutate() {  # seed rate < fasta
  awk -v seed="$1" -v rate="$2" 'BEGIN { a = "ACDEFGHIKLMNPQRSTVWY"; x = seed }
    /^>/ { print $0 "_mut"; next }
    { s = ""; n = length($0)
      for (i = 1; i <= n; ++i) {
        c = substr($0, i, 1); x = (x * 16807) % 2147483647
        if (x / 2147483647 < rate) {
          do { x = (x * 16807) % 2147483647; d = substr(a, int(x / 2147483647 * 20) + 1, 1) } while (d == c)
          c = d
        }
        s = s c
      }
      print s }'
}
mkdir -p "$TMP/prot"
{ awk '/^>/ { if (s != "") print s; print; s = ""; next } { s = s $0 } END { if (s != "") print s }' "$DB"
  gen 11 500 300; } > "$TMP/prot/562.fasta"
mutate 12 0.05 < "$TMP/prot/562.fasta" > "$TMP/prot/28901.fasta"
gen 13 2000 300 > "$TMP/prot/1280.fasta"
gen 14 6000 300 > "$TMP/prot/4932.fasta"
# A taxon that makes both readings informative: prsA as written and reversed
# (its tags: both readings share this taxon -> intersection) and the second
# fixture protein reversed only (its tags: Escherichia as written, this taxon
# reversed -> orientation-ambiguous, skipped).
awk '/^>/ { if (s != "") print s; print; s = ""; next } { s = s $0 } END { if (s != "") print s }' "$DB" \
  | awk 'function rev(x,  r, i) { r = ""; for (i = length(x); i > 0; --i) r = r substr(x, i, 1); return r }
         /^>/ { ++n; next }
         n == 1 { print ">both_fwd"; print; print ">both_rev"; print rev($0) }
         n == 2 { print ">amb_rev"; print rev($0) }' > "$TMP/prot/1313.fasta"
"$BUILDTAXDB" "$TMP/prot" "$TMP/toy.taxdb" 7 > "$TMP/buildtaxdb.log" 2>&1 \
  || { cat "$TMP/buildtaxdb.log" >&2; fail "buildtaxdb"; }
GENUS="562:561,28901:590,1280:1279,4932:4930,1313:1301"

TAX=(-taxdb "$TMP/toy.taxdb" -taxonomy_nodes "$TAXDIR/nodes.dmp" -taxonomy_names "$TAXDIR/names.dmp")
COMMON=(-in "$IN" -tag_length 7 -extension 1 -fragment_tolerance 600 -fragment_tolerance_unit ppm
        -max_evalue 0 -max_tags 200)
export FASTAG_TAXONOMY_DIR="$TAXDIR"
export FASTAG_FULL_PRECISION=1

run() {  # name args...
  local n=$1; shift
  "$BIN" -out "$TMP/$n.tsv" "$@" < /dev/null > "$TMP/$n.log" 2>&1
}
fields() { awk -F'\t' '{ print NF }' "$1" | sort -u | tr '\n' ' ' | sed 's/ $//'; }
obs() {  # report genus -> observed (0 when absent)
  awk -F'\t' -v t="$2" 'NR > 1 && $2 == t { v = $4 } END { print v + 0 }' "$1"
}

# ---- forward: byte-identical -------------------------------------------------
run absent "${COMMON[@]}" -species "${TAX[@]}" -threads 2 || { cat "$TMP/absent.log" >&2; fail "run without the option"; }
run fwd "${COMMON[@]}" -species "${TAX[@]}" -species_orientation forward -threads 2 \
  || { cat "$TMP/fwd.log" >&2; fail "-species_orientation forward"; }
[ "$(wc -l < "$TMP/absent.species.tsv")" -ge 3 ] || fail "the toy run reports fewer than 2 genera (test is vacuous)"
cmp -s "$TMP/absent.species.tsv" "$TMP/fwd.species.tsv" || fail "forward changed the species report"
cmp -s "$TMP/absent.tsv" "$TMP/fwd.tsv" || fail "forward changed the tags"
grep -v "^FASTAG_\|took\|time" "$TMP/absent.log" > "$TMP/absent.logx"
grep -v "^FASTAG_\|took\|time" "$TMP/fwd.log" > "$TMP/fwd.logx"
! grep -q "Species orientation" "$TMP/fwd.log" || fail "forward logs the orientation line"
if [ -n "${FASTAG_BASELINE_BIN:-}" ] && [ -x "${FASTAG_BASELINE_BIN}" ]; then
  "$FASTAG_BASELINE_BIN" -out "$TMP/base.tsv" "${COMMON[@]}" -species "${TAX[@]}" -threads 2 > "$TMP/base.log" 2>&1 \
    || { cat "$TMP/base.log" >&2; fail "baseline run"; }
  cmp -s "$TMP/base.species.tsv" "$TMP/fwd.species.tsv" || fail "species report differs from $FASTAG_BASELINE_BIN"
  cmp -s "$TMP/base.tsv" "$TMP/fwd.tsv" || fail "tags differ from $FASTAG_BASELINE_BIN"
  echo "species_orientation_test: forward equals $FASTAG_BASELINE_BIN"
fi

# ---- both without decoy: log_pvalue/qvalue NA, warning, threads ---------------------------
for t in 1 3 8; do
  run both_t$t "${COMMON[@]}" -species "${TAX[@]}" -species_orientation both -threads $t \
    || { cat "$TMP/both_t$t.log" >&2; fail "both, -threads $t"; }
done
B="$TMP/both_t1.species.tsv"
cmp -s "$B" "$TMP/both_t3.species.tsv" && cmp -s "$B" "$TMP/both_t8.species.tsv" || fail "both differs between 1, 3 and 8 threads"
cmp -s "$TMP/absent.tsv" "$TMP/both_t1.tsv" || fail "both changed the tags"
[ "$(fields "$B")" = 8 ] || fail "both: not 8 fields"
[ "$(head -1 "$B")" = "$(head -1 "$TMP/absent.species.tsv")" ] || fail "both: header changed"
bad=$(awk -F'\t' 'NR > 1 && ($7 != "NA" || $8 != "NA")' "$B" | wc -l | tr -d ' ')
[ "$bad" = 0 ] || fail "both without decoy: $bad rows with a numeric log_pvalue or qvalue"
grep -q -- "-species_orientation both: the analytic log_pvalue and qvalue columns of the species report are NA under both; use decoy_qvalue from -species_call decoy" "$TMP/both_t1.log" \
  || { cat "$TMP/both_t1.log" >&2; fail "no NA warning"; }
grep -q "Species orientation (both)" "$TMP/both_t1.log" || fail "no orientation line in the log"

# ---- exact counts against the independent recount ------------------------------
# The report lists a taxon only from 5 spectra on (TaxStats kObservedFloor):
# a genus without a row must have fewer in the recount.
FLOOR=5
seen() { awk -F'\t' -v t="$2" 'NR > 1 && $2 == t { f = 1 } END { exit !f }' "$1"; }
n_rows=0
same_count() {  # report genus expected label
  if seen "$1" "$2"; then
    [ "$(obs "$1" "$2")" = "$3" ] || fail "genus $2: $4 report $(obs "$1" "$2") != recount $3"
    n_rows=$((n_rows + 1))
  else
    [ "$3" -lt "$FLOOR" ] || fail "genus $2: no $4 row, but the recount gives $3 >= $FLOOR"
  fi
}
check_counts() {  # label forward-tags forward-report both-report -> $TMP/<label>.recount
  python3 "$RECOUNT" --tags "$2" --prot-dir "$TMP/prot" --k 7 --genus "$GENUS" > "$TMP/$1.recount" \
    || fail "recount script ($1)"
  echo "recount $1:"; cat "$TMP/$1.recount"
  while IFS=$'\t' read -r g f gain loss b; do
    [ "$g" = tags ] || [ "$g" = decoy ] && continue
    [ "$b" = $((f + gain - loss)) ] || fail "recount inconsistent for $g"
    same_count "$3" "$g" "$f" "$1 forward"
    same_count "$4" "$g" "$b" "$1 both"
  done < <(tr -d '\r' < "$TMP/$1.recount")
}
# Every tag reported (-max_evalue 0, -max_tags 200): many rows, chance hits.
check_counts all "$TMP/absent.tsv" "$TMP/absent.species.tsv" "$B"
[ "$n_rows" -ge 5 ] || fail "only $n_rows report rows compared with the recount (test is vacuous)"
gain_of() { awk -F'\t' -v g="$2" '$1 == g { print $3 }' "$1"; }
[ "$(gain_of "$TMP/all.recount" 561)" -gt 0 ] || fail "Escherichia gains nothing (test is vacuous)"
# Both readings informative: the run has intersection and ambiguous tags,
# and the ambiguity costs Escherichia spectra (counts can fall).
read -r _ _ _ n_int _ n_amb < <(grep '^tags' "$TMP/all.recount")
[ "$n_int" -gt 0 ] && [ "$n_amb" -gt 0 ] || fail "no intersection ($n_int) or ambiguous ($n_amb) tags (test is vacuous)"
loss_of() { awk -F'\t' -v g="$2" '$1 == g { print $4 }' "$1"; }
[ "$(loss_of "$TMP/all.recount" 561)" -gt 0 ] || fail "Escherichia loses nothing to ambiguity (test is vacuous)"
# The recount binds columns by header name and keeps only species evidence
# (contract 2.3): rows with selected != 1 (#6) and ion_series != by (#15B)
# are dropped. A copy of the tags with those columns appended last, with
# a duplicate of every row under selected 0 and one under ion_series cz,
# must recount exactly like the original; a moved column must not matter.
awk -F'\t' -v OFS='\t' 'NR == 1 { print $0, "selected", "ion_series"; next }
  { print $0, 1, "by"; x = $0; print x, 0, "by"; print x, 1, "cz" }' "$TMP/absent.tsv" > "$TMP/sel.tsv"
awk -F'\t' -v OFS='\t' '{ n = $8; for (i = 8; i < NF; ++i) $i = $(i + 1); $NF = n; print }' "$TMP/sel.tsv" > "$TMP/sel_moved.tsv"
for v in sel sel_moved; do
  python3 "$RECOUNT" --tags "$TMP/$v.tsv" --prot-dir "$TMP/prot" --k 7 --genus "$GENUS" > "$TMP/$v.recount" \
    || fail "recount script ($v)"
  cmp -s "$TMP/all.recount" "$TMP/$v.recount" || { diff "$TMP/all.recount" "$TMP/$v.recount" >&2; fail "recount ($v): selected/ion_series filter or header binding"; }
done
# At the default -max_evalue and -max_tags the genera absent from the sample
# gain at most 2 spectra from the reversed readings, and the both count is
# at most forward + that predicted gain.
LIGHT=(-in "$IN" -tag_length 7 -extension 1 -fragment_tolerance 600 -fragment_tolerance_unit ppm)
run light "${LIGHT[@]}" -species "${TAX[@]}" -threads 2 || { cat "$TMP/light.log" >&2; fail "default-cutoff run"; }
run light_both "${LIGHT[@]}" -species "${TAX[@]}" -species_orientation both -threads 2 \
  || { cat "$TMP/light_both.log" >&2; fail "default-cutoff both run"; }
check_counts light "$TMP/light.tsv" "$TMP/light.species.tsv" "$TMP/light_both.species.tsv"
for g in 1279 4930; do
  read -r _ f gain loss b < <(awk -F'\t' -v g=$g '$1 == g' "$TMP/light.recount")
  [ "$gain" -le 2 ] || fail "absent genus $g: predicted reverse-only gain $gain > 2"
  [ "$b" -le $((f + gain)) ] || fail "absent genus $g: both above forward + predicted gain"
done
[ "$(gain_of "$TMP/light.recount" 561)" -gt 0 ] || fail "Escherichia gains nothing at the default cutoffs"
# The tag-level outcome counts of the log equal the recount's.
read -r _ rf rr rb rp ra < <(grep '^tags' "$TMP/all.recount")
want="informative tags $rf forward only, $rr reverse only, $rb both (shared taxa), $rp palindromes; $ra orientation-ambiguous"
grep -q "$want" "$TMP/both_t1.log" || { grep "Species orientation" "$TMP/both_t1.log" >&2; fail "log counts differ from the recount: $want"; }
# Gapped rows are excluded: the run reports some, so the exclusion matters.
ng=$(awk -F'\t' 'NR > 1 && substr($8, 1, 1) == "1"' "$TMP/absent.tsv" | wc -l | tr -d ' ')
[ "$ng" -gt 0 ] || fail "no gapped rows in the tags (gapped exclusion untested)"

# ---- -orientation forward does not matter --------------------------------------
run orf "${COMMON[@]}" -species "${TAX[@]}" -species_orientation both -orientation forward -threads 2 \
  || { cat "$TMP/orf.log" >&2; fail "both with -orientation forward"; }
cmp -s "$B" "$TMP/orf.species.tsv" || fail "-orientation forward changed the both report"

# ---- with -species_call decoy ----------------------------------------------------
printf 'version\ttest\nalpha\t0.05\ntau\t0\nn_min\t5\n' > "$TMP/params.tsv"
run dec "${COMMON[@]}" -species "${TAX[@]}" -species_orientation both -species_call decoy \
    -species_call_min_units 10 -species_call_params "$TMP/params.tsv" -threads 2 \
  || { cat "$TMP/dec.log" >&2; fail "both with decoy"; }
[ "$(fields "$TMP/dec.species.tsv")" = 15 ] || fail "both with decoy: not 15 fields"
# The analytic columns stay NA under decoy: decoy calls calibrate only
# decoy_qvalue and call, not the forward-background log_pvalue/qvalue.
bad=$(awk -F'\t' 'NR > 1 && ($7 != "NA" || $8 != "NA")' "$TMP/dec.species.tsv" | wc -l | tr -d ' ')
[ "$bad" = 0 ] || fail "both with decoy: $bad rows with a numeric log_pvalue or qvalue"
bad=$(awk -F'\t' 'NR > 1 && $13 !~ /^[0-9.eE+-]+$/' "$TMP/dec.species.tsv" | wc -l | tr -d ' ')
[ "$bad" = 0 ] || fail "both with decoy: $bad rows without a numeric decoy_qvalue"
[ "$(awk 'END { print NR }' "$TMP/dec.species.tsv")" -ge 2 ] || fail "both with decoy: no rows (vacuous)"
grep -q -- "are NA under both; use decoy_qvalue and call from -species_call decoy" "$TMP/dec.log" \
  || { cat "$TMP/dec.log" >&2; fail "no NA warning under decoy"; }
for g in 561 590 1279 4930 1301; do
  [ "$(obs "$TMP/dec.species.tsv" "$g")" = "$(obs "$B" "$g")" ] || fail "decoy changed the observed count of $g"
done
# The decoy null follows the orientation rule: decoy_spectra (column 11) of
# forward and both runs equal the recount of SpeciesLookup::decoyTag under
# each rule (D = 5, the default -species_call_decoys).
run decf "${COMMON[@]}" -species "${TAX[@]}" -species_call decoy \
    -species_call_min_units 10 -species_call_params "$TMP/params.tsv" -threads 2 \
  || { cat "$TMP/decf.log" >&2; fail "forward with decoy"; }
awk -F'\t' 'NR > 1 && ($7 == "NA" || $8 == "NA") { exit 1 }' "$TMP/decf.species.tsv" \
  || fail "forward with decoy: analytic log_pvalue/qvalue NA (must keep the 1.10 meaning)"
! grep -q "are NA under both" "$TMP/decf.log" || fail "NA warning under forward"
python3 "$RECOUNT" --tags "$TMP/absent.tsv" --prot-dir "$TMP/prot" --k 7 --genus "$GENUS" --decoys 5 \
  > "$TMP/decoy.recount" || fail "recount script (decoys)"
grep '^decoy' "$TMP/decoy.recount"
dcol() { awk -F'\t' -v t="$2" 'NR > 1 && $2 == t { v = $11 } END { print v + 0 }' "$1"; }
n_dec=0; n_diff=0; n_nz=0
while IFS=$'\t' read -r _ g df db; do
  if seen "$TMP/decf.species.tsv" "$g"; then
    [ "$(dcol "$TMP/decf.species.tsv" "$g")" = "$df" ] || fail "genus $g: forward decoy_spectra $(dcol "$TMP/decf.species.tsv" "$g") != recount $df"
    n_dec=$((n_dec + 1))
  fi
  if seen "$TMP/dec.species.tsv" "$g"; then
    [ "$(dcol "$TMP/dec.species.tsv" "$g")" = "$db" ] || fail "genus $g: both decoy_spectra $(dcol "$TMP/dec.species.tsv" "$g") != recount $db"
    n_dec=$((n_dec + 1))
  fi
  [ "$db" -gt 0 ] && n_nz=$((n_nz + 1))
  [ "$db" != "$df" ] && n_diff=$((n_diff + 1))
done < <(grep '^decoy' "$TMP/decoy.recount")
[ "$n_dec" -ge 4 ] && [ "$n_nz" -gt 0 ] && [ "$n_diff" -gt 0 ] \
  || fail "decoy check vacuous ($n_dec rows compared, $n_nz genera with decoy hits, $n_diff differ between the rules)"

# ---- warnings and refusals --------------------------------------------------------
run warn "${COMMON[@]}" -species_orientation both -threads 2 || { cat "$TMP/warn.log" >&2; fail "without -species"; }
grep -q -- "-species_orientation is only read for -species" "$TMP/warn.log" || { cat "$TMP/warn.log" >&2; fail "no ignored-option warning"; }
if run stream -stream -species_orientation both; then fail "-stream not refused"; fi
grep -q -- "-stream cannot be combined with -species_orientation" "$TMP/stream.log" || { cat "$TMP/stream.log" >&2; fail "-stream refusal text"; }
if run badmode "${COMMON[@]}" -species "${TAX[@]}" -species_orientation reverse -threads 2; then fail "bad mode accepted"; fi
[ ! -e "$TMP/badmode.species.tsv" ] || fail "bad mode wrote a report"

echo "species_orientation_test: passed ($n_rows report rows equal the recount)"
