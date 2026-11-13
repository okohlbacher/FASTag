#!/usr/bin/env bash
# -species_call (1.12 #1): the calibrated species call on the fixture against a
# toy taxonomy index built at test time with fixed seeds.
#
#   * -species_call none (the default) is byte-identical to the option absent,
#     and with FASTAG_BASELINE_BIN to the 1.11.0 binary;
#   * decoy appends 7 columns: the first 8 are unchanged, every line has 15
#     fields, the tags are unchanged, the output is the same at 1, 3 and 8
#     threads;
#   * at the default -species_call_min_units (200) the run is a few_spectra
#     no_call (the fixture has 139 MS2 spectra);
#   * with a low unit floor Escherichia is present, the mutated relative is a
#     near_neighbour no_call or not_detected, the unrelated genera are never
#     present;
#   * a Da tolerance is a low_resolution no_call;
#   * 1.14: -species_call explain and -species_reagents (removed) are accepted
#     with one warning each and change no output;
#   * the ignored-option warnings and the refusals.
#
# The toy index: Escherichia coli (562) = the 3 fixture proteins plus 500
# random proteins; Salmonella enterica (28901) = that proteome with 5% of the
# residues mutated (a near relative sharing ~70% of its 7-mers); Staphylococcus
# aureus (1280) and Saccharomyces cerevisiae (4932) = 2000 and 6000 random
# proteins (unrelated genera that collect only chance hits). Random proteins
# come from a Park-Miller generator in awk, exact in double arithmetic on every
# awk, so the index is the same everywhere.
#
# The fixture is ion trap; the call treats a Da tolerance as low resolution, so
# the positive cases read it with a wide ppm tolerance instead.
# Exits 77 (ctest SKIP) when the binary cannot start.
set -u
BIN="$1"
BUILDTAXDB="$2"
IN="$3"       # test/fixtures/Ecoli_MS2_small.mzML
DB="$4"       # test/fixtures/Ecoli_MS2_small.fasta
TAXDIR="$5"   # data/taxonomy (nodes.dmp, names.dmp, species_call.tsv)

if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-species-call-test.XXXXXX") || exit 1
[ "${FASTAG_TEST_KEEP:-0}" = 1 ] && echo "work directory kept: $TMP" || trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

# ---- toy index -----------------------------------------------------------
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
"$BUILDTAXDB" "$TMP/prot" "$TMP/toy.taxdb" 7 > "$TMP/buildtaxdb.log" 2>&1 \
  || { cat "$TMP/buildtaxdb.log" >&2; fail "buildtaxdb"; }

TAX=(-taxdb "$TMP/toy.taxdb" -taxonomy_nodes "$TAXDIR/nodes.dmp" -taxonomy_names "$TAXDIR/names.dmp")
# Wide ppm tolerance and every tag reported, so enough spectra carry evidence
# and the random genera collect chance hits the decoys must explain.
COMMON=(-in "$IN" -tag_length 7 -extension 1 -fragment_tolerance 600 -fragment_tolerance_unit ppm
        -max_evalue 0 -max_tags 200)
export FASTAG_TAXONOMY_DIR="$TAXDIR"

run() {  # name args...
  local n=$1; shift
  "$BIN" -out "$TMP/$n.tsv" "$@" < /dev/null > "$TMP/$n.log" 2>&1
}
fields() { awk -F'\t' '{ print NF }' "$1" | sort -u | tr '\n' ' ' | sed 's/ $//'; }
col() {  # file taxid column-name -> value
  awk -F'\t' -v t="$2" -v c="$3" 'NR == 1 { for (i = 1; i <= NF; ++i) if ($i == c) k = i; next }
                                  $2 == t { print $k }' "$1"
}

# ---- none: byte-identical --------------------------------------------------
run absent "${COMMON[@]}" -species "${TAX[@]}" -threads 2 || { cat "$TMP/absent.log" >&2; fail "run without -species_call"; }
run none "${COMMON[@]}" -species "${TAX[@]}" -species_call none -threads 2 || { cat "$TMP/none.log" >&2; fail "-species_call none"; }
[ -s "$TMP/absent.species.tsv" ] || fail "no species report"
[ "$(wc -l < "$TMP/absent.species.tsv")" -ge 3 ] || fail "the toy run reports fewer than 2 genera (test is vacuous)"
cmp -s "$TMP/absent.species.tsv" "$TMP/none.species.tsv" || fail "-species_call none changed the species report"
cmp -s "$TMP/absent.tsv" "$TMP/none.tsv" || fail "-species_call none changed the tags"
[ "$(fields "$TMP/absent.species.tsv")" = 8 ] || fail "the legacy report does not have 8 fields"
if [ -n "${FASTAG_BASELINE_BIN:-}" ] && [ -x "${FASTAG_BASELINE_BIN}" ]; then
  "$FASTAG_BASELINE_BIN" -out "$TMP/base.tsv" "${COMMON[@]}" -species "${TAX[@]}" -threads 2 > "$TMP/base.log" 2>&1 \
    || { cat "$TMP/base.log" >&2; fail "baseline run"; }
  cmp -s "$TMP/base.species.tsv" "$TMP/none.species.tsv" || fail "species report differs from $FASTAG_BASELINE_BIN"
  cmp -s "$TMP/base.tsv" "$TMP/none.tsv" || fail "tags differ from $FASTAG_BASELINE_BIN"
  echo "species_call_test: -species_call none equals $FASTAG_BASELINE_BIN"
fi

# ---- decoy at the default unit floor: few_spectra -------------------------
run dflt "${COMMON[@]}" -species "${TAX[@]}" -species_call decoy -threads 2 || { cat "$TMP/dflt.log" >&2; fail "-species_call decoy"; }
cmp -s "$TMP/absent.tsv" "$TMP/dflt.tsv" || fail "-species_call decoy changed the tags"
[ "$(fields "$TMP/dflt.species.tsv")" = 15 ] || fail "decoy report: not 15 fields on every line ($(fields "$TMP/dflt.species.tsv"))"
tr -d '\r' < "$TMP/dflt.species.tsv" | cut -f1-8 > "$TMP/dflt.first8"
tr -d '\r' < "$TMP/absent.species.tsv" | cmp -s - "$TMP/dflt.first8" || fail "decoy report: the first 8 columns differ from the legacy report"
[ "$(head -1 "$TMP/dflt.species.tsv" | cut -f9-)" = "$(printf 'call\tcall_reason\tdecoy_spectra\tdecoy_expected\tdecoy_qvalue\tshare\tlod')" ] \
  || fail "decoy report: unexpected appended header: $(head -1 "$TMP/dflt.species.tsv" | cut -f9-)"
bad=$(awk -F'\t' 'NR > 1 && !($9 == "no_call" && $10 == "few_spectra")' "$TMP/dflt.species.tsv" | wc -l | tr -d ' ')
[ "$bad" = 0 ] || fail "139 spectra at -species_call_min_units 200: $bad rows are not a few_spectra no_call"
grep -q "species_call" "$TMP/dflt.log" || fail "no species_call line in the log"

# ---- decoy with a low floor: the calls ---------------------------------------
printf 'version\ttest\nalpha\t0.05\ntau\t0\nn_min\t5\n' > "$TMP/params.tsv"
CALL=(-species_call decoy -species_call_min_units 10 -species_call_params "$TMP/params.tsv")
for t in 1 3 8; do
  run call_t$t "${COMMON[@]}" -species "${TAX[@]}" "${CALL[@]}" -threads $t || { cat "$TMP/call_t$t.log" >&2; fail "decoy, -threads $t"; }
done
S="$TMP/call_t1.species.tsv"
cmp -s "$S" "$TMP/call_t3.species.tsv" && cmp -s "$S" "$TMP/call_t8.species.tsv" || fail "decoy report differs between 1, 3 and 8 threads"
[ "$(fields "$S")" = 15 ] || fail "decoy report (low floor): not 15 fields on every line"
tr -d '\r' < "$S" | cut -f1-8 | cmp -s <(tr -d '\r' < "$TMP/absent.species.tsv") - || fail "decoy report (low floor): first 8 columns differ"
[ "$(col "$S" 561 call)" = present ] || { cat "$S" >&2; fail "Escherichia is not present"; }
c590="$(col "$S" 590 call)/$(col "$S" 590 call_reason)"
case "$c590" in
  no_call/near_neighbour|not_detected/*|/) ;;
  *) cat "$S" >&2; fail "the mutated relative (Salmonella) is $c590" ;;
esac
for g in 4930 1279; do
  c=$(col "$S" $g call)
  [ -z "$c" ] || [ "$c" = not_detected ] || { cat "$S" >&2; fail "unrelated genus $g is '$c'"; }
done
[ -n "$(col "$S" 4930 call)$(col "$S" 590 call)" ] || fail "neither the relative nor an unrelated genus has a row (test is vacuous)"
np=$(awk -F'\t' 'NR > 1 && $9 == "present"' "$S" | wc -l | tr -d ' ')
[ "$np" = 1 ] || { cat "$S" >&2; fail "$np genera present, expected only Escherichia"; }
awk -F'\t' 'NR > 1 && $9 == "not_detected" && !($15 + 0 > 0) { exit 1 }' "$S" \
  || fail "a not_detected row has no positive detection limit"
awk -F'\t' 'NR > 1 && $9 != "not_detected" && $15 != "NA" { exit 1 }' "$S" || fail "lod is set on a row that is not not_detected"
awk -F'\t' 'NR > 1 && ($12 + 0 < 0 || $13 + 0 < 0 || $13 + 0 > 1) { exit 1 }' "$S" || fail "decoy_expected or decoy_qvalue out of range"

# Fewer decoy replicates: a valid report, the decoy counts may change.
run d2 "${COMMON[@]}" -species "${TAX[@]}" "${CALL[@]}" -species_call_decoys 2 -threads 2 \
  || { cat "$TMP/d2.log" >&2; fail "-species_call_decoys 2"; }
[ "$(fields "$TMP/d2.species.tsv")" = 15 ] || fail "-species_call_decoys 2: not 15 fields"
# pi0 estimated: a valid report.
run pi0 "${COMMON[@]}" -species "${TAX[@]}" "${CALL[@]}" -species_pi0 0 -threads 2 \
  || { cat "$TMP/pi0.log" >&2; fail "-species_pi0 0"; }
[ "$(fields "$TMP/pi0.species.tsv")" = 15 ] || fail "-species_pi0 0: not 15 fields"
# -species_deconvolve: the share column follows the deconvolved count; still valid.
run dec "${COMMON[@]}" -species "${TAX[@]}" "${CALL[@]}" -species_deconvolve -threads 2 \
  || { cat "$TMP/dec.log" >&2; fail "-species_deconvolve"; }
[ "$(col "$TMP/dec.species.tsv" 561 call)" = present ] || fail "Escherichia not present under -species_deconvolve"

# ---- 1.14: -species_call explain and -species_reagents removed ------------------
# explain failed its held-out test and is read as the default (none);
# -species_reagents was read only by explain. Each is accepted with exactly one
# warning and changes no output; the reagent file is never opened.
EX_WARN='-species_call explain was removed in 1.14 (failed its held-out test); it has no effect: -species_call none is used.'
RG_WARN='-species_reagents was removed in 1.14 (read only by -species_call explain, which failed its held-out test); it has no effect.'
run expl "${COMMON[@]}" -species "${TAX[@]}" -species_call explain -threads 2 || { cat "$TMP/expl.log" >&2; fail "-species_call explain"; }
[ "$(grep -cF -- "$EX_WARN" "$TMP/expl.log")" -eq 1 ] || { cat "$TMP/expl.log" >&2; fail "-species_call explain: not exactly one removal warning"; }
cmp -s "$TMP/absent.species.tsv" "$TMP/expl.species.tsv" || fail "-species_call explain: species report differs from the default"
cmp -s "$TMP/absent.tsv" "$TMP/expl.tsv" || fail "-species_call explain: tags differ from the default"
grep -q "Species call (" "$TMP/expl.log" && fail "-species_call explain still runs a species call"
awk '/^>/ { print $1 " OX=562" ; next } { print }' "$DB" > "$TMP/reagents.fasta"
run reag "${COMMON[@]}" -species "${TAX[@]}" "${CALL[@]}" -species_reagents "$TMP/reagents.fasta" -threads 1 \
  || { cat "$TMP/reag.log" >&2; fail "-species_reagents"; }
[ "$(grep -cF -- "$RG_WARN" "$TMP/reag.log")" -eq 1 ] || { cat "$TMP/reag.log" >&2; fail "-species_reagents: not exactly one removal warning"; }
grep -q -- "-species_reagents is only read" "$TMP/reag.log" && fail "-species_reagents still has an ignored-option warning"
cmp -s "$TMP/call_t1.species.tsv" "$TMP/reag.species.tsv" || fail "-species_reagents: species report differs from without it"
cmp -s "$TMP/call_t1.tsv" "$TMP/reag.tsv" || fail "-species_reagents: tags differ from without it"
# A path that does not exist is never opened: no error.
run reag_nx "${COMMON[@]}" -species "${TAX[@]}" "${CALL[@]}" -species_reagents "$TMP/no_such_reagents.fasta" -threads 1 \
  || { cat "$TMP/reag_nx.log" >&2; fail "-species_reagents with a nonexistent path is refused"; }
[ "$(grep -cF -- "$RG_WARN" "$TMP/reag_nx.log")" -eq 1 ] || fail "-species_reagents (nonexistent): not exactly one removal warning"
cmp -s "$TMP/call_t1.species.tsv" "$TMP/reag_nx.species.tsv" || fail "-species_reagents (nonexistent): species report differs"
# reagent_n_min in a parameter file still loads (ignored).
printf 'version\ttest\nalpha\t0.05\ntau\t0\nn_min\t5\nreagent_n_min\t3\n' > "$TMP/params_r.tsv"
run reag_p "${COMMON[@]}" -species "${TAX[@]}" -species_call decoy -species_call_min_units 10 -species_call_params "$TMP/params_r.tsv" -threads 1 \
  || { cat "$TMP/reag_p.log" >&2; fail "a parameter file with reagent_n_min is refused"; }
cmp -s "$TMP/call_t1.species.tsv" "$TMP/reag_p.species.tsv" || fail "reagent_n_min in the parameter file changed the report"
# -stream refuses neither.
"$BIN" -in "$IN" -out "$TMP/st_expl.tsv" -stream -species_call explain -species_reagents "$TMP/no_such_reagents.fasta" \
  > "$TMP/st_expl.log" 2>&1 < /dev/null || { cat "$TMP/st_expl.log" >&2; fail "-stream refuses the removed -species_call explain / -species_reagents"; }

# ---- negatives -----------------------------------------------------------------
# Ion-trap tolerance in Da: low_resolution for every row.
run da -in "$IN" -tag_length 7 -fragment_tolerance 0.5 -fragment_tolerance_unit Da -species "${TAX[@]}" "${CALL[@]}" -threads 2 \
  || { cat "$TMP/da.log" >&2; fail "Da run"; }
[ "$(wc -l < "$TMP/da.species.tsv")" -ge 2 ] || fail "the Da run reports no genus (test is vacuous)"
bad=$(awk -F'\t' 'NR > 1 && !($9 == "no_call" && $10 == "low_resolution")' "$TMP/da.species.tsv" | wc -l | tr -d ' ')
[ "$bad" = 0 ] || fail "Da run: $bad rows are not a low_resolution no_call"

# ---- warnings ------------------------------------------------------------------
run warn1 "${COMMON[@]}" -species_call decoy -threads 2 || { cat "$TMP/warn1.log" >&2; fail "-species_call without -species"; }
grep -q -- "-species_call is only read for -species" "$TMP/warn1.log" || { cat "$TMP/warn1.log" >&2; fail "no warning for -species_call without -species"; }
[ ! -e "$TMP/warn1.species.tsv" ] || fail "a species report was written without -species"
run warn2 "${COMMON[@]}" -species "${TAX[@]}" -species_call_min_units 5 -species_call_decoys 3 -threads 2 \
  || { cat "$TMP/warn2.log" >&2; fail "-species_call_min_units without decoy"; }
grep -q -- "-species_call_min_units is only read for -species_call decoy" "$TMP/warn2.log" || fail "no warning for -species_call_min_units"
grep -q -- "-species_call_decoys is only read for -species_call decoy" "$TMP/warn2.log" || fail "no warning for -species_call_decoys"
cmp -s "$TMP/absent.species.tsv" "$TMP/warn2.species.tsv" || fail "ignored -species_call_* options changed the report"
printf 'alpha\t0.05\ntau\t0\nn_min\t5\ndecoys\t3\n' > "$TMP/params_d3.tsv"
run warn3 "${COMMON[@]}" -species "${TAX[@]}" -species_call decoy -species_call_params "$TMP/params_d3.tsv" -threads 2 \
  || { cat "$TMP/warn3.log" >&2; fail "params with decoys 3"; }
grep -q "specify 3 decoy" "$TMP/warn3.log" || { cat "$TMP/warn3.log" >&2; fail "no warning when -species_call_decoys differs from the parameter file"; }

# ---- refusals ------------------------------------------------------------------
refused() {  # name pattern args...
  local n=$1 pat=$2; shift 2
  if run "$n" "$@"; then cat "$TMP/$n.log" >&2; fail "$n: not refused"; fi
  grep -q -- "$pat" "$TMP/$n.log" || { cat "$TMP/$n.log" >&2; fail "$n: refusal does not say '$pat'"; }
  [ ! -e "$TMP/$n.species.tsv" ] || fail "$n: a species report was written"
}
refused stream "-stream cannot be combined with -species_call" -stream -species_call decoy -threads 2
refused noparams "no_such_params.tsv" "${COMMON[@]}" -species "${TAX[@]}" -species_call decoy -species_call_params "$TMP/no_such_params.tsv" -threads 2
printf 'alpha\t0.05\ntau\t0\nn_min\t5\nalhpa\t1\n' > "$TMP/badkey.tsv"
refused badkey "alhpa" "${COMMON[@]}" -species "${TAX[@]}" -species_call decoy -species_call_params "$TMP/badkey.tsv" -threads 2
mkdir -p "$TMP/taxdir_noparams"; cp "$TAXDIR/nodes.dmp" "$TAXDIR/names.dmp" "$TMP/taxdir_noparams/"
FASTAG_TAXONOMY_DIR="$TMP/taxdir_noparams" refused noshipped "species_call.tsv" "${COMMON[@]}" -species "${TAX[@]}" -species_call decoy -threads 2
refused zerodecoys "species_call_decoys" "${COMMON[@]}" -species "${TAX[@]}" -species_call decoy -species_call_decoys 0 -threads 2
refused badpi0 "species_pi0" "${COMMON[@]}" -species "${TAX[@]}" -species_call decoy -species_pi0 1.5 -threads 2
refused badmode "species_call" "${COMMON[@]}" -species "${TAX[@]}" -species_call target -threads 2

echo "species_call_test: passed"
