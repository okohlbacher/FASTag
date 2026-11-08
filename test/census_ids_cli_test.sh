#!/usr/bin/env bash
# -census_ids (FASTag 1.12 #11 phase B, the ids join) against the real binary.
# The identification files are written at test time by census_ids_test
# --write-ids from a fixed pattern over the MS2 ordinal, with the expected
# identified value per native id (independent of the matcher under test).
#   (a) the tag TSV, the census columns of phase A and the phase-A summary rows
#       are identical with and without -census_ids; recon.tsv too
#   (b) identified equals the expectation; (c) triage follows its rule as
#       recomputed from the row; (d) the census_ids cross-tab and counts match
#       the table
#   (e) q-value as score type, as meta value (q-value and MS:1002354), mzid,
#       the scan fallback, a duplicate scan (unknown)
#   (f) a wrong run warns, a merged run and an unfiltered file are refused
#       before any output; references to foreign spectra warn above 1% and
#       refuse the census above 50%, with every other output complete
#   (g) -census_ids_fdr moves the threshold; (h) under subsampling the
#       unmatched count is not known and refuses nothing
#   (i) the options are only read with -census / -census_ids
#   (j) identifications without a spectrum_reference (some, all) are refused
#       before any output, naming the cause
# Columns are found by name in the header: identified and triage are the
# last two, after the N columns of the census (N from the plain census).
set -u
BIN="$1"
HELPER="$2"   # census_ids_test
IN="$3"       # Ecoli_MS2_small.mzML
DB="$4"       # Ecoli_MS2_small.fasta

if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-census-ids.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
ARGS=(-fragment_tolerance 0.3 -fragment_tolerance_unit Da -threads 2)
STATUSES="empty no_precursor no_signal bad_precursor too_few_peaks no_tags filtered placed tagged"
run() { local log="$1"; shift; "$BIN" "$@" >"$log" 2>&1 || { cat "$log" >&2; fail "run failed: $*"; }; }
rows() { tail -n +2 "$1" | wc -l | tr -d ' '; }
val() { awk -F'\t' -v s="$2" -v k="$3" '$1 == s && $2 == k { print $3; f = 1 } END { if (!f) print "MISSING" }' "$1"; }
ids() { "$HELPER" --write-ids "$IN" "$TMP/$1.$2" "$1" "$TMP/$1.want" || fail "helper failed for $1"; }

for v in good meta scan dupscan noq wrongrun merged foreign fewforeign noref allnoref; do ids $v idXML; done
ids mzid mzid
[ "$(awk -F'\t' '$2 == "1"' "$TMP/good.want" | wc -l)" -gt 5 ] || fail "the fixture identifies too few spectra"
[ "$(awk -F'\t' '$2 == ""' "$TMP/dupscan.want" | wc -l | tr -d ' ')" = 1 ] || fail "dupscan fixture"

# ---- plain census, the reference of (a) ------------------------------------------
mkdir -p "$TMP/plain"
run "$TMP/plain/log" -in "$IN" -out "$TMP/plain/tags.tsv" -census ${ARGS[@]+"${ARGS[@]}"}
PC="$TMP/plain/tags.census.tsv"; PS="$TMP/plain/tags.census_summary.tsv"
col() { head -1 "$1" | tr '\t' '\n' | grep -nx -- "$2" | head -1 | cut -d: -f1; }
NC=$(head -1 "$PC" | tr '\t' '\n' | wc -l | tr -d ' ')   # census columns of phase A
CSP=$(col "$PC" spectrum); CST=$(col "$PC" status); CBE=$(col "$PC" best_evalue)
[ -n "$CSP" ] && [ -n "$CST" ] && [ -n "$CBE" ] && [ "$NC" -gt 3 ] || fail "plain census header"
CID=$((NC + 1)); CTR=$((NC + 2))

check_join() {  # dir want
  local d="$1" want="$2" c="$1/tags.census.tsv" s="$1/tags.census_summary.tsv"
  cmp -s "$TMP/plain/tags.tsv" "$d/tags.tsv" || fail "(a) $d: the tag TSV differs with -census_ids"
  local n; n=$(( $(head -1 "$c" | tr '\t' '\n' | wc -l) - 2 ))
  [ "$n" = "$NC" ] || fail "(a) $d: $n census columns before identified and triage, want $NC"
  cmp -s "$PC" <(cut -f1-"$n" "$c") || fail "(a) $d: the census columns differ with -census_ids"
  [ "$(col "$c" identified)" = "$CID" ] && [ "$(col "$c" triage)" = "$CTR" ] || fail "(a) $d: header"
  awk -F'\t' -v n=$CTR 'NF != n { exit 1 }' "$c" || fail "(a) $d: a row has not $CTR fields"
  cmp -s "$PS" <(awk -F'\t' '$1 != "census_ids"' "$s") || fail "(a) $d: the phase-A summary rows differ"
  awk -F'\t' 'NF != 5 { exit 1 }' "$s" || fail "(a) $d: a summary line has not five fields"
  # (b) identified per native id
  cmp -s <(tr -d '\r' < "$want" | sort) <(tr -d '\r' < "$c" | awk -F'\t' -v sp=$CSP -v id=$CID 'BEGIN { OFS = "\t" } NR > 1 { print $sp, $id }' | sort) \
    || fail "(b) $d: identified differs from the expectation"
  # (c) triage = identified 0, tagged/placed, best_evalue <= 0.01; empty for unknown
  awk -F'\t' -v t="${3:-0.01}" -v id=$CID -v tr=$CTR -v st=$CST -v be=$CBE 'NR > 1 {
      want = ($id == "") ? "" : (($id == "0" && ($st == "tagged" || $st == "placed") && $be != "" && $be + 0 <= t) ? "1" : "0")
      if ($tr != want) { print "row " NR ": triage " $tr " want " want; bad = 1 } }
      END { exit bad }' "$c" || fail "(c) $d: triage"
  # (d) summary against the table
  local k
  for k in 1 0; do
    [ "$(val "$s" census_ids identified_$k)" = "$(awk -F'\t' -v k=$k -v id=$CID 'NR > 1 && $id == k' "$c" | wc -l | tr -d ' ')" ] \
      || fail "(d) $d: identified_$k"
  done
  [ "$(val "$s" census_ids identified_unknown)" = "$(awk -F'\t' -v id=$CID 'NR > 1 && $id == ""' "$c" | wc -l | tr -d ' ')" ] \
    || fail "(d) $d: identified_unknown"
  [ "$(val "$s" census_ids triage_candidates)" = "$(awk -F'\t' -v tr=$CTR 'NR > 1 && $tr == "1"' "$c" | wc -l | tr -d ' ')" ] \
    || fail "(d) $d: triage_candidates"
  [ "$(val "$s" census_ids census_ids_version)" = 1 ] || fail "(d) $d: census_ids_version"
  local st sum=0
  for st in $STATUSES; do
    for k in 1 0 unknown; do
      local n; n=$(val "$s" census_ids "${st}_identified_$k")
      [ "$n" != MISSING ] || fail "(d) $d: ${st}_identified_$k missing"
      local kk=$k; [ $k = unknown ] && kk=""
      [ "$n" = "$(awk -F'\t' -v st=$st -v k="$kk" -v s=$CST -v id=$CID 'NR > 1 && $s == st && $id == k' "$c" | wc -l | tr -d ' ')" ] \
        || fail "(d) $d: ${st}_identified_$k = $n does not match the rows"
      sum=$((sum + n))
    done
  done
  [ "$sum" = "$(rows "$c")" ] || fail "(d) $d: the cross-tab sums to $sum"
  ls "$d" | grep -q '\.part' && fail "$d: a .part file was left behind"
  return 0
}

# ---- (a)-(e) -------------------------------------------------------------------
for v in good meta mzid scan dupscan; do
  ext=idXML; [ $v = mzid ] && ext=mzid
  mkdir -p "$TMP/$v"
  run "$TMP/$v/log" -in "$IN" -out "$TMP/$v/tags.tsv" -census -census_ids "$TMP/$v.$ext" ${ARGS[@]+"${ARGS[@]}"}
  check_join "$TMP/$v" "$TMP/$v.want"
  grep -q "^Census ids:" "$TMP/$v/log" || fail "$v: no 'Census ids:' log line"
done
[ "$(val "$TMP/good/tags.census_summary.tsv" census_ids refs_scan)" = 0 ] || fail "(e) good: scan fallback used"
[ "$(val "$TMP/scan/tags.census_summary.tsv" census_ids refs_scan)" -gt 0 ] || fail "(e) scan: no scan fallback"
[ "$(val "$TMP/good/tags.census_summary.tsv" census_ids run_check)" = match ] || fail "(e) run_check"
[ "$(awk -F'\t' -v tr=$CTR 'NR > 1 && $tr == "1"' "$TMP/good/tags.census.tsv" | wc -l)" -gt 0 ] || fail "(c) no triage candidate; the rule is untested"
[ "$(awk -F'\t' -v id=$CID -v s=$CST 'NR > 1 && $id == "1" && $s == "tagged"' "$TMP/good/tags.census.tsv" | wc -l)" -gt 0 ] \
  || fail "(c) no identified tagged spectrum; the triage exclusion is untested"

# With -fasta -recon_out: recon.tsv unchanged, placed rows joined too.
mkdir -p "$TMP/r0" "$TMP/r1"
run "$TMP/r0/log" -in "$IN" -out "$TMP/r0/tags.tsv" -fasta "$DB" -recon_out "$TMP/r0/recon.tsv" -tag_length 4 -census ${ARGS[@]+"${ARGS[@]}"}
run "$TMP/r1/log" -in "$IN" -out "$TMP/r1/tags.tsv" -fasta "$DB" -recon_out "$TMP/r1/recon.tsv" -tag_length 4 -census \
  -census_ids "$TMP/good.idXML" ${ARGS[@]+"${ARGS[@]}"}
cmp -s "$TMP/r0/recon.tsv" "$TMP/r1/recon.tsv" || fail "(a) recon.tsv differs with -census_ids"
cmp -s "$TMP/r0/tags.tsv" "$TMP/r1/tags.tsv" || fail "(a) -fasta: tags differ with -census_ids"
cmp -s "$TMP/r0/tags.census.tsv" <(cut -f1-"$NC" "$TMP/r1/tags.census.tsv") || fail "(a) -recon_out: census columns differ"
[ "$(awk -F'\t' -v s=$CST 'NR > 1 && $s == "placed"' "$TMP/r1/tags.census.tsv" | wc -l)" -gt 0 ] || fail "no placed row with -recon_out"

# ---- (f) provenance and refusals ----------------------------------------------------
mkdir -p "$TMP/wrongrun"
run "$TMP/wrongrun/log" -in "$IN" -out "$TMP/wrongrun/tags.tsv" -census -census_ids "$TMP/wrongrun.idXML" ${ARGS[@]+"${ARGS[@]}"}
grep -q "census_ids names the run 'other_run'" "$TMP/wrongrun/log" || fail "(f) no warning for a wrong run"
check_join "$TMP/wrongrun" "$TMP/wrongrun.want"
[ "$(val "$TMP/wrongrun/tags.census_summary.tsv" census_ids run_check)" = mismatch ] || fail "(f) run_check mismatch"
for v in merged noq; do
  mkdir -p "$TMP/$v"
  "$BIN" -in "$IN" -out "$TMP/$v/tags.tsv" -census -census_ids "$TMP/$v.idXML" ${ARGS[@]+"${ARGS[@]}"} >"$TMP/$v/log" 2>&1 \
    && fail "(f) $v ran (exit 0)"
  [ ! -e "$TMP/$v/tags.tsv" ] || fail "(f) $v: refused only after writing outputs"
  ls "$TMP/$v" | grep -q census && fail "(f) $v: a census file was written"
done
grep -q "IDFilter" "$TMP/noq/log" || fail "(f) the refusal of an unfiltered file does not name IDFilter"
grep -q "more than one run" "$TMP/merged/log" || fail "(f) the merged-run refusal does not say so"

# ---- (j) identifications without a spectrum_reference --------------------------------
for v in noref allnoref; do
  mkdir -p "$TMP/$v"
  "$BIN" -in "$IN" -out "$TMP/$v/tags.tsv" -census -census_ids "$TMP/$v.idXML" ${ARGS[@]+"${ARGS[@]}"} >"$TMP/$v/log" 2>&1
  rc=$?
  [ $rc != 0 ] || fail "(j) $v ran (exit 0)"
  [ ! -e "$TMP/$v/tags.tsv" ] || fail "(j) $v: refused only after writing outputs"
  ls "$TMP/$v" | grep -q census && fail "(j) $v: a census file was written"
  grep -q "carry no spectrum_reference" "$TMP/$v/log" || fail "(j) $v: the refusal does not name the missing spectrum_reference"
  grep -q "IDFileConverter -mz_file" "$TMP/$v/log" || fail "(j) $v: the refusal does not name IDFileConverter -mz_file"
  grep -q "another run" "$TMP/$v/log" && fail "(j) $v: blamed on another run"
done
# also under subsampling, where the unmatched check is skipped
mkdir -p "$TMP/norefsub"
"$BIN" -in "$IN" -out "$TMP/norefsub/tags.tsv" -census -census_ids "$TMP/noref.idXML" -subsample_spectra 40 \
  -subsample_seed 3 ${ARGS[@]+"${ARGS[@]}"} >"$TMP/norefsub/log" 2>&1 && fail "(j) noref under subsampling ran (exit 0)"
grep -q "carry no spectrum_reference" "$TMP/norefsub/log" || fail "(j) noref under subsampling: no refusal"
[ "$(val "$TMP/good/tags.census_summary.tsv" census_ids id_no_ref)" = 0 ] || fail "(j) id_no_ref row"

mkdir -p "$TMP/foreign" "$TMP/fewforeign"
"$BIN" -in "$IN" -out "$TMP/foreign/tags.tsv" -census -census_ids "$TMP/foreign.idXML" ${ARGS[@]+"${ARGS[@]}"} >"$TMP/foreign/log" 2>&1 \
  && fail "(f) more than 50% foreign references ran (exit 0)"
grep -q "match no spectrum" "$TMP/foreign/log" || fail "(f) no message for the foreign references"
cmp -s "$TMP/plain/tags.tsv" "$TMP/foreign/tags.tsv" || fail "(f) foreign: the tag TSV is not complete"
ls "$TMP/foreign" | grep -q census && fail "(f) foreign: a census file was written"
run "$TMP/fewforeign/log" -in "$IN" -out "$TMP/fewforeign/tags.tsv" -census -census_ids "$TMP/fewforeign.idXML" ${ARGS[@]+"${ARGS[@]}"}
grep -q "match no spectrum" "$TMP/fewforeign/log" || fail "(f) no warning for 1-50% foreign references"
check_join "$TMP/fewforeign" "$TMP/fewforeign.want"
[ "$(val "$TMP/fewforeign/tags.census_summary.tsv" census_ids refs_unmatched)" -gt 0 ] || fail "(f) refs_unmatched"
grep -q "match no spectrum" "$TMP/good/log" && fail "(f) good: unmatched warning without foreign references"

# ---- (g) -census_ids_fdr ------------------------------------------------------------
mkdir -p "$TMP/fdr"
run "$TMP/fdr/log" -in "$IN" -out "$TMP/fdr/tags.tsv" -census -census_ids "$TMP/good.idXML" -census_ids_fdr 0.03 ${ARGS[@]+"${ARGS[@]}"}
# the q = 0.02 targets (MS2 ordinal k % 6 == 1) are identified at 0.03
want1=$(awk -F'\t' '$2 == "1"' "$TMP/good.want" | wc -l)
plus=$(awk 'NR % 6 == 2' "$TMP/good.want" | wc -l)
[ "$(val "$TMP/fdr/tags.census_summary.tsv" census_ids identified_1)" = $((want1 + plus)) ] || fail "(g) -census_ids_fdr 0.03"
[ "$(val "$TMP/fdr/tags.census_summary.tsv" census_ids ids_fdr)" = 0.03 ] || fail "(g) ids_fdr row"
mkdir -p "$TMP/tri"
run "$TMP/tri/log" -in "$IN" -out "$TMP/tri/tags.tsv" -census -census_ids "$TMP/good.idXML" -census_triage_evalue 1e-9 ${ARGS[@]+"${ARGS[@]}"}
check_join "$TMP/tri" "$TMP/good.want" 1e-9

# ---- (h) subsampling: unmatched unknown, nothing refused -------------------------------
mkdir -p "$TMP/sub"
run "$TMP/sub/log" -in "$IN" -out "$TMP/sub/tags.tsv" -census -census_ids "$TMP/foreign.idXML" -subsample_spectra 40 \
  -subsample_seed 3 ${ARGS[@]+"${ARGS[@]}"}
[ -z "$(val "$TMP/sub/tags.census_summary.tsv" census_ids refs_unmatched)" ] || fail "(h) refs_unmatched under subsampling"
[ "$(rows "$TMP/sub/tags.census.tsv")" -lt 139 ] || fail "(h) not subsampled"

# ---- (i) orphans -----------------------------------------------------------------------
mkdir -p "$TMP/orph"
run "$TMP/orph/log" -in "$IN" -out "$TMP/orph/tags.tsv" -census_ids "$TMP/good.idXML" ${ARGS[@]+"${ARGS[@]}"}
grep -q -- "-census_ids is only read for -census" "$TMP/orph/log" || fail "(i) no warning for -census_ids without -census"
[ "$(ls "$TMP/orph")" = "log
tags.tsv" ] || fail "(i) -census_ids without -census wrote $(ls "$TMP/orph" | tr '\n' ' ')"
cmp -s "$TMP/plain/tags.tsv" "$TMP/orph/tags.tsv" || fail "(i) -census_ids without -census changed the tags"
run "$TMP/orph/log2" -in "$IN" -out "$TMP/orph/t2.tsv" -census -census_ids_fdr 0.05 -census_triage_evalue 0.1 ${ARGS[@]+"${ARGS[@]}"}
grep -q -- "-census_ids_fdr is only read for -census_ids" "$TMP/orph/log2" || fail "(i) no warning for -census_ids_fdr alone"
grep -q -- "-census_triage_evalue is only read for -census_ids" "$TMP/orph/log2" || fail "(i) no warning for -census_triage_evalue alone"
cmp -s "$PC" "$TMP/orph/t2.census.tsv" || fail "(i) -census_ids_fdr without -census_ids changed the census"

echo "census_ids_cli_test: all checks passed"
