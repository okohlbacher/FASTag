#!/usr/bin/env bash
# 1.13 item 15: -complement_tolerance_unit auto against the real binary.
#   - -complement_probe is read only under auto: with unit Da it changes
#     nothing (tags equal the defaults)
#   - on real fixture spectra without a confident tag auto falls back to
#     -complement_tolerance (the default, or the value given)
#   - on in-silico spectra with fragment error sd 0.004 Da, auto measures a
#     window near the pair's 95% bound 0.0111 Da and logs it; at the default
#     -complement_tolerance 0.02 (the lower bound) the window in force is 0.02
#     and the tags are the defaults'; with -complement_tolerance 0.005 the
#     measured window is in force and the auto run's tags equal a Da run at
#     that window given back as -complement_tolerance (the measurement reaches
#     the tags, and nothing else changes)
#   - the measured window differs from 0.02 and the tags differ from the
#     defaults (so the equality above is not the default by accident)
#   - auto is deterministic across -threads
#   - a probe too small to measure (-complement_probe 5) falls back
#   - at 0.5 Da on spectra with fragment error sd 0.1 Da the window is
#     measured within a 0.9 Da window near 0.277 Da
#   - -stream with auto is refused; -stream with -complement_probe is refused
#   - -out_spectra lists complement_tolerance_unit auto in its provenance
#   - the window in force is persisted: -out_spectra carries
#     "complement_tolerance (auto)" (and its source) at full precision, equal
#     to the logged value, and a Da run at the value read back from the file
#     reproduces the tags; the census summary (a Versioned run report) carries
#     run/complement_tolerance (format 6) with the same value; without auto
#     neither the mzML userParam nor the rows appear (format 5)
#   - the probe is cell-independent: -tag_length 4, -no_deisotope and -gaps 0
#     measure exactly the window of the default run
# Exits 77 (ctest SKIP) when the binary cannot start.
set -u
BIN="$1"
FIX="$2"
IN="$FIX/Ecoli_MS2_small.mzML"   # real spectra: no confident tag, so auto falls back
HI="$FIX/compltol_hires.mgf"     # fragment error sd 0.004 Da: pair 95% window 0.0111 Da
LO="$FIX/compltol_lowres.mgf"    # fragment error sd 0.1 Da: pair 95% window 0.277 Da

if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-compltol-cli.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
# run <name> <input> <options...>
run() { local name=$1 in=$2; shift 2; "$BIN" -in "$in" -out "$TMP/$name.tsv" -threads 2 "$@" >"$TMP/$name.log" 2>&1 \
          || { cat "$TMP/$name.log" >&2; fail "run $name failed"; }; }
measured() { sed -n 's/^Complement tolerance (auto): measured \([0-9.e-]*\) Da.*/\1/p' "$1"; }
inforce() { sed -n 's/^Complement tolerance (auto): measured [0-9.e-]* Da, in force \([0-9.e-]*\) Da.*/\1/p' "$1"; }
LB="-complement_tolerance 0.005"   # a lower bound below the hires window, so the measurement is in force

run def "$IN"
[ "$(wc -l < "$TMP/def.tsv")" -gt 10 ] || fail "too few tags at defaults; the comparisons would prove nothing"
grep -q 'Complement tolerance (auto)' "$TMP/def.log" && fail "the auto line is logged without auto"
run probe_da "$IN" -complement_probe 3
cmp -s "$TMP/def.tsv" "$TMP/probe_da.tsv" || fail "-complement_probe changed the tags under unit Da"

# Fallback: the real fixture has no tag at E <= 0.01, so nothing is measured.
run fb "$IN" -complement_tolerance_unit auto
grep -q '^Complement tolerance (auto): not measured, using -complement_tolerance 0.02 Da' "$TMP/fb.log" \
  || { grep 'Complement tolerance' "$TMP/fb.log" >&2; fail "auto did not fall back on $IN"; }
cmp -s "$TMP/fb.tsv" "$TMP/def.tsv" || fail "the fallback is not the default window"
run fb05 "$IN" -complement_tolerance_unit auto -complement_tolerance 0.05
run da05 "$IN" -complement_tolerance 0.05
cmp -s "$TMP/fb05.tsv" "$TMP/da05.tsv" || fail "the fallback is not -complement_tolerance"
cmp -s "$TMP/fb05.tsv" "$TMP/def.tsv" && fail "-complement_tolerance 0.05 changed nothing; the fallback check proves nothing"

# Measured: 20 ppm on fragment errors of sd 0.004 Da (pair window ~0.0111 Da).
run hdef "$HI"
# At the default lower bound 0.02 the narrower measured window is not in force.
run hlb "$HI" -complement_tolerance_unit auto
[ -n "$(measured "$TMP/hlb.log")" ] || { grep 'Complement tolerance' "$TMP/hlb.log" >&2; fail "auto did not measure on $HI"; }
[ "$(inforce "$TMP/hlb.log")" = "0.02" ] || { grep 'Complement tolerance' "$TMP/hlb.log" >&2; fail "the window in force is not the lower bound 0.02"; }
grep -q 'in force 0.02 Da (not below -complement_tolerance)' "$TMP/hlb.log" || fail "the lower bound is not logged as such"
cmp -s "$TMP/hlb.tsv" "$TMP/hdef.tsv" || fail "auto at the lower bound 0.02 differs from the defaults"
# shellcheck disable=SC2086
run hauto "$HI" -complement_tolerance_unit auto $LB
T=$(measured "$TMP/hauto.log")
[ -n "$T" ] || { grep 'Complement tolerance' "$TMP/hauto.log" >&2; fail "auto did not measure a window on $HI"; }
echo "complement_tol_cli_test: measured $T Da on $HI (want ~0.0111)"
awk -v t="$T" 'BEGIN { exit !(t > 0.008 && t < 0.015) }' || fail "measured window $T is not in (0.008, 0.015)"
[ "$(inforce "$TMP/hauto.log")" = "$T" ] || fail "with lower bound 0.005 the measured $T is not in force"
[ "$(measured "$TMP/hlb.log")" = "$T" ] || fail "the lower bound changed the measurement"
run hback "$HI" -complement_tolerance "$T" -complement_tolerance_unit Da
cmp -s "$TMP/hauto.tsv" "$TMP/hback.tsv" || fail "auto tags differ from a Da run at the measured window $T"
cmp -s "$TMP/hauto.tsv" "$TMP/hdef.tsv" && fail "auto left the tags at the defaults although it measured $T"
"$BIN" -in "$HI" -out "$TMP/hauto1.tsv" -threads 1 -complement_tolerance_unit auto $LB > "$TMP/hauto1.log" 2>&1 \
  || fail "auto at 1 thread failed"
cmp -s "$TMP/hauto.tsv" "$TMP/hauto1.tsv" || fail "auto differs between -threads 1 and 2"
[ "$(measured "$TMP/hauto1.log")" = "$T" ] || fail "the measured window differs between -threads 1 and 2"
# The precursor hypotheses read the measured window too (hyp_cs).
# shellcheck disable=SC2086
run hiso "$HI" -complement_tolerance_unit auto $LB -isotope_error 0 1
run hisoback "$HI" -complement_tolerance "$T" -complement_tolerance_unit Da -isotope_error 0 1
cmp -s "$TMP/hiso.tsv" "$TMP/hisoback.tsv" || fail "auto with -isotope_error differs from Da at the measured window"
# A probe too small to measure falls back.
run hsmall "$HI" -complement_tolerance_unit auto -complement_probe 5
grep -q '^Complement tolerance (auto): not measured' "$TMP/hsmall.log" || fail "-complement_probe 5 measured a window"
cmp -s "$TMP/hsmall.tsv" "$TMP/hdef.tsv" || fail "the small-probe fallback is not the default window"

# Low resolution: 0.5 Da on fragment errors of sd 0.1 Da (pair window ~0.277 Da).
run lauto "$LO" -complement_tolerance_unit auto -fragment_tolerance 0.5 -fragment_tolerance_unit Da
TL=$(measured "$TMP/lauto.log")
[ "$(inforce "$TMP/lauto.log")" = "$TL" ] || fail "0.5 Da: the measured window $TL is not in force"
grep -q 'pairs within 0.9 Da' "$TMP/lauto.log" || fail "0.5 Da: the measurement window is not 0.9 Da"
[ -n "$TL" ] || { grep 'Complement tolerance' "$TMP/lauto.log" >&2; fail "auto did not measure a window on $LO"; }
echo "complement_tol_cli_test: measured $TL Da on $LO (want ~0.277)"
awk -v t="$TL" 'BEGIN { exit !(t > 0.15 && t < 0.36) }' || fail "low-resolution window $TL is not in (0.15, 0.36)"

"$BIN" -stream -complement_tolerance_unit auto < /dev/null > "$TMP/s1.out" 2> "$TMP/s1.err" \
  && fail "-stream accepted -complement_tolerance_unit auto"
grep -q 'complement_tolerance_unit auto' "$TMP/s1.err" || { cat "$TMP/s1.err" >&2; fail "-stream refusal does not name auto"; }
"$BIN" -stream -complement_probe 5 < /dev/null > "$TMP/s2.out" 2> "$TMP/s2.err" \
  && fail "-stream accepted -complement_probe"
"$BIN" -stream -complement_tolerance_unit fragment < /dev/null > "$TMP/s3.out" 2> "$TMP/s3.err" \
  || { cat "$TMP/s3.err" >&2; fail "-stream refused -complement_tolerance_unit fragment"; }

"$BIN" -in "$IN" -out "$TMP/o.tsv" -out_spectra "$TMP/o.mzML" -threads 2 -complement_tolerance_unit auto \
  > "$TMP/o.log" 2>&1 || { cat "$TMP/o.log" >&2; fail "auto with -out_spectra failed"; }
grep -Eq 'name="parameter: complement_tolerance_unit"[^>]*value="auto"' "$TMP/o.mzML" \
  || { grep -o 'parameter: complement[^/]*' "$TMP/o.mzML" | head -3 >&2; fail "-out_spectra does not list unit auto"; }
# The window is persisted in -out_spectra and in the Versioned run reports.
# shellcheck disable=SC2086
run hspec "$HI" -complement_tolerance_unit auto $LB -out_spectra "$TMP/hspec.mzML" -census
TS=$(sed -n 's/.*name="complement_tolerance (auto)"[^>]*value="\([^"]*\)".*/\1/p' "$TMP/hspec.mzML" | head -1)
[ -n "$TS" ] || { grep -o 'complement_tolerance[^/]*' "$TMP/hspec.mzML" | head -5 >&2; fail "-out_spectra does not record the window in force"; }
[ "$TS" = "$(inforce "$TMP/hspec.log")" ] || fail "-out_spectra records $TS, the log $(inforce "$TMP/hspec.log")"
grep -Eq "name=\"complement_tolerance \\(auto\\) measured\"[^>]*value=\"$T\"" "$TMP/hspec.mzML" \
  || fail "-out_spectra does not record the measured window $T"
[ "$TS" = "$T" ] || fail "-out_spectra/-census changed the measured window ($TS vs $T)"
grep -Eq 'name="complement_tolerance \(auto\) source"[^>]*value="measured"' "$TMP/hspec.mzML" \
  || fail "-out_spectra does not record the source (measured)"
run hspecback "$HI" -complement_tolerance "$TS" -complement_tolerance_unit Da
cmp -s "$TMP/hspec.tsv" "$TMP/hspecback.tsv" || fail "a Da run at the window read from -out_spectra ($TS) differs"
CS="$TMP/hspec.census_summary.tsv"
[ -f "$CS" ] || fail "no census summary at $CS"
awk -F'\t' -v t="$TS" '$1=="run" && $2=="complement_tolerance" { f=1; if ($3!=t) exit 1 } END { exit !f }' "$CS" \
  || { grep complement "$CS" >&2; fail "census summary run/complement_tolerance is not $TS"; }
awk -F'\t' '$1=="run" && $2=="run_report_version" { f=1; if ($3!="6") exit 1 } END { exit !f }' "$CS" \
  || fail "census summary under auto is not run report format 6"
awk -F'\t' '$1=="run" && $2=="complement_tolerance_source" { f=1; if ($3!="measured") exit 1 } END { exit !f }' "$CS" \
  || fail "census summary does not record the source (measured)"
run hspecda "$HI" -out_spectra "$TMP/hspecda.mzML" -census
grep -q 'complement_tolerance (auto)' "$TMP/hspecda.mzML" && fail "-out_spectra records an auto window without auto"
grep -q 'complement_' "$TMP/hspecda.census_summary.tsv" && fail "census summary carries complement rows without auto"
awk -F'\t' '$1=="run" && $2=="run_report_version" { f=1; if ($3!="5") exit 1 } END { exit !f }' \
  "$TMP/hspecda.census_summary.tsv" || fail "census summary without auto is not run report format 5"
# The lower bound is recorded as such (the measured value next to it).
run hlbs "$HI" -complement_tolerance_unit auto -out_spectra "$TMP/hlbs.mzML" -census
grep -Eq 'name="complement_tolerance \(auto\) source"[^>]*value="lower_bound"' "$TMP/hlbs.mzML" \
  || fail "-out_spectra does not record the lower bound"
awk -F'\t' '$1=="run" && $2=="complement_tolerance" { f=1; if ($3!="0.02") exit 1 } END { exit !f }' \
  "$TMP/hlbs.census_summary.tsv" || fail "census summary at the lower bound is not 0.02"
awk -F'\t' -v t="$T" '$1=="run" && $2=="complement_tolerance_measured" { f=1; if ($3!=t) exit 1 } END { exit !f }' \
  "$TMP/hlbs.census_summary.tsv" || fail "census summary does not record the measured window $T"
# The fallback is recorded as such.
"$BIN" -in "$IN" -out "$TMP/fbs.tsv" -out_spectra "$TMP/fbs.mzML" -threads 2 -complement_tolerance_unit auto \
  > "$TMP/fbs.log" 2>&1 || { cat "$TMP/fbs.log" >&2; fail "fallback with -out_spectra failed"; }
grep -Eq 'name="complement_tolerance \(auto\) source"[^>]*value="fallback"' "$TMP/fbs.mzML" \
  || fail "-out_spectra does not record the fallback"
grep -Eq 'name="complement_tolerance \(auto\)"[^>]*value="0.02"' "$TMP/fbs.mzML" \
  || fail "-out_spectra does not record the fallback window 0.02"

# One file, one window: the probe ignores the run's search settings.
for opt in "-tag_length 4" "-no_deisotope" "-gaps 0"; do
  # shellcheck disable=SC2086
  run hcell "$HI" -complement_tolerance_unit auto $LB $opt
  [ "$(measured "$TMP/hcell.log")" = "$T" ] \
    || fail "auto with $opt measured $(measured "$TMP/hcell.log"), the default run $T"
done
echo "complement_tol_cli_test: PASS"
