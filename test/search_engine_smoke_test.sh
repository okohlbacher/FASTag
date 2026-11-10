#!/usr/bin/env bash
# Engine acceptance smoke test (#5): Sage and Comet run on the configuration
# FASTag writes for Ecoli_MS2_small.mzML against its reduced FASTA.
#   FASTAG_SAGE_BIN   Sage (pinned: 0.14.7)
#   FASTAG_COMET_BIN  Comet (pinned: 2026.03.0); its own `comet -p` file is
#                     the -search_config_template
#   FASTAG_MSFRAGGER_JAR  MSFragger-4.4.1.jar (1.13 #18), run with
#                     FASTAG_JAVA (default java) and -Xmx${FASTAG_MSFRAGGER_XMX:-8g};
#                     FASTag's -fasta_out with its reversed decoys is the database.
#                     Checks: exit 0, target PSMs in the .pin, a prsA/metK/rplF
#                     peptide, and the tolerances, isotope errors, mass offsets and
#                     variable modifications MSFragger echoes ("Parameters:")
#                     equal the exported ones. FASTAG_MSFRAGGER_REQUIRED=1 FAILS
#                     without the jar.
# For each engine that is set: exit 0, at least FASTAG_SMOKE_MIN_PSMS (default
# 1; to be fixed at 80 % of the first recorded run) target PSMs, a peptide of
# prsA/metK/rplF among them, and the exported tolerances echoed by the engine.
# Sage's target PSMs are counted at spectrum_q <= FASTAG_SMOKE_SAGE_Q (default
# 0.05), not at 1 %: the fixture has 139 MS2 spectra against a 3-protein
# database, so Sage 0.14.7 reports about 20 rank-1 targets and the smallest q
# it can reach is 1/21 = 0.048 (first run on node data, 2026-11-08: 21 target
# PSMs at q 0.048, all from prsA/metK/rplF; Sage's own log: "0 target
# peptide-spectrum matches at 1% FDR"). A 1 % cut cannot pass on this fixture
# whatever the configuration.
# Without either engine it SKIPs (77); with FASTAG_ENGINES_REQUIRED=1 (the
# acceptance job on node data) a missing engine FAILS.
set -u
BIN="$1"
FIX="$2"
DATA="$3"
IN="$FIX/Ecoli_MS2_small.mzML"
DB="$FIX/Ecoli_shortlist.fasta"
MIN=${FASTAG_SMOKE_MIN_PSMS:-1}
SAGE_Q=${FASTAG_SMOKE_SAGE_Q:-0.05}
export FASTAG_DIGEST_DIR="$DATA"

fail() { echo "FAIL: $*" >&2; exit 1; }
[ "${FASTAG_MSFRAGGER_REQUIRED:-0}" = 1 ] && [ -z "${FASTAG_MSFRAGGER_JAR:-}" ] \
  && fail "FASTAG_MSFRAGGER_REQUIRED=1 but FASTAG_MSFRAGGER_JAR is not set"
if [ -z "${FASTAG_SAGE_BIN:-}" ] && [ -z "${FASTAG_COMET_BIN:-}" ] && [ -z "${FASTAG_MSFRAGGER_JAR:-}" ]; then
  [ "${FASTAG_ENGINES_REQUIRED:-0}" = 1 ] && fail "FASTAG_ENGINES_REQUIRED=1 but neither FASTAG_SAGE_BIN nor FASTAG_COMET_BIN is set"
  echo "SKIP: no search engine (FASTAG_SAGE_BIN, FASTAG_COMET_BIN, FASTAG_MSFRAGGER_JAR)" >&2
  exit 77
fi
if [ "${FASTAG_ENGINES_REQUIRED:-0}" = 1 ]; then
  [ -n "${FASTAG_SAGE_BIN:-}" ] && [ -n "${FASTAG_COMET_BIN:-}" ] || fail "FASTAG_ENGINES_REQUIRED=1 needs both engines"
fi
"$BIN" --help >/dev/null 2>&1 || { echo "SKIP: binary cannot initialize" >&2; exit 77; }
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-engine-smoke.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
cp "$IN" "$TMP/run.mzML"
ARGS=(-in "$TMP/run.mzML" -recon_fasta "$DB" -tag_length 4 -extension 1 -fragment_tolerance 0.5
      -fragment_tolerance_unit Da -variable_modifications 'Oxidation (M)' -search_precursor_tolerance 3
      -search_precursor_unit Da -threads 2)
KNOWN='VIMSS15329|VIMSS17021|VIMSS17368'

if [ -n "${FASTAG_SAGE_BIN:-}" ]; then
  "$BIN" "${ARGS[@]}" -out "$TMP/s.tsv" -fasta_out "$TMP/s.fasta" -search_config_out "$TMP/sage.json" \
    > "$TMP/s.log" 2>&1 || { cat "$TMP/s.log" >&2; fail "FASTag (sage config)"; }
  ( cd "$TMP" && "$FASTAG_SAGE_BIN" sage.json -o sage_out > sage.log 2>&1 ) || { cat "$TMP/sage.log" >&2; fail "Sage exited non-zero"; }
  R="$TMP/sage_out/results.sage.tsv"
  [ -s "$R" ] || fail "Sage wrote no results.sage.tsv"
  n=$(awk -F'\t' -v maxq="$SAGE_Q" 'NR == 1 { for (i = 1; i <= NF; ++i) { if ($i == "label") l = i; if ($i == "spectrum_q") q = i } next }
                  $l == 1 && $q <= maxq { n++ } END { print n + 0 }' "$R")
  [ "$n" -ge "$MIN" ] || fail "Sage: $n target PSMs at q <= $SAGE_Q, fewer than $MIN"
  grep -Eq "$KNOWN" "$R" || fail "Sage found no prsA/metK/rplF peptide"
  grep -q '"da"' "$TMP/sage_out/results.json" || fail "Sage's results.json does not echo the Da tolerances"
  echo "Sage: $n target PSMs at q <= $SAGE_Q"
fi

if [ -n "${FASTAG_COMET_BIN:-}" ]; then
  ( cd "$TMP" && "$FASTAG_COMET_BIN" -p > cometp.log 2>&1 ) && [ -s "$TMP/comet.params.new" ] || fail "comet -p wrote no comet.params.new"
  "$BIN" "${ARGS[@]}" -out "$TMP/c.tsv" -fasta_out "$TMP/c.fasta" -search_config_out "$TMP/comet.params" \
    -search_engine comet -search_config_template "$TMP/comet.params.new" > "$TMP/c.log" 2>&1 \
    || { cat "$TMP/c.log" >&2; fail "FASTag (comet config)"; }
  # Comet writes <base>.txt next to the input with output_txtfile = 1.
  sed -i.bak 's/^output_txtfile = .*/output_txtfile = 1/' "$TMP/comet.params"
  ( cd "$TMP" && "$FASTAG_COMET_BIN" -Pcomet.params run.mzML > comet.log 2>&1 ) || { cat "$TMP/comet.log" >&2; fail "Comet exited non-zero"; }
  R="$TMP/run.txt"
  [ -s "$R" ] || fail "Comet wrote no run.txt"
  n=$(grep -Ev '^(CometVersion|scan)' "$R" | grep -Ev 'DECOY_' | wc -l | tr -d ' ')
  [ "$n" -ge "$MIN" ] || fail "Comet: $n target rows, fewer than $MIN"
  grep -Eq "$KNOWN" "$R" || fail "Comet found no prsA/metK/rplF peptide"
  echo "Comet: $n target rows"
fi
if [ -n "${FASTAG_MSFRAGGER_JAR:-}" ]; then
  JAVA=${FASTAG_JAVA:-java}
  "$BIN" "${ARGS[@]}" -out "$TMP/f.tsv" -fasta_out "$TMP/f.fasta" -search_config_out "$TMP/fragger.params" \
    -search_engine msfragger -search_isotope_errors 1 > "$TMP/f.log" 2>&1 || { cat "$TMP/f.log" >&2; fail "FASTag (msfragger config)"; }
  ( cd "$TMP" && "$JAVA" -Xmx"${FASTAG_MSFRAGGER_XMX:-8g}" -jar "$FASTAG_MSFRAGGER_JAR" fragger.params run.mzML > fragger.log 2>&1 ) \
    || { tail -30 "$TMP/fragger.log" >&2; fail "MSFragger exited non-zero"; }
  R="$TMP/run.pin"
  [ -s "$R" ] || fail "MSFragger wrote no run.pin"
  n=$(awk -F'\t' 'NR == 1 { for (i = 1; i <= NF; ++i) if ($i == "Label") l = i; next } $l == 1 { n++ } END { print n + 0 }' "$R")
  [ "$n" -ge "$MIN" ] || fail "MSFragger: $n target PSMs, fewer than $MIN"
  grep -Eq "$KNOWN" "$R" || fail "MSFragger found no prsA/metK/rplF peptide"
  # The parameters MSFragger read, against the ones FASTag wrote.
  echoed() { awk -v k="$1" '/^Parameters:/ { p = 1; next } p && $1 == k && $2 == "=" { $1 = ""; $2 = ""; sub(/^ +/, ""); print; exit }' "$TMP/fragger.log"; }
  written() { sed -n "s/^$1 = //p" "$TMP/fragger.params"; }
  for k in precursor_mass_lower precursor_mass_upper precursor_mass_units precursor_true_tolerance precursor_true_units \
           fragment_mass_tolerance fragment_mass_units allowed_missed_cleavage_1; do
    awk -v a="$(echoed $k)" -v b="$(written $k)" 'BEGIN { exit !(a != "" && a + 0 == b + 0) }' \
      || fail "MSFragger read $k = '$(echoed $k)', FASTag wrote '$(written $k)'"
  done
  # num_threads: FASTag's -threads 2, not 0 (every CPU).
  [ "$(written num_threads)" = 2 ] || fail "fragger.params num_threads is not -threads 2"
  for k in isotope_error mass_offsets database_name decoy_prefix variable_mod_01 num_threads; do
    [ "$(echoed $k)" = "$(written $k)" ] || fail "MSFragger read $k = '$(echoed $k)', FASTag wrote '$(written $k)'"
  done
  echo "MSFragger: $n target PSMs"
fi
echo "search_engine_smoke_test: all checks passed"
