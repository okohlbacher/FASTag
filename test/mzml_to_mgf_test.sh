#!/usr/bin/env bash
# tools/mzml_to_mgf.py on the vendored fixtures, and FASTag on what it writes.
#   a. Ecoli_MS2_small.mzML converts to the vendored Ecoli_MS2_small.mgf byte
#      for byte (the converter's output did not drift)
#   b. diaTracer layout (diatracer_like.mzML: no selected ion m/z, only the
#      isolation window target; frame=<n> IDs; minutes): every spectrum is
#      written, PEPMASS is the isolation window target, RT is minutes x 60
#   c. ddaPASEF with MS2 without peaks (ddapasef_empty.mzML: zlib and raw
#      arrays of length 0, no arrays at all), a precursor without m/z and an
#      MS2 without precursor: written as empty blocks, without PEPMASS and
#      left out, each counted; --skip-empty leaves the empty ones out
#   d. FASTag gives the same tags from each MGF as from its mzML once column 1
#      is cut, the same MS2 and tag counts, and column 1 index=<k> names the
#      block whose TITLE is the mzML row's native ID
#   e. usage and inconsistent arrays are errors
# Exits 77 (ctest SKIP) without a Python that has pyteomics; part d is
# skipped when the binary cannot start.
set -u
BIN="$1"
CONV="$2"
FIX="$3"   # test/fixtures
PY="${FASTAG_PYTHON:-}"
if [ -z "$PY" ]; then
  for c in python3 python; do command -v "$c" >/dev/null 2>&1 && { PY="$c"; break; }; done
fi
if [ -z "$PY" ] || ! "$PY" -c 'import pyteomics.mzml, numpy' >/dev/null 2>&1; then
  echo "SKIP: no python with pyteomics and numpy (set FASTAG_PYTHON)" >&2
  exit 77
fi
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-mzml2mgf.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
conv() {  # conv <log> <args...>: must exit 0
  local log="$1"; shift
  "$PY" -I "$CONV" "$@" 2>"$log" || { cat "$log" >&2; fail "converter failed: $*"; }
}
blocks() { grep -c '^BEGIN IONS$' "$1"; }
# Blocks without a peak line, and blocks without PEPMASS.
empty_blocks() { awk '/^BEGIN IONS/ {p=0} /^[0-9]/ {p=1} /^END IONS/ && !p {n++} END {print n+0}' "$1"; }
no_pepmass() { awk '/^BEGIN IONS/ {p=0} /^PEPMASS=/ {p=1} /^END IONS/ && !p {n++} END {print n+0}' "$1"; }

# ---- a. the vendored fixture MGF
conv "$TMP/a.log" "$FIX/Ecoli_MS2_small.mzML" "$TMP/ecoli.mgf"
cmp -s "$TMP/ecoli.mgf" "$FIX/Ecoli_MS2_small.mgf" || fail "Ecoli_MS2_small.mzML no longer converts to the vendored MGF"
grep -q "warning" "$TMP/a.log" && { cat "$TMP/a.log" >&2; fail "warnings on the clean fixture"; }

# ---- b. diaTracer
conv "$TMP/b.log" "$FIX/diatracer_like.mzML" "$TMP/dt.mgf"
n=$(grep -c '<spectrum ' "$FIX/diatracer_like.mzML")
[ "$(blocks "$TMP/dt.mgf")" -eq "$n" ] || fail "diaTracer: $(blocks "$TMP/dt.mgf") blocks for $n MS2"
grep -q "^$n MS2 spectra written" "$TMP/b.log" || fail "diaTracer: no '$n MS2 spectra written'"
grep -q "warning" "$TMP/b.log" && { cat "$TMP/b.log" >&2; fail "diaTracer: unexpected warning"; }
# PEPMASS is the isolation window target, numerically; TITLE the frame ID.
paste <(grep -o 'name="isolation window target m/z" value="[^"]*"' "$FIX/diatracer_like.mzML" | sed 's/.*value="//; s/"$//') \
      <(sed -n 's/^PEPMASS=//p' "$TMP/dt.mgf") \
  | awk '$1 + 0 != $2 + 0 {bad=1} END {exit bad || NR == 0}' || fail "diaTracer: PEPMASS is not the isolation window target m/z"
[ "$(sed -n 's/^TITLE=//p' "$TMP/dt.mgf" | head -1)" = "frame=1" ] || fail "diaTracer: TITLE is not the frame ID"
grep -q '^SCANS=' "$TMP/dt.mgf" && fail "diaTracer: SCANS without a scan= ID"
paste <(grep -o 'name="scan start time" value="[^"]*"' "$FIX/diatracer_like.mzML" | sed 's/.*value="//; s/"$//') \
      <(sed -n 's/^RTINSECONDS=//p' "$TMP/dt.mgf") \
  | awk '{d = $1 * 60 - $2; if (d < 0) d = -d; if (d > 1e-9 * $2) bad=1} END {exit bad || NR == 0}' \
  || fail "diaTracer: RTINSECONDS is not the scan start time in minutes x 60"
[ "$(grep -c '^CHARGE=[0-9]*+$' "$TMP/dt.mgf")" -eq "$n" ] || fail "diaTracer: the charge from a selectedIon without m/z was lost"

# ---- c. ddaPASEF with empty MS2
conv "$TMP/c.log" "$FIX/ddapasef_empty.mzML" "$TMP/dda.mgf"
conv "$TMP/c2.log" --skip-empty "$FIX/ddapasef_empty.mzML" "$TMP/dda_skip.mgf"
ms2=$(grep -c 'name="ms level" value="2"' "$FIX/ddapasef_empty.mzML")
[ "$(blocks "$TMP/dda.mgf")" -eq $((ms2 - 1)) ] || fail "ddaPASEF: $(blocks "$TMP/dda.mgf") blocks, expected $((ms2 - 1))"
grep -q "^$((ms2 - 1)) MS2 spectra written" "$TMP/c.log" || fail "ddaPASEF: written count"
grep -q "warning: 4 MS2 spectra have no peaks: written as blocks without peaks" "$TMP/c.log" || { cat "$TMP/c.log" >&2; fail "ddaPASEF: empty count"; }
grep -q "warning: 1 MS2 spectra have no precursor: left out" "$TMP/c.log" || fail "ddaPASEF: no-precursor count"
grep -q "warning: 1 MS2 spectra have neither a selected ion m/z" "$TMP/c.log" || fail "ddaPASEF: no-m/z count"
[ "$(empty_blocks "$TMP/dda.mgf")" -eq 4 ] || fail "ddaPASEF: $(empty_blocks "$TMP/dda.mgf") blocks without peaks, expected 4"
[ "$(no_pepmass "$TMP/dda.mgf")" -eq 1 ] || fail "ddaPASEF: $(no_pepmass "$TMP/dda.mgf") blocks without PEPMASS, expected 1"
[ "$(blocks "$TMP/dda_skip.mgf")" -eq $((ms2 - 5)) ] || fail "--skip-empty: $(blocks "$TMP/dda_skip.mgf") blocks, expected $((ms2 - 5))"
[ "$(empty_blocks "$TMP/dda_skip.mgf")" -eq 0 ] || fail "--skip-empty: blocks without peaks remain"
grep -q "warning: 4 MS2 spectra have no peaks: left out (--skip-empty)" "$TMP/c2.log" || fail "--skip-empty: count"
# The skipped blocks are the empty ones and nothing else.
cmp -s <(awk '/^BEGIN IONS/ {b=""; p=0} {b=b $0 "\n"} /^[0-9]/ {p=1} /^END IONS/ && p {printf "%s\n", b}' "$TMP/dda.mgf") "$TMP/dda_skip.mgf" \
  || fail "--skip-empty changed more than the empty blocks"
# Selected ion m/z wins over the (rounded) isolation window target.
first=$(grep -m1 -o 'name="selected ion m/z" value="[^"]*"' "$FIX/ddapasef_empty.mzML" | sed 's/.*value="//; s/"$//')
awk -v w="$first" 'BEGIN {exit !(w > 0)}' || fail "fixture: no selected ion m/z"
[ "$(sed -n 's/^PEPMASS=//p' "$TMP/dda.mgf" | head -1 | awk -v w="$first" '{print ($1 + 0 == w + 0)}')" = 1 ] \
  || fail "ddaPASEF: PEPMASS is not the selected ion m/z"

# ---- e. errors
"$PY" -I "$CONV" "$FIX/diatracer_like.mzML" >/dev/null 2>&1 && fail "one argument accepted"
"$PY" -I "$CONV" --bogus "$FIX/diatracer_like.mzML" "$TMP/x.mgf" >/dev/null 2>&1 && fail "an unknown option accepted"
# One m/z value too many in a spectrum: refused, not paired short.
"$PY" -I - "$FIX/diatracer_like.mzML" "$TMP/bad.mzML" <<'EOF' || fail "could not write the inconsistent mzML"
import base64, re, sys, zlib
import numpy as np
src = open(sys.argv[1], encoding="utf-8").read()
def grow(m):
    a = np.frombuffer(zlib.decompress(base64.b64decode(m.group(2))), "<f8")
    b = base64.b64encode(zlib.compress(np.append(a, a[-1] + 1).tobytes())).decode()
    return m.group(1) + b + m.group(3)
# The first m/z array only (it precedes its intensity array).
src = re.sub(r'(name="m/z array"[^>]*/>\s*<binary>)([^<]*)(</binary>)', grow, src, count=1)
open(sys.argv[2], "w", encoding="utf-8").write(src)
EOF
"$PY" -I "$CONV" "$TMP/bad.mzML" "$TMP/bad.mgf" 2>"$TMP/e.log" && fail "mismatched array lengths accepted"
grep -q "must pair up" "$TMP/e.log" || { cat "$TMP/e.log" >&2; fail "mismatched arrays not explained"; }

# ---- d. FASTag: the same tags from the MGF as from the mzML
if ! "$BIN" --help >/dev/null 2>&1; then
  echo "mzml_to_mgf_test: converter checks passed; FASTag checks skipped (binary cannot start)" >&2
  exit 0
fi
ARGS=(-tag_length 4 -extension 1 -fragment_tolerance 0.3 -fragment_tolerance_unit Da -threads 2)
tag() {  # tag <in> <out.tsv>
  "$BIN" -in "$1" -out "$2" "${ARGS[@]}" >"$2.log" 2>&1 || { cat "$2.log" >&2; fail "FASTag failed on $1"; }
}
for pair in "diatracer_like.mzML dt.mgf" "ddapasef_empty.mzML dda.mgf" "ddapasef_empty.mzML dda_skip.mgf"; do
  set -- $pair
  m="$TMP/$1.tsv"; g="$TMP/$2.tsv"
  [ -e "$m" ] || tag "$FIX/$1" "$m"
  tag "$TMP/$2" "$g"
  [ "$(wc -l < "$m")" -gt 1 ] || fail "$1: no tags; the check would prove nothing"
  cmp -s <(cut -f2- "$m") <(cut -f2- "$g") || { diff <(cut -f2- "$m") <(cut -f2- "$g") | head >&2; fail "$2: tags differ from $1"; }
  [ "$(grep -o '[0-9]* MS2 spectra, [0-9]* tags' "$m.log")" = "$(grep -o '[0-9]* MS2 spectra, [0-9]* tags' "$g.log")" ] \
    || fail "$2: MS2 or tag count differs from $1"
  [ "$(grep -o '[0-9]* of [0-9]* MS2 spectra carry no precursor charge' "$m.log")" = \
    "$(grep -o '[0-9]* of [0-9]* MS2 spectra carry no precursor charge' "$g.log")" ] || fail "$2: no-charge count differs"
  # Column 1: index=<k> is the block whose TITLE is the mzML row's native ID.
  awk '/^BEGIN IONS/ {k++} /^TITLE=/ {sub(/^TITLE=/, ""); print "index=" k-1 "\t" $0}' "$TMP/$2" > "$TMP/$2.map"
  paste <(cut -f1 "$g" | tail -n +2) <(cut -f1 "$m" | tail -n +2) \
    | awk -F'\t' 'NR==FNR {t[$1]=$2; next} t[$1] != $2 {bad=1; print "row " FNR ": " $1 " -> " $2 > "/dev/stderr"} END {exit bad}' "$TMP/$2.map" - \
    || fail "$2: column 1 does not name the block of the mzML spectrum"
done
# The empty blocks are read and skipped like the empty mzML spectra: the
# summary counts the MS2 with peaks and a precursor only, in all three runs.
grep -q "$((ms2 - 5)) MS2 spectra," "$TMP/ddapasef_empty.mzML.tsv.log" || fail "ddaPASEF mzML: MS2 count is not $((ms2 - 5))"
grep -q "1 MGF blocks have no usable PEPMASS" "$TMP/dda.mgf.tsv.log" || fail "the block without PEPMASS is not warned about"

echo "mzml_to_mgf_test: all checks passed"
