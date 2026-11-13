#!/usr/bin/env bash
# -pick_profile (FASTag 1.12 #9) against the real binary, on the profile
# fixtures written by test/fixtures/make_profile_fixtures.py from
# Ecoli_MS2_small.mzML (each centroid a sampled Gaussian):
#
#   1. legacy (the default): option absent = -pick_profile legacy = the
#      FASTag 1.11.0 tags (stored sha256; also run against FASTAG_BASELINE_BIN
#      when set): profile mzML MS2 is tagged as sampled, as in 1.11;
#   2. mzML is never picked, whatever declares its type (own cvParam, none,
#      a referenceableParamGroup); -out_spectra (the OnDiscMSExperiment path)
#      exports profile as profile and changes no tag;
#      -pick_profile off on mzML equals legacy;
#   3. 1.14 tombstones: -pick_profile auto (failed its held-out test) and
#      -pick_unknown_type (read only by auto) are accepted with exactly one
#      warning each and change no output (tags, -out_spectra, MGF); -stream
#      accepts both and still refuses -pick_profile off; an unknown mode is
#      refused;
#   4. mzPeak (when the build supports it): an archive of the profile spectra
#      is picked on read under legacy (as in 1.11) and under auto (read as
#      legacy); under off it gives the mzML legacy tags; its -out_spectra
#      under legacy equals 1.11's export array for array and type for type
#      (with FASTAG_BASELINE_BIN), and is profile under off.
#
# Usage: profile_cli_test.sh <FASTag> <fixtures dir>
# Exits 77 (ctest SKIP) when the binary cannot start.
set -u
BIN="$1"
FIX="$2"
ECOLI="$FIX/Ecoli_MS2_small.mzML"
MGF="$FIX/Ecoli_MS2_small.mgf"
SMALL="$FIX/profile_ms2_small.mzML"
UNTYPED="$FIX/profile_ms2_untyped.mzML"
PG="$FIX/profile_ms2_paramgroup.mzML"
# sha256 of tags.tsv from FASTag 1.11.0 (78390cd) on profile_ms2_small.mzML,
# `-threads 2`, no other option.
LEGACY_SHA=d269497cde9db71790760ee120f88b1c2ed716ed039c8f6fa0036f2c3df11d84

if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-profile-test.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
# CR stripped: on Windows FASTag writes its text outputs with CRLF, as 1.11 did.
sha() { if command -v sha256sum >/dev/null 2>&1; then tr -d '\r' < "$1" | sha256sum | cut -d' ' -f1; else tr -d '\r' < "$1" | shasum -a 256 | cut -d' ' -f1; fi; }
run() { # run <name> <args...>: tags in $TMP/<name>.tsv, log in $TMP/<name>.log
  local n=$1; shift
  "$BIN" -out "$TMP/$n.tsv" -threads 2 "$@" > "$TMP/$n.log" 2>&1 || { cat "$TMP/$n.log" >&2; fail "run $n ($*) failed"; }
}
# Rows of the spectra whose native IDs are in $1 (one per line), header kept.
# rows_of and lfcmp strip CR: on Windows FASTag writes CRLF and awk reads it
# as LF, so a rows_of extract and a run's own TSV differ by CR alone.
rows_of() { awk -F'\t' 'NR==FNR{want[$0]=1; next} FNR==1 || ($1 in want)' <(tr -d '\r' < "$1") <(tr -d '\r' < "$2"); }
lfcmp() { cmp -s <(tr -d '\r' < "$1") <(tr -d '\r' < "$2"); }
# Spectra with at least one tag.
tagged() { awk -F'\t' 'FNR>1 && !seen[$1]++ {print $1}' "$1" | LC_ALL=C sort; }
ids_of() { tr -d '\r' < "$1" | grep -o '<spectrum [^>]*' | sed -E 's/.* id="([^"]*)".*/\1/'; }
count_of() { echo $(( $(wc -l < "$1") - 1 )); }

ids_of "$SMALL" > "$TMP/ids10.txt"
ids_of "$UNTYPED" > "$TMP/ids4.txt"
[ "$(wc -l < "$TMP/ids10.txt")" -eq 10 ] && [ "$(wc -l < "$TMP/ids4.txt")" -eq 4 ] || fail "fixture spectrum counts"

# ---- 1. legacy = absent = 1.11 -------------------------------------------
run absent -in "$SMALL"
run legacy -in "$SMALL" -pick_profile legacy
cmp -s "$TMP/absent.tsv" "$TMP/legacy.tsv" || fail "-pick_profile legacy differs from the option absent"
[ "$(count_of "$TMP/absent.tsv")" -gt 0 ] || fail "legacy on the profile fixture wrote no tags (vacuous)"
got=$(sha "$TMP/absent.tsv")
[ "$got" = "$LEGACY_SHA" ] || fail "legacy tags on profile_ms2_small.mzML are not 1.11.0's ($got)"
if [ -n "${FASTAG_BASELINE_BIN:-}" ] && [ -x "${FASTAG_BASELINE_BIN}" ]; then
  "$FASTAG_BASELINE_BIN" -in "$SMALL" -out "$TMP/base.tsv" -threads 2 > "$TMP/base.log" 2>&1 || fail "baseline binary failed"
  cmp -s "$TMP/base.tsv" "$TMP/absent.tsv" || fail "legacy tags differ from FASTAG_BASELINE_BIN's"
fi
grep -q 'centroided' "$TMP/absent.log" && fail "legacy on mzML logs a centroiding line"

# ---- 2. mzML is never picked ------------------------------------------------
run ecoli -in "$ECOLI"
run ecoli_legacy -in "$ECOLI" -pick_profile legacy
cmp -s "$TMP/ecoli.tsv" "$TMP/ecoli_legacy.tsv" || fail "legacy on Ecoli differs from the option absent"
rows_of "$TMP/ids4.txt" "$TMP/absent.tsv" > "$TMP/legacy4.tsv"
# The first 4 spectra carry no tag as sampled profile (picked, they do, as
# their mzPeak archive below shows), so equal rows mean nothing was picked.
[ "$(count_of "$TMP/legacy4.tsv")" -eq 0 ] || fail "the first 4 profile spectra have tags as sampled (the check below would be weak)"
run unt -in "$UNTYPED"
lfcmp "$TMP/unt.tsv" "$TMP/legacy4.tsv" || fail "the untyped fixture differs from the typed one under legacy"
run pg_fast -in "$PG"
lfcmp "$TMP/pg_fast.tsv" "$TMP/legacy4.tsv" || fail "the param-group fixture (fast reader) differs from the typed one"
for n in unt pg_fast; do grep -q 'centroided' "$TMP/$n.log" && fail "$n: mzML was centroided"; done
run sm_legacy -in "$SMALL" -out_spectra "$TMP/sm_legacy.mzML"
cmp -s "$TMP/sm_legacy.tsv" "$TMP/absent.tsv" || fail "legacy -out_spectra changed the tags"
[ "$(grep -c 'MS:1000128' "$TMP/sm_legacy.mzML")" -ge 1 ] || fail "legacy -out_spectra: profile spectra not exported as profile"
grep -q 'parameter: pick_profile' "$TMP/sm_legacy.mzML" && fail "legacy -out_spectra lists -pick_profile (the 1.11 list is frozen)"
run off -in "$SMALL" -pick_profile off
cmp -s "$TMP/off.tsv" "$TMP/absent.tsv" || fail "-pick_profile off on mzML differs from legacy"

# ---- 3. 1.14 tombstones: -pick_profile auto, -pick_unknown_type ----------------
AUTO_WARN='-pick_profile auto was removed in 1.14 (failed its held-out test); it has no effect: -pick_profile legacy is used.'
UNK_WARN='-pick_unknown_type was removed in 1.14 (read only by -pick_profile auto, which failed its held-out test); it has no effect.'
# one <log> <warning>: the warning exactly once, and no other removal line.
one() {
  [ "$(grep -cF -- "$2" "$1")" -eq 1 ] && [ "$(grep -c 'was removed in 1.14' "$1")" -eq 1 ] \
    || { cat "$1" >&2; fail "$(basename "$1" .log): not exactly one removal warning: $2"; }
}
run auto -in "$SMALL" -pick_profile auto
one "$TMP/auto.log" "$AUTO_WARN"
cmp -s "$TMP/auto.tsv" "$TMP/absent.tsv" || fail "-pick_profile auto: tags differ from legacy"
grep -q 'centroided' "$TMP/auto.log" && fail "-pick_profile auto centroided mzML"
# -out_spectra: the same spectra, and auto (read as the default) is not listed.
spl() { tr -d '\r' < "$1" | sed -n '/<spectrumList /,/<\/spectrumList>/p'; }
run sm_auto -in "$SMALL" -pick_profile auto -out_spectra "$TMP/sm_auto.mzML"
one "$TMP/sm_auto.log" "$AUTO_WARN"
cmp -s "$TMP/sm_auto.tsv" "$TMP/absent.tsv" || fail "-pick_profile auto -out_spectra: tags differ from legacy"
cmp -s <(spl "$TMP/sm_auto.mzML") <(spl "$TMP/sm_legacy.mzML") || fail "-pick_profile auto: -out_spectra spectra differ from legacy"
grep -q 'parameter: pick_profile' "$TMP/sm_auto.mzML" && fail "-pick_profile auto is listed in the -out_spectra processing info"
run unk -in "$SMALL" -pick_unknown_type
one "$TMP/unk.log" "$UNK_WARN"
cmp -s "$TMP/unk.tsv" "$TMP/absent.tsv" || fail "-pick_unknown_type changed the tags"
grep -q -- '-pick_unknown_type is only read' "$TMP/unk.log" && fail "-pick_unknown_type still has an ignored-option warning"
run unt_both -in "$UNTYPED" -pick_profile auto -pick_unknown_type
[ "$(grep -cF -- "$AUTO_WARN" "$TMP/unt_both.log")" -eq 1 ] && [ "$(grep -cF -- "$UNK_WARN" "$TMP/unt_both.log")" -eq 1 ] \
  && [ "$(grep -c 'was removed in 1.14' "$TMP/unt_both.log")" -eq 2 ] || { cat "$TMP/unt_both.log" >&2; fail "auto with -pick_unknown_type: not one warning each"; }
cmp -s "$TMP/unt_both.tsv" "$TMP/unt.tsv" || fail "untyped under auto with -pick_unknown_type differs from legacy"
run mgf_legacy -in "$MGF"
run mgf_auto -in "$MGF" -pick_profile auto -pick_unknown_type
cmp -s "$TMP/mgf_legacy.tsv" "$TMP/mgf_auto.tsv" || fail "auto on MGF changed the tags"
grep -q -- 'does not centroid MGF' "$TMP/mgf_auto.log" && fail "auto on MGF still warns about MGF"
for o in "-pick_profile auto" "-pick_unknown_type"; do
  # shellcheck disable=SC2086
  printf 'spectrum s 500.25 2\n300.1 10\n\n' | "$BIN" -stream $o > "$TMP/stream.out" 2> "$TMP/stream.err" \
    || { cat "$TMP/stream.err" >&2; fail "-stream $o was refused (a 1.14 tombstone never refuses)"; }
done
printf 'spectrum s 500.25 2\n300.1 10\n\n' | "$BIN" -stream -pick_profile off > "$TMP/stream.out" 2> "$TMP/stream.err" \
  && fail "-stream -pick_profile off was not refused"
grep -q -- "-stream cannot be combined with -pick_profile" "$TMP/stream.err" "$TMP/stream.out" || fail "-stream -pick_profile off: no refusal message"
"$BIN" -in "$SMALL" -out "$TMP/bad.tsv" -pick_profile sometimes > "$TMP/bad.log" 2>&1 && fail "an unknown -pick_profile mode was accepted"

# ---- 4. mzPeak ----------------------------------------------------------------
# The archive: the profile spectra as read (legacy does not pick mzML); it
# holds the ones that carry a tag as sampled profile (-out_spectra keeps
# those), and the mzPeak runs are compared on them.
if "$BIN" -in "$SMALL" -out "$TMP/mk.tsv" -out_spectra "$TMP/prof.mzpeak" -threads 2 > "$TMP/mk.log" 2>&1; then
  cmp -s "$TMP/mk.tsv" "$TMP/absent.tsv" || fail "writing an archive changed the legacy tags"
  tagged "$TMP/mk.tsv" > "$TMP/arch.ids"
  na=$(wc -l < "$TMP/arch.ids" | tr -d ' ')
  [ "$na" -ge 3 ] || fail "the profile archive holds $na spectra (weak check)"
  grep -q "Wrote $na spectra to" "$TMP/mk.log" || { cat "$TMP/mk.log" >&2; fail "the archive does not hold the tagged spectra"; }
  rows_of "$TMP/arch.ids" "$TMP/absent.tsv" > "$TMP/legacy_arch.tsv"
  run mp_legacy -in "$TMP/prof.mzpeak"
  run mp_auto -in "$TMP/prof.mzpeak" -pick_profile auto
  run mp_off -in "$TMP/prof.mzpeak" -pick_profile off
  grep -q "mzPeak: centroided $na profile spectra on read" "$TMP/mp_legacy.log" || fail "mzPeak legacy does not centroid on read (1.11)"
  lfcmp "$TMP/mp_legacy.tsv" "$TMP/legacy_arch.tsv" && fail "mzPeak legacy equals the unpicked mzML tags (nothing was picked)"
  one "$TMP/mp_auto.log" "$AUTO_WARN"
  cmp -s "$TMP/mp_auto.tsv" "$TMP/mp_legacy.tsv" || fail "mzPeak auto differs from mzPeak legacy"
  grep -q "mzPeak: centroided $na profile spectra on read" "$TMP/mp_auto.log" || fail "mzPeak auto (read as legacy) does not centroid on read"
  lfcmp "$TMP/mp_off.tsv" "$TMP/legacy_arch.tsv" || fail "mzPeak off differs from the unpicked mzML tags"
  grep -q 'centroided' "$TMP/mp_off.log" && fail "mzPeak off logs a centroiding line"
  # Export as tagged.
  run mpx_legacy -in "$TMP/prof.mzpeak" -out_spectra "$TMP/mpx_legacy.mzML"
  run mpx_off -in "$TMP/prof.mzpeak" -pick_profile off -out_spectra "$TMP/mpx_off.mzML"
  grep -q 'MS:1000128' "$TMP/mpx_legacy.mzML" && fail "mzPeak legacy -out_spectra exported profile spectra (1.11 exports them picked)"
  [ "$(grep -c 'MS:1000128' "$TMP/mpx_off.mzML")" -ge 1 ] || fail "mzPeak off -out_spectra did not export profile spectra"
  if [ -n "${FASTAG_BASELINE_BIN:-}" ] && [ -x "${FASTAG_BASELINE_BIN}" ]; then
    "$FASTAG_BASELINE_BIN" -in "$TMP/prof.mzpeak" -out "$TMP/bx.tsv" -out_spectra "$TMP/bx.mzML" -threads 2 \
      > "$TMP/bx.log" 2>&1 || fail "baseline mzPeak -out_spectra failed"
    cmp -s "$TMP/bx.tsv" "$TMP/mpx_legacy.tsv" || fail "mzPeak legacy tags differ from the baseline's"
    # Arrays and types, spectrum by spectrum (the run header carries dates
    # and versions).
    spectra() { tr -d '\r' < "$1" | sed -n '/<spectrum /,/<\/spectrum>/p' | grep -v 'dataProcessingRef'; }
    cmp -s <(spectra "$TMP/bx.mzML") <(spectra "$TMP/mpx_legacy.mzML") \
      || fail "mzPeak legacy -out_spectra spectra differ from 1.11's (arrays or types)"
  fi
else
  grep -qi 'no mzPeak support' "$TMP/mk.log" || { cat "$TMP/mk.log" >&2; fail "writing the profile archive failed"; }
  echo "profile_cli_test: mzPeak part skipped (no mzPeak support in this build)"
fi

echo "profile_cli_test: all checks passed"
