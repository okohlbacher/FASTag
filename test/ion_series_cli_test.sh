#!/usr/bin/env bash
# #15 phase A (1.12): activation detection and the b/y warning, against the
# real binary.
#
# Fixtures are derived from the vendored Ecoli_MS2_small.mzML (139 CID MS2)
# at test time, so nothing is committed:
#   etd_all     every CID cvParam replaced by ETD (same byte length, so the
#               index stays exact);
#   etd_1/2     only the first 1 or 2 MS2 ETD (0.7% and 1.4%: the warning
#               threshold is "more than 1%");
#   ethcd_all   ETD plus the supplemental beam-type CID term (EThcD);
#   filter_etd  no activation term at all, the scan's filter string says
#               @etd (the filter-string fallback).
# Peaks are untouched, so tags must equal the source's in every case: phase A
# only counts and warns. The warning goes to stderr, never to stdout, and can
# never match gate.sh's summary-line pattern. The fast reader and
# OnDiscMSExperiment (used under -out_spectra) must give the same counts.
#
# Exits 77 (ctest SKIP) when the binary cannot start.
set -u
BIN="$1"
SRC="$2"   # Ecoli_MS2_small.mzML
MGF="$3"   # Ecoli_MS2_small.mgf

if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-ionseries-test.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
GATE_RE='^[0-9]+ MS2 spectra, [0-9]+ tags'
CID='accession="MS:1000133" name="collision-induced dissociation"'
ETD='accession="MS:1000598" name="electron transfer dissociation"'

# ---- fixtures ----
# The source has no final newline; out() keeps line breaks BETWEEN lines only,
# so a same-length edit keeps the file (and its index) byte-length equal.
OUT_FN='function out(l) { if (started) printf "\n"; printf "%s", l; started = 1 }'
# etd <k> <dst>: the first k CID terms (k < 0: all) replaced by ETD.
etd() {
  awk -v k="$1" -v cid="$CID" -v etd="$ETD" "$OUT_FN"'
    index($0, cid) { if (k < 0 || n < k) { i = index($0, cid); $0 = substr($0, 1, i - 1) etd substr($0, i + length(cid)) } n++ }
    { out($0) }' "$SRC" > "$2"
}
etd -1 "$TMP/etd_all.mzML"
etd 1 "$TMP/etd_1.mzML"
etd 2 "$TMP/etd_2.mzML"
awk -v cid="$CID" -v etd="$ETD" "$OUT_FN"'
  index($0, cid) { ind = substr($0, 1, index($0, "<") - 1)
                   out(ind "<cvParam cvRef=\"MS\" " etd " />")
                   out(ind "<cvParam cvRef=\"MS\" accession=\"MS:1002678\" name=\"supplemental beam-type collision-induced dissociation\" />")
                   next }
  { out($0) }' "$SRC" > "$TMP/ethcd_all.mzML"
awk -v cid="$CID" "$OUT_FN"'
  /<userParam name="filter string"/ { f = $0; sub(/.*value="/, "", f); sub(/".*/, "", f); gsub(/@cid/, "@etd", f); next }
  index($0, cid) { next }
  /<scan[ >]/ && f != "" { out($0); ind = substr($0, 1, index($0, "<") - 1)
                           out(ind "\t<cvParam cvRef=\"MS\" accession=\"MS:1000512\" name=\"filter string\" value=\"" f "\" />")
                           f = ""; next }
  { out($0) }' "$SRC" > "$TMP/filter_etd.mzML"

[ "$(wc -c < "$TMP/etd_all.mzML")" -eq "$(wc -c < "$SRC")" ] || fail "etd_all is not byte-length equal to the source"
[ "$(grep -c 'MS:1000598' "$TMP/etd_all.mzML")" -eq 139 ] || fail "etd_all: expected 139 ETD terms"
[ "$(grep -c 'MS:1000598' "$TMP/etd_2.mzML")" -eq 2 ] || fail "etd_2: expected 2 ETD terms"
[ "$(grep -c 'MS:1002678' "$TMP/ethcd_all.mzML")" -eq 139 ] || fail "ethcd_all: expected 139 supplemental terms"
[ "$(grep -c 'MS:1000133' "$TMP/filter_etd.mzML")" -eq 0 ] || fail "filter_etd still has CID terms"
[ "$(grep -c 'MS:1000512.*@etd' "$TMP/filter_etd.mzML")" -eq 139 ] || fail "filter_etd: expected 139 @etd filter strings"

# run <name> <input> <threads> [extra args]: stdout, stderr, tags and the
# warning line(s) under $TMP/<name>.*
run() {
  local name=$1 in=$2 th=$3; shift 3
  "$BIN" -in "$in" -out "$TMP/$name.tsv" -threads "$th" -fragment_tolerance 0.3 -fragment_tolerance_unit Da "$@" > "$TMP/$name.out" 2> "$TMP/$name.err" \
    || { cat "$TMP/$name.err" >&2; fail "FASTag on $name exited non-zero"; }
  grep '^Electron activation' "$TMP/$name.err" > "$TMP/$name.warn" || true
  grep -v 'took .* (wall)' "$TMP/$name.out" > "$TMP/$name.stdout"
}
nwarn() { wc -l < "$TMP/$1.warn" | tr -d ' '; }

run base "$SRC" 2
N=$(grep -oE "$GATE_RE" "$TMP/base.out" | head -1 | awk '{print $1}')
[ -n "$N" ] && [ "$N" -gt 0 ] || fail "no summary line on the source"
[ "$(wc -l < "$TMP/base.tsv")" -gt 100 ] || fail "too few tags on the source for a meaningful comparison"
[ "$(nwarn base)" -eq 0 ] || fail "CID source warns: $(cat "$TMP/base.warn")"

# ---- ETD under by: one warning naming ETD, on stderr only; tags unchanged ----
run etd_all "$TMP/etd_all.mzML" 2
[ "$(nwarn etd_all)" -eq 1 ] || { cat "$TMP/etd_all.err" >&2; fail "etd_all: expected exactly one activation warning"; }
grep -q 'ETD' "$TMP/etd_all.warn" || fail "the warning does not name ETD"
grep -q "^Electron activation: $N of $N MS2 spectra " "$TMP/etd_all.warn" || fail "etd_all: wrong counts: $(cat "$TMP/etd_all.warn")"
grep -q "0 collisional, $N electron, 0 hybrid, 0 unknown" "$TMP/etd_all.warn" || fail "etd_all: per-class counts"
grep -q 'Electron activation' "$TMP/etd_all.out" && fail "the warning reached stdout"
cmp -s "$TMP/base.tsv" "$TMP/etd_all.tsv" || fail "etd_all: tags differ from the CID source"
cmp -s "$TMP/base.stdout" "$TMP/etd_all.stdout" || { diff "$TMP/base.stdout" "$TMP/etd_all.stdout" >&2; fail "etd_all: stdout differs from the CID source"; }
grep -qE "$GATE_RE" "$TMP/etd_all.warn" && fail "the warning matches the gate summary pattern"
# gate.sh reads stdout and stderr together and takes the FIRST matching line.
cat "$TMP/etd_all.err" "$TMP/etd_all.out" | grep -m1 -E "$GATE_RE" > "$TMP/first1"
cat "$TMP/etd_all.out" "$TMP/etd_all.err" | grep -m1 -E "$GATE_RE" > "$TMP/first2"
grep -m1 -E "$GATE_RE" "$TMP/base.out" > "$TMP/first0"
cmp -s "$TMP/first0" "$TMP/first1" && cmp -s "$TMP/first0" "$TMP/first2" || fail "the gate summary line moved"

# ---- the threshold: more than 1% ----
run etd_1 "$TMP/etd_1.mzML" 2
[ "$(nwarn etd_1)" -eq 0 ] || fail "1 of $N ETD (<= 1%) warns"
run etd_2 "$TMP/etd_2.mzML" 2
[ "$(nwarn etd_2)" -eq 1 ] || fail "2 of $N ETD (> 1%) does not warn"
grep -q "^Electron activation: 2 of $N MS2 spectra " "$TMP/etd_2.warn" || fail "etd_2: wrong counts: $(cat "$TMP/etd_2.warn")"
grep -q "$((N - 2)) collisional, 2 electron, 0 hybrid, 0 unknown" "$TMP/etd_2.warn" || fail "etd_2: per-class counts"
cmp -s "$TMP/base.tsv" "$TMP/etd_2.tsv" || fail "etd_2: tags differ"

# ---- EThcD (ETD + supplemental beam-type CID) ----
run ethcd "$TMP/ethcd_all.mzML" 2
[ "$(nwarn ethcd)" -eq 1 ] || fail "ethcd_all does not warn"
grep -q 'EThcD' "$TMP/ethcd.warn" || fail "the hybrid warning does not name EThcD"
grep -q "0 collisional, 0 electron, $N hybrid, 0 unknown" "$TMP/ethcd.warn" || fail "ethcd: per-class counts: $(cat "$TMP/ethcd.warn")"
cmp -s "$TMP/base.tsv" "$TMP/ethcd.tsv" || fail "ethcd: tags differ"

# ---- filter-string fallback ----
run filter "$TMP/filter_etd.mzML" 2
[ "$(nwarn filter)" -eq 1 ] || fail "filter_etd does not warn"
grep -q "0 collisional, $N electron, 0 hybrid, 0 unknown" "$TMP/filter.warn" || fail "filter: per-class counts: $(cat "$TMP/filter.warn")"
cmp -s "$TMP/base.tsv" "$TMP/filter.tsv" || fail "filter_etd: tags differ"

# ---- MGF carries no activation: all unknown, no warning ----
run mgf "$MGF" 2
[ "$(nwarn mgf)" -eq 0 ] || fail "MGF warns"

# ---- OnDiscMSExperiment (-out_spectra) gives the same counts ----
for c in etd_all:etd_all ethcd_all:ethcd filter_etd:filter base_src:base; do
  f=${c%%:*}; ref=${c##*:}
  in="$TMP/$f.mzML"; [ "$f" = base_src ] && in="$SRC"
  run "od_$ref" "$in" 2 -out_spectra "$TMP/od_$ref.spectra.mzML"
  cmp -s "$TMP/$ref.warn" "$TMP/od_$ref.warn" || { diff "$TMP/$ref.warn" "$TMP/od_$ref.warn" >&2; fail "$ref: OnDisc and the fast reader disagree"; }
  cmp -s "$TMP/$ref.tsv" "$TMP/od_$ref.tsv" || fail "$ref: OnDisc tags differ"
done

# ---- threads ----
for th in 1 3 8; do
  run "etd_t$th" "$TMP/etd_all.mzML" "$th"
  cmp -s "$TMP/etd_all.warn" "$TMP/etd_t$th.warn" || fail "the warning differs at $th threads"
  cmp -s "$TMP/etd_all.tsv" "$TMP/etd_t$th.tsv" || fail "tags differ at $th threads"
done

echo "ion_series_cli_test: passed"
