#!/usr/bin/env bash
# 1.13 item 15: -complement_tolerance_unit auto against the real binary.
#   - -complement_probe is read only under auto: with unit Da it changes
#     nothing (tags equal the defaults)
#   - on real fixture spectra without a confident tag auto falls back to
#     -complement_tolerance (the default, or the value given)
#   - on in-silico spectra with fragment error sd 0.004 Da, auto measures a
#     window near the pair's 95% bound 0.0111 Da and logs it; the auto run's tags
#     equal a Da run at that window given back as -complement_tolerance
#     (the measurement reaches the tags, and nothing else changes)
#   - the measured window differs from 0.02 and the tags differ from the
#     defaults (so the equality above is not the default by accident)
#   - auto is deterministic across -threads
#   - a probe too small to measure (-complement_probe 5) falls back
#   - at 0.5 Da on spectra with fragment error sd 0.1 Da the window is
#     measured within a 0.9 Da window near 0.277 Da
#   - -stream with auto is refused; -stream with -complement_probe is refused
#   - -out_spectra lists complement_tolerance_unit auto in its provenance
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
run hauto "$HI" -complement_tolerance_unit auto
T=$(measured "$TMP/hauto.log")
[ -n "$T" ] || { grep 'Complement tolerance' "$TMP/hauto.log" >&2; fail "auto did not measure a window on $HI"; }
echo "complement_tol_cli_test: measured $T Da on $HI (want ~0.0111)"
awk -v t="$T" 'BEGIN { exit !(t > 0.008 && t < 0.015) }' || fail "measured window $T is not in (0.008, 0.015)"
run hback "$HI" -complement_tolerance "$T" -complement_tolerance_unit Da
cmp -s "$TMP/hauto.tsv" "$TMP/hback.tsv" || fail "auto tags differ from a Da run at the measured window $T"
cmp -s "$TMP/hauto.tsv" "$TMP/hdef.tsv" && fail "auto left the tags at the defaults although it measured $T"
"$BIN" -in "$HI" -out "$TMP/hauto1.tsv" -threads 1 -complement_tolerance_unit auto > "$TMP/hauto1.log" 2>&1 \
  || fail "auto at 1 thread failed"
cmp -s "$TMP/hauto.tsv" "$TMP/hauto1.tsv" || fail "auto differs between -threads 1 and 2"
[ "$(measured "$TMP/hauto1.log")" = "$T" ] || fail "the measured window differs between -threads 1 and 2"
# The precursor hypotheses read the measured window too (hyp_cs).
run hiso "$HI" -complement_tolerance_unit auto -isotope_error 0 1
run hisoback "$HI" -complement_tolerance "$T" -complement_tolerance_unit Da -isotope_error 0 1
cmp -s "$TMP/hiso.tsv" "$TMP/hisoback.tsv" || fail "auto with -isotope_error differs from Da at the measured window"
# A probe too small to measure falls back.
run hsmall "$HI" -complement_tolerance_unit auto -complement_probe 5
grep -q '^Complement tolerance (auto): not measured' "$TMP/hsmall.log" || fail "-complement_probe 5 measured a window"
cmp -s "$TMP/hsmall.tsv" "$TMP/hdef.tsv" || fail "the small-probe fallback is not the default window"

# Low resolution: 0.5 Da on fragment errors of sd 0.1 Da (pair window ~0.277 Da).
run lauto "$LO" -complement_tolerance_unit auto -fragment_tolerance 0.5 -fragment_tolerance_unit Da
TL=$(measured "$TMP/lauto.log")
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
echo "complement_tol_cli_test: PASS"
