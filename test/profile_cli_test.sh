#!/usr/bin/env bash
# -pick_profile and -pick_unknown_type (FASTag 1.12 #9) against the real
# binary, on the profile fixtures written by test/fixtures/make_profile_fixtures.py
# from Ecoli_MS2_small.mzML (each centroid a sampled Gaussian):
#
#   1. legacy (the default): option absent = -pick_profile legacy = the
#      FASTag 1.11.0 tags (stored sha256; also run against FASTAG_BASELINE_BIN
#      when set): profile mzML MS2 is tagged as sampled, as in 1.11;
#   2. auto picks profile MS2: every spectrum whose centroided source in
#      Ecoli_MS2_small.mzML has tags has them after picking, and none other;
#      its rank-1 tag equals the source's rank-1 tag up to ties (each side's
#      lowest-E-value tag is among the other side's tags within 1% of that
#      side's lowest E-value: isobaric readings such as FMQ/FCV swap places on
#      a 0.02% E-value change); the tag count is within 5% of the source's;
#      the log reports the count;
#   3. auto on the centroided Ecoli fixture is byte-identical to legacy, and
#      logs nothing new;
#   4. the untyped fixture is picked only with -pick_unknown_type, and then
#      exactly as the typed one;
#   5. the param-group fixture (type only in a referenceableParamGroup) is
#      picked under auto on the fast reader and on OnDiscMSExperiment (the
#      -out_spectra path), with equal tags; -out_spectra exports the spectra
#      as tagged: centroid under auto, profile under legacy;
#   6. low-resolution (ion trap) profile: an exported picked spectrum keeps
#      >= 90% of its source's resolvable peaks within 0.1 Th; one left as
#      profile is counted in the log (never silently thinned);
#   7. threads 1/3/8 identical under auto (tags here; threads_test compares
#      every output and the -out_spectra export);
#   8. ignored and refused combinations: -pick_unknown_type without auto
#      warns, auto on MGF warns and changes nothing, -stream refuses both
#      options, an unknown mode is refused;
#   9. mzPeak (when the build supports it): an archive of the profile spectra
#      read under legacy (picked on read, as in 1.11) and under auto gives the
#      mzML auto tags; under off it gives the mzML legacy tags; its
#      -out_spectra under legacy equals 1.11's export array for array and
#      type for type (with FASTAG_BASELINE_BIN), and is profile under off.
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
LOWRES="$FIX/profile_ms2_lowres.mzML"
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
# rank1 <a.tsv> <b.tsv>: for every spectrum tagged in a, the lowest-E-value
# tag of each side (first in file order among equals) must be among the other
# side's tags within 1% of that side's lowest E-value. Prints the failures.
rank1() {
  awk -F'\t' '
    FNR == 1 { f++; next }
    { k = $1; e = $9 + 0
      if (!((f, k) in best) || e < best[f, k]) { best[f, k] = e; top[f, k] = $2 }
      n[f, k]++; tag[f, k, n[f, k]] = $2; ev[f, k, n[f, k]] = e; spec[k] = 1 }
    function near(g, k, t,   i) { for (i = 1; i <= n[g, k]; i++) if (tag[g, k, i] == t && ev[g, k, i] <= 1.01 * best[g, k]) return 1; return 0 }
    END { for (k in spec) if ((1, k) in best) {
            if (!((2, k) in best)) { print k ": no tags after picking"; continue }
            if (!near(2, k, top[1, k]) || !near(1, k, top[2, k])) print k ": rank-1 " top[1, k] " vs " top[2, k] } }' "$1" "$2"
}
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

# ---- 2. auto picks; rank-1 equals the centroided source ----------------------
run auto -in "$SMALL" -pick_profile auto
run ecoli -in "$ECOLI"
rows_of "$TMP/ids10.txt" "$TMP/ecoli.tsv" > "$TMP/src10.tsv"
[ "$(count_of "$TMP/src10.tsv")" -gt 0 ] || fail "the source spectra have no tags (vacuous)"
tagged "$TMP/src10.tsv" > "$TMP/src.tagged"
tagged "$TMP/auto.tsv" > "$TMP/auto.tagged"
[ "$(wc -l < "$TMP/src.tagged")" -ge 8 ] || fail "fewer than 8 of the 10 source spectra have tags (weak check)"
cmp -s "$TMP/src.tagged" "$TMP/auto.tagged" || fail "auto: the tagged spectra differ from the centroided sources'"
rank1 "$TMP/src10.tsv" "$TMP/auto.tsv" > "$TMP/r1.diff"
[ -s "$TMP/r1.diff" ] && { cat "$TMP/r1.diff" >&2; fail "auto: rank-1 tags differ from the centroided sources"; }
a=$(count_of "$TMP/auto.tsv"); s=$(count_of "$TMP/src10.tsv")
awk -v a="$a" -v s="$s" 'BEGIN{d=a-s; if (d<0) d=-d; exit !(d <= 0.05*s)}' \
  || fail "auto: $a tags vs $s on the centroided sources (more than 5% apart)"
cmp -s "$TMP/auto.tsv" "$TMP/absent.tsv" && fail "auto equals legacy on profile input (nothing was picked)"
grep -q 'mzML: centroided 10 profile spectra on read' "$TMP/auto.log" || { cat "$TMP/auto.log" >&2; fail "auto: the log does not report 10 centroided spectra"; }

# ---- 3. auto on centroid input = legacy ---------------------------------
run ecoli_auto -in "$ECOLI" -pick_profile auto
cmp -s "$TMP/ecoli.tsv" "$TMP/ecoli_auto.tsv" || fail "auto on the centroided Ecoli fixture differs from legacy"
grep -q 'centroided' "$TMP/ecoli_auto.log" && fail "auto on centroid input logs a centroiding line"
run ecoli_legacy -in "$ECOLI" -pick_profile legacy
cmp -s "$TMP/ecoli.tsv" "$TMP/ecoli_legacy.tsv" || fail "legacy on Ecoli differs from the option absent"

# ---- 4. untyped: only with -pick_unknown_type -----------------------------
rows_of "$TMP/ids4.txt" "$TMP/auto.tsv" > "$TMP/auto4.tsv"
rows_of "$TMP/ids4.txt" "$TMP/absent.tsv" > "$TMP/legacy4.tsv"
run unt_auto -in "$UNTYPED" -pick_profile auto
lfcmp "$TMP/unt_auto.tsv" "$TMP/legacy4.tsv" || fail "untyped under auto without -pick_unknown_type is not legacy"
grep -q 'centroided' "$TMP/unt_auto.log" && fail "untyped spectra were picked without -pick_unknown_type"
run unt_flag -in "$UNTYPED" -pick_profile auto -pick_unknown_type
lfcmp "$TMP/unt_flag.tsv" "$TMP/auto4.tsv" || fail "untyped with -pick_unknown_type differs from the typed fixture under auto"
grep -q 'mzML: centroided 4 profile spectra on read' "$TMP/unt_flag.log" || fail "untyped: the log does not report 4"

# ---- 5. param group, fast reader and OnDisc; export as tagged ----------------
run pg_fast -in "$PG" -pick_profile auto
lfcmp "$TMP/pg_fast.tsv" "$TMP/auto4.tsv" || fail "param-group fixture under auto (fast reader) differs from the typed one"
run pg_ondisc -in "$PG" -pick_profile auto -out_spectra "$TMP/pg_auto.mzML"
lfcmp "$TMP/pg_ondisc.tsv" "$TMP/auto4.tsv" || fail "param-group fixture under auto (OnDisc, -out_spectra) differs"
n_exp=$(grep -c '<spectrum ' "$TMP/pg_auto.mzML")
[ "$n_exp" -gt 0 ] || fail "auto -out_spectra exported nothing"
[ "$(grep -c 'MS:1000127' "$TMP/pg_auto.mzML")" -ge "$n_exp" ] || fail "auto -out_spectra: exported spectra are not centroid"
grep -q 'MS:1000128' "$TMP/pg_auto.mzML" && fail "auto -out_spectra: a profile spectrum was exported"
grep -q 'name="parameter: pick_profile" type="xsd:string" value="auto"' "$TMP/pg_auto.mzML" \
  || fail "auto -out_spectra does not record -pick_profile auto in its processing info"
# (Under legacy the first 4 spectra carry no tag as sampled profile, so the
# export check runs on the 10-spectrum fixture.)
run sm_legacy -in "$SMALL" -out_spectra "$TMP/sm_legacy.mzML"
cmp -s "$TMP/sm_legacy.tsv" "$TMP/absent.tsv" || fail "legacy -out_spectra changed the tags"
[ "$(grep -c 'MS:1000128' "$TMP/sm_legacy.mzML")" -ge 1 ] || fail "legacy -out_spectra: profile spectra not exported as profile"
grep -q 'parameter: pick_profile' "$TMP/sm_legacy.mzML" && fail "legacy -out_spectra lists -pick_profile (the 1.11 list is frozen)"

# ---- 6. low resolution: peaks kept, never silently thinned -----------------
# Each exported centroid spectrum (-out_spectra writes the spectra as tagged)
# keeps >= 90% of its source's resolvable peaks (both neighbours >= 1 Th
# away, as centroid_test (e)) within 0.1 Th; a spectrum still profile in the
# export must be one the log counts as kept. Needs python3 (stdlib) to decode
# the arrays; without it only the count line is checked.
run low -in "$LOWRES" -pick_profile auto -fragment_tolerance 0.5 -fragment_tolerance_unit Da -out_spectra "$TMP/low.mzML"
line=$(grep -o 'mzML: centroided [0-9]* profile spectra on read.*' "$TMP/low.log")
[ -n "$line" ] || { cat "$TMP/low.log" >&2; fail "low resolution: no centroiding line"; }
kept=$(echo "$line" | grep -oE '\(([0-9]+) kept as profile' | grep -oE '[0-9]+' || echo 0)
PY=${FASTAG_PYTHON:-}
if [ -z "$PY" ]; then for c in python3 python; do command -v "$c" >/dev/null 2>&1 && { PY=$c; break; }; done; fi
if [ -n "$PY" ]; then
  "$PY" - "$ECOLI" "$TMP/low.mzML" "$kept" > "$TMP/low.check" 2>&1 <<'PYEOF' || { cat "$TMP/low.check" >&2; fail "low resolution: picked spectra lost resolvable peaks"; }
import base64, re, struct, sys, zlib
def spectra(path):
    text = open(path, encoding="latin-1").read()
    out = {}
    for m in re.finditer(r"<spectrum .*?</spectrum>", text, re.S):
        s = m.group(0)
        arr = {}
        for a in re.finditer(r"<binaryDataArray .*?</binaryDataArray>", s, re.S):
            b = a.group(0)
            raw = base64.b64decode(re.search(r"<binary>(.*?)</binary>", b, re.S).group(1))
            if "MS:1000574" in b:
                raw = zlib.decompress(raw)
            fmt = "d" if "MS:1000523" in b else "f"
            arr["mz" if "MS:1000514" in b else "int"] = struct.unpack("<%d%s" % (len(raw) // struct.calcsize(fmt), fmt), raw)
        out[re.search(r' id="([^"]*)"', s).group(1)] = ("MS:1000127" in s, arr.get("mz", ()))
    return out
src, exp, kept = spectra(sys.argv[1]), spectra(sys.argv[2]), int(sys.argv[3])
checked = profile = 0
for sid, (centroid, mz) in exp.items():
    if not centroid:
        profile += 1
        continue
    c = sorted(src[sid][1])
    res = [x for i, x in enumerate(c) if (i == 0 or x - c[i - 1] >= 1.0) and (i + 1 == len(c) or c[i + 1] - x >= 1.0)]
    hit = sum(1 for x in res if any(abs(x - y) <= 0.1 for y in mz))
    f = hit / len(res) if res else 1.0
    print("%s: %d of %d resolvable source peaks picked within 0.1 Th (%.3f)" % (sid, hit, len(res), f))
    if f < 0.9:
        sys.exit("FAIL %s: %.3f < 0.9" % (sid, f))
    checked += 1
if profile > kept:
    sys.exit("FAIL: %d exported spectra are profile, the log counts %d kept" % (profile, kept))
if checked == 0:
    sys.exit("FAIL: no picked spectrum was exported (the check would prove nothing)")
print("checked %d picked spectra; %d profile (kept %d)" % (checked, profile, kept))
PYEOF
else
  echo "profile_cli_test: low-resolution peak retention not checked (no python3)"
fi

# ---- 7. threads -------------------------------------------------------------
for t in 1 3 8; do
  "$BIN" -in "$SMALL" -out "$TMP/t$t.tsv" -pick_profile auto -threads "$t" > "$TMP/t$t.log" 2>&1 || fail "auto at -threads $t"
done
cmp -s "$TMP/t1.tsv" "$TMP/t3.tsv" && cmp -s "$TMP/t1.tsv" "$TMP/t8.tsv" || fail "auto differs between thread counts"
cmp -s "$TMP/t1.tsv" "$TMP/auto.tsv" || fail "auto at 1 thread differs from 2"

# ---- 8. ignored and refused -------------------------------------------------
run unk_legacy -in "$SMALL" -pick_unknown_type
cmp -s "$TMP/unk_legacy.tsv" "$TMP/absent.tsv" || fail "-pick_unknown_type under legacy changed the tags"
grep -q -- '-pick_unknown_type is only read for -pick_profile auto' "$TMP/unk_legacy.log" || fail "-pick_unknown_type under legacy does not warn"
run mgf_legacy -in "$MGF"
run mgf_auto -in "$MGF" -pick_profile auto -pick_unknown_type
cmp -s "$TMP/mgf_legacy.tsv" "$TMP/mgf_auto.tsv" || fail "auto on MGF changed the tags"
grep -q -- '-pick_profile auto does not centroid MGF input' "$TMP/mgf_auto.log" || fail "auto on MGF does not warn"
for o in "-pick_profile auto" "-pick_profile off" "-pick_unknown_type"; do
  # shellcheck disable=SC2086
  printf 'spectrum s 500.25 2\n300.1 10\n\n' | "$BIN" -stream $o > "$TMP/stream.out" 2> "$TMP/stream.err" \
    && fail "-stream $o was not refused"
  grep -q -- "-stream cannot be combined with ${o%% *}" "$TMP/stream.err" "$TMP/stream.out" || fail "-stream $o: no refusal message"
done
"$BIN" -in "$SMALL" -out "$TMP/bad.tsv" -pick_profile sometimes > "$TMP/bad.log" 2>&1 && fail "an unknown -pick_profile mode was accepted"

# ---- 9. mzPeak ----------------------------------------------------------------
# The archive: the profile spectra as read (legacy does not pick mzML); it
# holds the ones that carry a tag as sampled profile (-out_spectra keeps
# those), and the mzPeak runs are compared on them.
if "$BIN" -in "$SMALL" -out "$TMP/mk.tsv" -out_spectra "$TMP/prof.mzpeak" -threads 2 > "$TMP/mk.log" 2>&1; then
  cmp -s "$TMP/mk.tsv" "$TMP/absent.tsv" || fail "writing an archive changed the legacy tags"
  tagged "$TMP/mk.tsv" > "$TMP/arch.ids"
  na=$(wc -l < "$TMP/arch.ids" | tr -d ' ')
  [ "$na" -ge 3 ] || fail "the profile archive holds $na spectra (weak check)"
  grep -q "Wrote $na spectra to" "$TMP/mk.log" || { cat "$TMP/mk.log" >&2; fail "the archive does not hold the tagged spectra"; }
  rows_of "$TMP/arch.ids" "$TMP/auto.tsv" > "$TMP/auto_arch.tsv"
  rows_of "$TMP/arch.ids" "$TMP/absent.tsv" > "$TMP/legacy_arch.tsv"
  run mp_legacy -in "$TMP/prof.mzpeak"
  run mp_auto -in "$TMP/prof.mzpeak" -pick_profile auto
  run mp_off -in "$TMP/prof.mzpeak" -pick_profile off
  grep -q "mzPeak: centroided $na profile spectra on read" "$TMP/mp_legacy.log" || fail "mzPeak legacy does not centroid on read (1.11)"
  lfcmp "$TMP/mp_legacy.tsv" "$TMP/auto_arch.tsv" || fail "mzPeak legacy tags differ from mzML auto tags"
  cmp -s "$TMP/mp_auto.tsv" "$TMP/mp_legacy.tsv" || fail "mzPeak auto differs from mzPeak legacy"
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
