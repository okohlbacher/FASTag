#!/usr/bin/env bash
# Raw-DIA refusal (1.12 item #7) against the real binary.
#
#   acquisition_cli_test.sh <FASTag> <acquisition_test> <fixture dir> <fasta> <digest dir>
#
# - raw DIA exits 11 before any output is opened: a sentinel file at every
#   output path survives byte for byte and nothing else is written; stderr
#   names DIAspeXtract and carries one FASTAG_REFUSED line. On the fast mzML
#   reader, on OnDisc (-out_spectra), on MGF and on mzPeak, at 1/3/8 threads.
# - -acquisition_check warn tags raw DIA as FASTag 1.11.0 did (stored digest),
#   -acquisition_check off skips the probe.
# - pseudo-DDA (DIAspeXtract- and diaTracer-shaped), ddaPASEF, PRM, wide-window
#   DDA and the OpenMS example pass with tags byte-identical to off.
# - -stream is not checked; -acquisition_probe_spectra acts and is reported
#   as ignored under off; a bad mode is refused.
# Fixtures: test/fixtures/make_acquisition_fixtures.py (see fixtures/README.md).
# Exits 77 (ctest SKIP) when the binary cannot start.
set -u
BIN="$1"
ACQ="$2"
FIX="$3"
FASTA="$4"
DIGEST="$5"

if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi
export FASTAG_DIGEST_DIR="$DIGEST"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-acq-test.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
failures=0
fail() { echo "FAIL: $*" >&2; failures=$((failures + 1)); }
sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

# The tags FASTag 1.11.0 (78390cd) writes for dia_like.mzML at defaults
# (-threads 2), the digest that -acquisition_check warn must reproduce.
DIA_LIKE_111=c2f2ccf428c09c3c9b98941244848dbb5019c7367bbce6a3e7507e84271520b4

# run <name> <expected exit> <FASTag args...>: in $TMP/<name>, stdout and
# stderr to $TMP/<name>/log.
run() {
  local name=$1 want=$2; shift 2
  mkdir -p "$TMP/$name"
  ( cd "$TMP/$name" && "$BIN" "$@" > out.log 2> err.log ); local rc=$?
  cat "$TMP/$name/out.log" "$TMP/$name/err.log" > "$TMP/$name/log"
  if [ "$rc" != "$want" ]; then
    fail "$name: exit $rc, expected $want"; sed 's/^/    /' "$TMP/$name/log" | tail -20 >&2
    return 1
  fi
  return 0
}

# refused <name> <input> [extra args...]: exit 11 with sentinels at every output path.
OUTS=(t.tsv r.tsv d.tsv ids.idXML dg.tsv lb.tsv mg.tsv gl.tsv)
refused() {
  local name=$1 in=$2; shift 2
  mkdir -p "$TMP/$name"
  local f
  for f in "${OUTS[@]}" sp.mzML; do printf 'sentinel %s\n' "$f" > "$TMP/$name/$f"; done
  (cd "$TMP/$name" && ls | LC_ALL=C sort > ../$name.before)
  for f in "${OUTS[@]}" sp.mzML; do cp "$TMP/$name/$f" "$TMP/$name.$f.orig"; done
  run "$name" 11 -in "$in" -out t.tsv -fasta "$FASTA" -recon_out r.tsv -delta_out d.tsv -recon_id_out ids.idXML \
      -digest_out dg.tsv -label_out lb.tsv -massgap_out mg.tsv -glyco -glyco_out gl.tsv -min_filter_length 3 "$@" \
      || return 1
  for f in "${OUTS[@]}" sp.mzML; do
    cmp -s "$TMP/$name/$f" "$TMP/$name.$f.orig" || fail "$name: $f changed by a refused run"
  done
  (cd "$TMP/$name" && ls | grep -v -e '^out.log$' -e '^err.log$' -e '^log$' | LC_ALL=C sort > ../$name.after)
  cmp -s "$TMP/$name.before" "$TMP/$name.after" || fail "$name: a refused run created files: $(comm -13 "$TMP/$name.before" "$TMP/$name.after" | tr '\n' ' ')"
  grep -q 'DIAspeXtract -in ' "$TMP/$name/err.log" || fail "$name: no DIAspeXtract recommendation on stderr"
  [ "$(grep -c '^FASTAG_REFUSED reason=raw_dia ' "$TMP/$name/err.log")" = 1 ] || fail "$name: not exactly one FASTAG_REFUSED line on stderr"
  grep -q 'FASTAG_REFUSED' "$TMP/$name/out.log" && fail "$name: FASTAG_REFUSED on stdout"
  grep -qE '^[0-9]+ MS2 spectra, [0-9]+ tags' "$TMP/$name/log" && fail "$name: a summary line on a refused run"
  return 0
}

# --- raw DIA is refused ------------------------------------------------------
refused dia_fast "$FIX/dia_like.mzML" -threads 2
grep -q '^FASTAG_REFUSED reason=raw_dia windows=20 median_width=25$' "$TMP/dia_fast/err.log" \
  || fail "dia_like: FASTAG_REFUSED line: $(grep FASTAG_REFUSED "$TMP/dia_fast/err.log")"
grep -q "is raw DIA: the precursor m/z of its MS2 repeats in a cycle of 20 isolation windows (median 25 Th, 400-900 m/z" \
  "$TMP/dia_fast/err.log" || fail "dia_like: refusal message"
grep -q -- "-out $FIX/dia_like.pseudo.mzML" "$TMP/dia_fast/err.log" || fail "dia_like: pseudo-DDA output path"
refused dia_ondisc "$FIX/dia_like.mzML" -out_spectra sp.mzML -threads 2
for t in 1 3 8; do
  refused "dia_t$t" "$FIX/dia_like.mzML" -threads $t
  [ "$(grep FASTAG_REFUSED "$TMP/dia_t$t/err.log")" = "$(grep FASTAG_REFUSED "$TMP/dia_fast/err.log")" ] \
    || fail "threads $t: a different refusal"
done
refused astral "$FIX/astral_dia_like.mzML" -threads 2
grep -q 'windows=300 median_width=2$' "$TMP/astral/err.log" || fail "astral: $(grep FASTAG_REFUSED "$TMP/astral/err.log")"
refused diapasef "$FIX/diapasef_split_like.mzML" -threads 2
grep -q 'is raw DIA (diaPASEF)' "$TMP/diapasef/err.log" || fail "diapasef_split_like: not called diaPASEF"
refused shifted "$FIX/dia_shifted_target.mzML" -threads 2
refused shifted_ondisc "$FIX/dia_shifted_target.mzML" -out_spectra sp.mzML -threads 2
refused nowin_mgf "$FIX/dia_nowin_like.mgf" -threads 2
grep -q 'without recorded isolation windows' "$TMP/nowin_mgf/err.log" || fail "dia_nowin_like.mgf: message"

# mzPeak, when this build reads it.
"$ACQ" --write-mzpeak "$TMP/dia.mzpeak" > /dev/null 2>&1; rc=$?
if [ $rc = 0 ]; then
  refused dia_mzpeak "$TMP/dia.mzpeak" -threads 2
elif [ $rc = 77 ]; then
  echo "acquisition_cli_test: no mzPeak support, mzPeak case skipped"
else
  fail "acquisition_test --write-mzpeak exit $rc"
fi

# --- warn and off --------------------------------------------------------------
run dia_warn 0 -in "$FIX/dia_like.mzML" -out t.tsv -acquisition_check warn -threads 2
run dia_off 0 -in "$FIX/dia_like.mzML" -out t.tsv -acquisition_check off -threads 2
[ "$(sha "$TMP/dia_warn/t.tsv")" = "$DIA_LIKE_111" ] || fail "warn: tags differ from FASTag 1.11.0 ($(sha "$TMP/dia_warn/t.tsv"))"
cmp -s "$TMP/dia_warn/t.tsv" "$TMP/dia_off/t.tsv" || fail "warn and off tags differ"
grep -q 'tagging it anyway as -acquisition_check warn asks' "$TMP/dia_warn/err.log" || fail "warn: no WARN"
grep -q 'FASTAG_REFUSED' "$TMP/dia_warn/log" && fail "warn: FASTAG_REFUSED"
grep -q 'Acquisition check' "$TMP/dia_off/log" && fail "off: the probe ran"
grep -qE '^[0-9]+ MS2 spectra, [0-9]+ tags' "$TMP/dia_warn/log" || fail "warn: no summary line"

# --- what must pass, byte-identical to off -------------------------------------
pass() {
  local name=$1 in=$2 mode=$3
  run "${name}_def" 0 -in "$in" -out t.tsv -threads 2 || return
  run "${name}_off" 0 -in "$in" -out t.tsv -acquisition_check off -threads 2 || return
  cmp -s "$TMP/${name}_def/t.tsv" "$TMP/${name}_off/t.tsv" || fail "$name: tags differ from -acquisition_check off"
  grep -q "^Acquisition check: $mode " "$TMP/${name}_def/err.log" \
    || fail "$name: expected '$mode': $(grep 'Acquisition check' "$TMP/${name}_def/err.log")"
  grep -q 'Acquisition check' "$TMP/${name}_def/out.log" && fail "$name: INFO on stdout"
  # The digested summary line is unchanged and still the first of its kind.
  [ "$(grep -m1 -E '^[0-9]+ MS2 spectra, [0-9]+ tags' "$TMP/${name}_def/log")" = \
    "$(grep -m1 -E '^[0-9]+ MS2 spectra, [0-9]+ tags' "$TMP/${name}_off/log")" ] || fail "$name: summary line differs"
}
pass pseudo "$FIX/dia_pseudo_like.mzML" pseudo-DDA
pass pseudo_repeat "$FIX/dia_pseudo_repeat_like.mzML" pseudo-DDA
pass diatracer "$FIX/diatracer_like.mzML" pseudo-DDA
pass ddapasef "$FIX/ddapasef_empty.mzML" undetermined
pass prm "$FIX/prm_like.mzML" PRM/targeted
pass wwa "$FIX/wwa_dda_like.mzML" DDA
pass ecoli "$FIX/Ecoli_MS2_small.mzML" DDA
pass ecoli_mgf "$FIX/Ecoli_MS2_small.mgf" DDA
grep -q WARN "$TMP/wwa_def/err.log" && fail "wwa_dda_like: charged wide windows must not warn"
# The same through OnDisc (-out_spectra): the export is unchanged too.
run ecoli_os_def 0 -in "$FIX/Ecoli_MS2_small.mzML" -out t.tsv -out_spectra s.mzML -threads 2
run ecoli_os_off 0 -in "$FIX/Ecoli_MS2_small.mzML" -out t.tsv -out_spectra s.mzML -acquisition_check off -threads 2
cmp -s "$TMP/ecoli_os_def/t.tsv" "$TMP/ecoli_os_off/t.tsv" || fail "-out_spectra: tags differ from off"
# off is a non-default value, so the export lists it (the compatibility shim
# keeps provenance truthful); apart from that line, and the index offsets and
# checksum it moves, the two exports are equal.
mask() { sed -E -e 's/(name="completion time" value=")[^"]*"/\1MASKED"/' -e '/<offset idRef=|<indexListOffset>|<fileChecksum>/d' "$1"; }
cmp -s <(mask "$TMP/ecoli_os_def/s.mzML") <(mask "$TMP/ecoli_os_off/s.mzML" | sed '/name="parameter: acquisition_check" type="xsd:string" value="off"/d') \
  || fail "-out_spectra: export differs from off beyond its parameter line"
[ "$(grep -c 'parameter: acquisition_check' "$TMP/ecoli_os_off/s.mzML")" = 1 ] || fail "-out_spectra off: -acquisition_check off not listed"
grep -q 'parameter: acquisition' "$TMP/ecoli_os_def/s.mzML" && fail "-out_spectra lists the new options at defaults"
run pseudo_os 0 -in "$FIX/dia_pseudo_like.mzML" -out t.tsv -out_spectra s.mzML -threads 2
grep -q '^Acquisition check: pseudo-DDA ' "$TMP/pseudo_os/err.log" || fail "pseudo-DDA through OnDisc"

# --- the options -------------------------------------------------------------
# Five MS2 are too few to judge: undetermined, a WARN (wide and uncharged), tagged.
run few 0 -in "$FIX/dia_like.mzML" -out t.tsv -acquisition_probe_spectra 5 -threads 2
grep -q '^Acquisition check: undetermined ' "$TMP/few/err.log" || fail "-acquisition_probe_spectra 5: not undetermined"
grep -q 'could not be determined' "$TMP/few/err.log" || fail "-acquisition_probe_spectra 5: no WARN"
cmp -s "$TMP/few/t.tsv" "$TMP/dia_off/t.tsv" || fail "-acquisition_probe_spectra 5: tags differ from off"
run ignored 0 -in "$FIX/Ecoli_MS2_small.mzML" -out t.tsv -acquisition_check off -acquisition_probe_spectra 10 -threads 2
grep -q -- '-acquisition_probe_spectra is only read for -acquisition_check refuse or warn' "$TMP/ignored/log" \
  || fail "no ignored-option warning for -acquisition_probe_spectra under off"
mkdir -p "$TMP/bad"
( cd "$TMP/bad" && "$BIN" -in "$FIX/dia_like.mzML" -out t.tsv -acquisition_check maybe > log 2>&1 ); rc=$?
{ [ $rc != 0 ] && [ $rc != 11 ]; } || fail "-acquisition_check maybe: exit $rc"
[ -e "$TMP/bad/t.tsv" ] && fail "-acquisition_check maybe wrote tags"

# --- -stream is not checked ----------------------------------------------------
blocks() {
  local c k
  for c in 1 2 3 4 5 6; do
    for k in $(seq 0 19); do
      printf 'spectrum c%dw%d %s 2\n' "$c" "$k" "$(awk -v k="$k" 'BEGIN{printf "%.1f", 412.5 + 25 * k}')"
      printf '300.1 10\n400.2 20\n413.317 15\n500.3 12\n601.35 30\n\n'
    done
  done
}
S_DEF=$(blocks | "$BIN" -stream -fragment_tolerance 0.3 -fragment_tolerance_unit Da 2>/dev/null); r1=$?
S_OFF=$(blocks | "$BIN" -stream -fragment_tolerance 0.3 -fragment_tolerance_unit Da -acquisition_check off 2>/dev/null); r2=$?
[ $r1 = 0 ] && [ $r2 = 0 ] || fail "-stream exit $r1/$r2"
[ "$S_DEF" = "$S_OFF" ] || fail "-stream output depends on -acquisition_check"
[ "$(printf '%s\n' "$S_DEF" | grep -c '^#end ')" = 120 ] || fail "-stream: 120 blocks expected"

if [ $failures -gt 0 ]; then echo "acquisition_cli_test: $failures failure(s)" >&2; exit 1; fi
echo "acquisition_cli_test: passed"
