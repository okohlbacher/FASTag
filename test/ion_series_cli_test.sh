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
# Phase B (-ion_series by|cz|auto), PLAN-data-types E9 CLI tests:
#   - -ion_series by (explicit) equals the option absent (and, with
#     FASTAG_BASELINE_BIN, FASTag 1.11.0) on every fixture; etd_all under by
#     keeps the WARN naming ETD (above);
#   - auto on etd_all writes the ion_series column, every row cz, one INFO
#     line on stderr, and the census best_ion_series column;
#   - auto on the CID source, the EThcD fixture and the MGF is byte-identical
#     to by (tags, stdout, census, recon); EThcD adds the hybrid WARN;
#   - cz on the CID source warns about collisional spectra;
#   - -species leaves c/z rows out and says how many, also under
#     -species_orientation both (its orientation counts exclude them);
#   - -stream refuses -ion_series away from by;
#   - auto through OnDisc (-out_spectra) equals the fast reader; threads 1/3/8;
#   - with #6: -ion_series auto -unknown_charge infer on uncharged ETD spectra
#     is identical at 1/3/8 threads, ion_series after #6's columns;
#   - with F11B (argument 9, census_ids_test): -census_ids under cz and auto
#     joins after best_ion_series (identified, triage last).
#
# Exits 77 (ctest SKIP) when the binary cannot start.
set -u
BIN="$1"
SRC="$2"   # Ecoli_MS2_small.mzML
MGF="$3"   # Ecoli_MS2_small.mgf
DB="${4:-}"          # Ecoli_MS2_small.fasta (phase B recon and species checks)
BUILDTAXDB="${5:-}"  # buildtaxdb (phase B species check)
TAXDIR="${6:-}"      # data/taxonomy (phase B species check)
DIGDIR="${7:-}"      # data/digest (FASTAG_DIGEST_DIR for -digest_out/-label_out)
GEN="${8:-}"         # ion_series_test (writes the synthetic c/z and b/y runs)
[ -n "$DIGDIR" ] && export FASTAG_DIGEST_DIR="$DIGDIR"

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

# ================================================================ phase B
# runb <name> <input> <threads> [extra args]: like run, keeping every stderr
# line phase B adds.
runb() {
  local name=$1 in=$2 th=$3; shift 3
  "$BIN" -in "$in" -out "$TMP/$name.tsv" -threads "$th" -fragment_tolerance 0.3 -fragment_tolerance_unit Da "$@" > "$TMP/$name.out" 2> "$TMP/$name.err" \
    || { cat "$TMP/$name.err" >&2; fail "FASTag on $name exited non-zero"; }
  grep -v 'took .* (wall)' "$TMP/$name.out" > "$TMP/$name.stdout"
  grep -E '^(Electron activation|Hybrid activation|Collisional activation|Ion series)' "$TMP/$name.err" > "$TMP/$name.lines" || true
}
lastcol() { awk -F'\t' 'NR == 1 { print $NF; exit }' "$1"; }
valuesof() { awk -F'\t' 'NR > 1 { print $NF }' "$1" | sort -u | tr '\n' ' ' | sed 's/ $//'; }

# ---- by explicit == absent, on every fixture ----
for f in base_src:base etd_all:etd_all ethcd_all:ethcd filter_etd:filter; do
  src=${f%%:*}; ref=${f##*:}
  in="$TMP/$src.mzML"; [ "$src" = base_src ] && in="$SRC"
  runb "by_$ref" "$in" 2 -ion_series by
  cmp -s "$TMP/$ref.tsv" "$TMP/by_$ref.tsv" || fail "$ref: -ion_series by differs from the option absent"
  cmp -s "$TMP/$ref.stdout" "$TMP/by_$ref.stdout" || fail "$ref: stdout differs under -ion_series by"
  # Timings vary between runs: drop the wall-time lines, mask "(<s> s)".
  untimed() { grep -v 'took .* (wall)' "$1" | sed -E 's/\([0-9.]+ s\)/(T s)/g'; }
  cmp -s <(untimed "$TMP/$ref.err") <(untimed "$TMP/by_$ref.err") \
    || { diff "$TMP/$ref.err" "$TMP/by_$ref.err" >&2; fail "$ref: stderr differs under -ion_series by"; }
done
grep -q 'Ion series' "$TMP/by_etd_all.err" && fail "by prints the phase B INFO line"
grep -q 'ion_series' "$TMP/by_etd_all.tsv" && fail "by writes an ion_series column"
if [ -n "${FASTAG_BASELINE_BIN:-}" ]; then
  "$FASTAG_BASELINE_BIN" -in "$TMP/etd_all.mzML" -out "$TMP/v111_etd.tsv" -threads 2 -fragment_tolerance 0.3 \
    -fragment_tolerance_unit Da > /dev/null 2>&1 || fail "baseline binary failed on etd_all"
  cmp -s "$TMP/v111_etd.tsv" "$TMP/by_etd_all.tsv" || fail "etd_all under -ion_series by differs from $FASTAG_BASELINE_BIN"
elif [ "${FASTAG_BASELINE_REQUIRED:-0}" = 1 ]; then
  fail "FASTAG_BASELINE_REQUIRED=1 but FASTAG_BASELINE_BIN is not set"
fi

# ---- auto on the ETD fixture: c/z rows, INFO line, census column ----
runb auto_etd "$TMP/etd_all.mzML" 2 -ion_series auto -census -census_out "$TMP/auto_etd.census.tsv"
[ "$(lastcol "$TMP/auto_etd.tsv")" = ion_series ] || fail "auto on etd_all: no ion_series column (last: $(lastcol "$TMP/auto_etd.tsv"))"
[ "$(wc -l < "$TMP/auto_etd.tsv")" -gt 20 ] || fail "auto on etd_all: too few tags for a meaningful check"
[ "$(valuesof "$TMP/auto_etd.tsv")" = cz ] || fail "auto on etd_all: rows not all cz ($(valuesof "$TMP/auto_etd.tsv"))"
head -1 "$TMP/auto_etd.tsv" | tr -d '\r' | cmp -s - <(head -1 "$TMP/base.tsv" | tr -d '\r' | sed 's/$/\tion_series/') \
  || fail "auto on etd_all: the header is not the by header plus ion_series"
[ "$(awk -F'\t' '{ print NF }' "$TMP/auto_etd.tsv" | sort -u | wc -l)" -eq 1 ] || fail "auto on etd_all: ragged rows"
[ "$(grep -c '^Ion series (-ion_series auto): ' "$TMP/auto_etd.err")" -eq 1 ] || fail "auto on etd_all: expected one INFO line"
grep -q "^Ion series (-ion_series auto): $N MS2 spectra tagged as c/z-dot ions, 0 as b/y ions (activation: 0 collisional, $N electron, 0 hybrid, 0 unknown)" "$TMP/auto_etd.err" \
  || fail "auto on etd_all: INFO counts: $(grep '^Ion series' "$TMP/auto_etd.err")"
grep -q '^Electron activation' "$TMP/auto_etd.err" && fail "auto still prints the by-mode warning"
grep -qE 'Ion series|activation' "$TMP/auto_etd.out" && fail "a phase B line reached stdout"
grep -qE "$GATE_RE" "$TMP/auto_etd.lines" && fail "a phase B line matches the gate summary pattern"
cmp -s "$TMP/etd_all.tsv" "$TMP/auto_etd.tsv" && fail "auto on etd_all wrote the by tags"
[ "$(awk -F'\t' 'NR == 1 { print $NF; exit }' "$TMP/auto_etd.census.tsv")" = best_ion_series ] || fail "census: no best_ion_series column under auto"
[ "$(awk -F'\t' 'NR > 1 && $NF != "" { print $NF }' "$TMP/auto_etd.census.tsv" | sort -u)" = cz ] || fail "census: best tags not cz under auto"
# The digest of the same tags under cz equals auto (every spectrum electron).
runb cz_etd "$TMP/etd_all.mzML" 2 -ion_series cz
cmp -s "$TMP/auto_etd.tsv" "$TMP/cz_etd.tsv" || fail "etd_all: cz and auto differ although every spectrum is ETD"
grep -q '^Collisional activation' "$TMP/cz_etd.err" && fail "cz on an all-ETD run warns about collisional spectra"

# ---- auto on collisional, EThcD and MGF input: byte-identical to by ----
runb auto_cid "$SRC" 2 -ion_series auto
cmp -s "$TMP/base.tsv" "$TMP/auto_cid.tsv" || fail "CID under auto differs from by"
cmp -s "$TMP/base.stdout" "$TMP/auto_cid.stdout" || fail "CID under auto: stdout differs from by"
grep -q "^Ion series (-ion_series auto): 0 MS2 spectra tagged as c/z-dot ions, $N as b/y ions" "$TMP/auto_cid.err" || fail "CID under auto: INFO counts"
grep -qE '^(Hybrid|Collisional|Electron) activation' "$TMP/auto_cid.err" && fail "CID under auto warns"
runb auto_ethcd "$TMP/ethcd_all.mzML" 2 -ion_series auto
cmp -s "$TMP/base.tsv" "$TMP/auto_ethcd.tsv" || fail "EThcD under auto is not read as by"
[ "$(grep -c '^Hybrid activation' "$TMP/auto_ethcd.err")" -eq 1 ] || fail "EThcD under auto: no hybrid WARN"
grep -q "^Hybrid activation: $N of $N MS2 spectra .*EThcD" "$TMP/auto_ethcd.err" || fail "the hybrid WARN does not name EThcD and the counts"
runb auto_mgf "$MGF" 2 -ion_series auto
cmp -s "$TMP/mgf.tsv" "$TMP/auto_mgf.tsv" || fail "MGF under auto differs from by"
if [ -n "$DB" ]; then
  runb rby "$SRC" 2 -tag_length 4 -extension 1 -recon_fasta "$DB" -recon_out "$TMP/rby.recon.tsv" -census -census_out "$TMP/rby.census.tsv" \
    -digest_out "$TMP/rby.digest.tsv" -label_out "$TMP/rby.label.tsv" -massgap_out "$TMP/rby.massgap.tsv"
  runb rauto "$SRC" 2 -ion_series auto -tag_length 4 -extension 1 -recon_fasta "$DB" -recon_out "$TMP/rauto.recon.tsv" -census \
    -census_out "$TMP/rauto.census.tsv" -digest_out "$TMP/rauto.digest.tsv" -label_out "$TMP/rauto.label.tsv" \
    -massgap_out "$TMP/rauto.massgap.tsv"
  for o in tsv recon.tsv census.tsv digest.tsv label.tsv massgap.tsv; do
    cmp -s <(grep -v 'software_version\|^#' "$TMP/rby.$o") <(grep -v 'software_version\|^#' "$TMP/rauto.$o") \
      || fail "CID under auto: $o differs from by"
  done
  [ "$(wc -l < "$TMP/rby.recon.tsv")" -gt 1 ] || fail "no recon rows on the CID source; the check is weak"
  # c/z through every consumer: recon, digest, label and mass gap run on
  # the ETD copy (its peaks are CID, so few tags place).
  runb rcz "$TMP/etd_all.mzML" 2 -ion_series auto -recon_fasta "$DB" -recon_out "$TMP/rcz.recon.tsv" \
    -digest_out "$TMP/rcz.digest.tsv" -label_out "$TMP/rcz.label.tsv" -massgap_out "$TMP/rcz.massgap.tsv"
  for o in recon digest label massgap; do [ -s "$TMP/rcz.$o.tsv" ] || fail "auto on etd_all: no $o output"; done
  # #3g (D3cg) on integration: the alkylation call reads b/y tags only; a
  # counted c/z tag goes to alk_cys excluded.non_by and is not placed for it.
  if "$BIN" --helphelp 2>&1 | grep -qE '^ +-alkylation_out '; then
    alkv() { tr -d '\r' < "$1" | awk -F'\t' -v s="$2" -v k="$3" '$1 == s && $2 == k { print $3; exit }'; }
    runb alk_by "$SRC" 2 -recon_fasta "$DB" -alkylation_out "$TMP/alk_by.alk.tsv"
    [ "$(alkv "$TMP/alk_by.alk.tsv" alk_cys excluded.non_by)" = 0 ] || fail "#3g: excluded.non_by is not 0 under by"
    [ "$(alkv "$TMP/alk_by.alk.tsv" alk_run tags)" -gt 0 ] || fail "#3g: no alkylation tag under by; the check is weak"
    runb alk_cz "$TMP/etd_all.mzML" 2 -ion_series auto -recon_fasta "$DB" -alkylation_out "$TMP/alk_cz.alk.tsv"
    [ "$(alkv "$TMP/alk_cz.alk.tsv" alk_run tags)" = 0 ] || fail "#3g: c/z tags entered the alkylation call ($(alkv "$TMP/alk_cz.alk.tsv" alk_run tags))"
    [ "$(alkv "$TMP/alk_cz.alk.tsv" alk_cys excluded.non_by)" -gt 0 ] || fail "#3g: no c/z tag counted in excluded.non_by"
  else
    echo "ion_series_cli_test: -alkylation_out not in this binary; its c/z case is skipped"
  fi
fi

# ---- synthetic c/z (ETD) and b/y (CID) runs of the same 40 peptides ----
# Written by ion_series_test --write-mzml (OpenMS TheoreticalSpectrumGenerator).
# Under auto the ETD run must place its tags on the true peptides about as
# well as the CID run does under by, and far better than the ETD run under by.
if [ -n "$GEN" ] && [ -n "$DB" ]; then
  "$GEN" --write-mzml "$DB" "$TMP/syn_etd.mzML" cz > /dev/null || fail "writing the synthetic ETD run"
  "$GEN" --write-mzml "$DB" "$TMP/syn_cid.mzML" by > /dev/null || fail "writing the synthetic CID run"
  RX=(-recon_fasta "$DB" -tag_length 4 -extension 1 -fragment_tolerance 20 -fragment_tolerance_unit ppm)
  sruns() {  # name input mode
    runb "$1" "$2" 2 -ion_series "$3" "${RX[@]}" -recon_out "$TMP/$1.recon.tsv" -digest_out "$TMP/$1.digest.tsv" \
      -label_out "$TMP/$1.label.tsv" -massgap_out "$TMP/$1.massgap.tsv" -census -census_out "$TMP/$1.census.tsv"
  }
  sruns s_etd_auto "$TMP/syn_etd.mzML" auto
  sruns s_etd_by "$TMP/syn_etd.mzML" by
  sruns s_cid_by "$TMP/syn_cid.mzML" by
  sruns s_cid_auto "$TMP/syn_cid.mzML" auto
  # exact placements (both flanks match) per spectrum
  placed() { awk -F'\t' 'NR > 1 && $7 == "1" && $8 == "1" { print $1 }' "$1" | sort -u | wc -l | tr -d ' '; }
  pa=$(placed "$TMP/s_etd_auto.recon.tsv"); pb=$(placed "$TMP/s_etd_by.recon.tsv"); pc=$(placed "$TMP/s_cid_by.recon.tsv")
  echo "synthetic: spectra with an exact placement: ETD auto $pa, ETD by $pb, CID by $pc (of 40)"
  [ "$pc" -ge 30 ] || fail "synthetic CID under by: only $pc of 40 spectra place exactly (the fixture is weak)"
  [ "$pa" -ge $((pc * 3 / 4)) ] || fail "synthetic ETD under auto: $pa spectra place exactly, CID under by $pc"
  [ "$pa" -ge $((pb * 2 + 5)) ] || fail "synthetic ETD: auto ($pa) does not place far more spectra than by ($pb)"
  [ "$(valuesof "$TMP/s_etd_auto.tsv")" = cz ] || fail "synthetic ETD under auto: rows not all cz"
  for o in tsv recon.tsv digest.tsv label.tsv massgap.tsv census.tsv; do
    cmp -s "$TMP/s_cid_by.$o" "$TMP/s_cid_auto.$o" || fail "synthetic CID: auto differs from by in $o"
  done
  # Reversed c-derived placements exist and land on the true peptide.
  [ "$(awk -F'\t' 'NR > 1 && $6 == "1" && $7 == "1" && $8 == "1"' "$TMP/s_etd_auto.recon.tsv" | wc -l)" -gt 5 ] \
    || fail "synthetic ETD under auto: too few reversed (c-ion) exact placements"
  # The digest report calls the same protease from the c/z tags as from the
  # b/y tags (trypsin: K/R at P1).
  dcall() { awk -F'\t' '$1 == "call" && ($2 == "status" || $2 == "model") { printf "%s ", $3 }' "$1"; }
  dc=$(dcall "$TMP/s_cid_by.digest.tsv"); de=$(dcall "$TMP/s_etd_auto.digest.tsv")
  echo "synthetic digest call: CID by [$dc], ETD auto [$de], ETD by [$(dcall "$TMP/s_etd_by.digest.tsv")]"
  [ "$dc" = "call Trypsin " ] && [ "$dc" = "$de" ] || fail "synthetic: the digest call from c/z tags ($de) differs from b/y ($dc)"
  [ "$(dcall "$TMP/s_etd_by.digest.tsv")" != "$dc" ] || fail "synthetic: ETD read as b/y calls the protease too (the check is weak)"
  [ "$(grep -c '^Ion series (-ion_series auto): 40 MS2 spectra tagged as c/z-dot ions, 0 as b/y' "$TMP/s_etd_auto.err")" -eq 1 ] \
    || fail "synthetic ETD under auto: INFO counts"
  # With #6: the same ETD run without precursor charges under -unknown_charge
  # infer. A spectrum read as c/z-dot counts c/z-dot pairs (M + H + 2p) as
  # its charge evidence, so the selected charge is the true one (2 for even,
  # 3 for odd scan indices) for most spectra; b/y pairs would leave them at
  # the assumed 2.
  "$GEN" --write-mzml "$DB" "$TMP/syn_etd0.mzML" cz0 > /dev/null || fail "writing the uncharged synthetic ETD run"
  runb s_etd_inf "$TMP/syn_etd0.mzML" 2 -ion_series auto -unknown_charge infer "${RX[@]}"
  scol() { head -1 "$1" | tr '\t' '\n' | grep -nx -- "$2" | head -1 | cut -d: -f1; }
  pc_=$(scol "$TMP/s_etd_inf.tsv" prec_charge); se_=$(scol "$TMP/s_etd_inf.tsv" selected)
  [ -n "$pc_" ] && [ -n "$se_" ] || fail "synthetic infer: no #6 columns"
  right=$(awk -F'\t' -v pc="$pc_" -v se="$se_" 'NR > 1 && $se == "1" { s = $1; sub(/.*scan=/, "", s); want = (s % 2 == 1) ? 2 : 3
           if (!(s in seen)) { seen[s] = 1; if ($pc == want) n++ } } END { print n + 0 }' "$TMP/s_etd_inf.tsv")
  echo "synthetic ETD, no charges, auto + infer: $right of 40 spectra selected at their true charge"
  [ "$right" -ge 30 ] || fail "synthetic infer: only $right of 40 spectra at their true charge (c/z charge evidence)"

  # Issue T25: the czt25 run adds to each spectrum a 2+ isotope cluster below
  # the precursor cut whose 1+ equivalent (where the deisotoper moves it)
  # lies 150 Da above it. -dump_spectrum prints the peaks FASTag tags: under
  # cz none lies above the cut, under by (the 1.12 reference) the moved peak
  # does. The cut is the tagger's: neutral mass + proton + 1.5 Da.
  if grep -qE '^ +-dump_spectrum <nativeId>' <<< "$("$BIN" --helphelp 2>&1)"; then
    "$GEN" --write-mzml "$DB" "$TMP/syn_t25.mzML" czt25 6 > /dev/null || fail "writing the synthetic T25 run"
    above() {  # mode scan -> number of tagged peaks above the precursor cut
      "$BIN" -in "$TMP/syn_t25.mzML" -out "$TMP/t25.tsv" -ion_series "$1" -fragment_tolerance 0.3 \
        -fragment_tolerance_unit Da -dump_spectrum "controllerType=0 controllerNumber=1 scan=$2" > "$TMP/t25_$1_$2.json" \
        2> "$TMP/t25_$1_$2.err" || { cat "$TMP/t25_$1_$2.err" >&2; fail "T25: -dump_spectrum scan $2 under $1 exited non-zero"; }
      awk 'index($0, "\"spectrum\"") {
             p = $0; sub(/.*"precursor":/, "", p); sub(/[,}].*/, "", p)
             c = $0; sub(/.*"charge":/, "", c); sub(/[,}].*/, "", c)
             m = $0; sub(/.*"mz":\[/, "", m); sub(/\].*/, "", m)
             cut = p * c - (c - 1) * 1.007276466812 + 1.5
             n = split(m, v, ","); k = 0
             for (i = 1; i <= n; i++) if (v[i] + 0 > cut) k++
             print k; found = 1 }
           END { if (!found) print "none" }' "$TMP/t25_$1_$2.json"
    }
    for sc in 1 2 3 4 5 6; do
      a_cz=$(above cz "$sc"); a_by=$(above by "$sc")
      [ "$a_by" != none ] && [ "$a_by" -ge 1 ] || fail "T25 scan $sc: by keeps no peak above the cut ($a_by; the fixture does not trigger T25)"
      [ "$a_cz" = 0 ] || fail "T25 scan $sc: cz keeps $a_cz peak(s) above the precursor cut"
    done
    echo "ion_series_cli_test: T25, cz tags no moved peak above the precursor cut (6 spectra, 2+ and 3+)"
  else
    echo "ion_series_cli_test: -dump_spectrum not in this binary; the T25 case is skipped"
  fi
fi

# ---- cz on collisional spectra: the WARN ----
runb cz_cid "$SRC" 2 -ion_series cz
[ "$(lastcol "$TMP/cz_cid.tsv")" = ion_series ] || fail "cz always writes the ion_series column"
[ "$(grep -c '^Collisional activation' "$TMP/cz_cid.err")" -eq 1 ] || fail "cz on CID: no collisional WARN"
grep -q "^Collisional activation: $N of $N MS2 spectra" "$TMP/cz_cid.err" || fail "cz on CID: WARN counts"

# ---- -species counts b/y tags only ----
# On the synthetic runs at -tag_length 5 -extension 1 (the toy index's k = 7).
if [ -n "$BUILDTAXDB" ] && [ -n "$TAXDIR" ] && [ -n "$DB" ] && [ -n "$GEN" ]; then
  mkdir -p "$TMP/prot"
  awk '/^>/ { if (s != "") print s; print; s = ""; next } { s = s $0 } END { if (s != "") print s }' "$DB" > "$TMP/prot/562.fasta"
  "$BUILDTAXDB" "$TMP/prot" "$TMP/toy.taxdb" 7 > "$TMP/buildtaxdb.log" 2>&1 || { cat "$TMP/buildtaxdb.log" >&2; fail "buildtaxdb"; }
  TAX=(-species -taxdb "$TMP/toy.taxdb" -taxonomy_nodes "$TAXDIR/nodes.dmp" -taxonomy_names "$TAXDIR/names.dmp")
  SP=(-tag_length 5 -extension 1 -fragment_tolerance 20 -fragment_tolerance_unit ppm "${TAX[@]}")
  runb sp_by "$TMP/syn_cid.mzML" 2 "${SP[@]}"
  runb sp_cz "$TMP/syn_etd.mzML" 2 -ion_series cz "${SP[@]}"
  grep -q 'left out of -species' "$TMP/sp_by.err" && fail "by excludes rows from -species"
  rows=$(($(wc -l < "$TMP/sp_cz.tsv") - 1))
  [ "$rows" -gt 0 ] || fail "species: no c/z rows"
  grep -q "^Ion series: $rows tag rows read as c/z-dot ions were left out of -species" "$TMP/sp_cz.err" \
    || { grep 'species' "$TMP/sp_cz.err" >&2; fail "species: the exclusion count is not the c/z row count ($rows)"; }
  [ "$(wc -l < "$TMP/sp_by.species.tsv")" -ge 2 ] || fail "species: the b/y run reports no taxon (the check is weak)"
  # D10 under -species_orientation both: the c/z rows are left out before
  # the orientation lookup, so on the all-c/z run every orientation count is
  # 0 and the exclusion count is the c/z row count; the b/y run counts tags.
  if grep -q -- '-species_orientation' <<< "$("$BIN" --helphelp 2>&1)"; then
    orient() { grep '^Species orientation (both): ' "$1" | sed -E 's/[^0-9]+/ /g; s/^ //; s/ $//'; }
    runb spb_by "$TMP/syn_cid.mzML" 2 "${SP[@]}" -species_orientation both
    runb spb_cz "$TMP/syn_etd.mzML" 2 -ion_series cz "${SP[@]}" -species_orientation both
    grep -q "^Ion series: $rows tag rows read as c/z-dot ions were left out of -species" "$TMP/spb_cz.err" \
      || { grep 'species' "$TMP/spb_cz.err" >&2; fail "species both: the exclusion count is not the c/z row count ($rows)"; }
    [ "$(orient "$TMP/spb_cz.err")" = "0 0 0 0 0" ] \
      || { grep 'orientation' "$TMP/spb_cz.err" >&2; fail "species both: the orientation counts include c/z rows"; }
    read -r o1 o2 o3 o4 o5 o6 <<< "$(orient "$TMP/spb_by.err")"
    [ -n "$o5" ] && [ -z "$o6" ] && [ $((o1 + o2 + o3 + o4 + o5)) -gt 0 ] \
      || { grep 'orientation' "$TMP/spb_by.err" >&2; fail "species both: the b/y run counts no tags (the check is weak)"; }
    grep -q 'left out of -species' "$TMP/spb_by.err" && fail "species both: by excludes rows from -species"
  fi
fi

# ---- -stream refuses -ion_series away from by ----
if "$BIN" -in "$SRC" -out "$TMP/st.tsv" -stream -ion_series auto > "$TMP/st.out" 2> "$TMP/st.err"; then
  fail "-stream accepted -ion_series auto"
fi
grep -q 'ion_series' "$TMP/st.out" "$TMP/st.err" || fail "the -stream refusal does not name -ion_series"
"$BIN" -in "$SRC" -out "$TMP/st_by.tsv" -stream -ion_series by -fragment_tolerance 0.3 -fragment_tolerance_unit Da > /dev/null 2>&1 \
  || fail "-stream refuses -ion_series by (the default)"

# ---- OnDisc (-out_spectra) and threads ----
runb od_auto "$TMP/etd_all.mzML" 2 -ion_series auto -out_spectra "$TMP/od_auto.spectra.mzML"
cmp -s "$TMP/auto_etd.tsv" "$TMP/od_auto.tsv" || fail "auto: OnDisc and the fast reader tag differently"
cmp -s <(grep '^Ion series' "$TMP/auto_etd.err") <(grep '^Ion series' "$TMP/od_auto.err") || fail "auto: OnDisc INFO differs"
for th in 1 3 8; do
  runb "auto_t$th" "$TMP/etd_all.mzML" "$th" -ion_series auto -census -census_out "$TMP/auto_t$th.census.tsv"
  cmp -s "$TMP/auto_etd.tsv" "$TMP/auto_t$th.tsv" || fail "auto: tags differ at $th threads"
  cmp -s "$TMP/auto_etd.census.tsv" "$TMP/auto_t$th.census.tsv" || fail "auto: census differs at $th threads"
  cmp -s "$TMP/auto_etd.lines" "$TMP/auto_t$th.lines" || fail "auto: INFO/WARN lines differ at $th threads"
done

# ---- with #6: -ion_series auto -unknown_charge infer, threads 1/3/8 ----
# etd_all with every charge state replaced by a userParam of the same length
# (the index stays exact): no precursor carries a charge, so infer runs.
awk "$OUT_FN"'
  /accession="MS:1000041"/ { i = index($0, "<cvParam"); j = index($0, "/>"); old = substr($0, i, j + 2 - i)
                             v = old; sub(/.*value="/, "", v); sub(/".*/, "", v)
                             nw = "<userParam name=\"zz\" value=\"" v "\""
                             while (length(nw) < length(old) - 2) nw = nw " "
                             $0 = substr($0, 1, i - 1) nw "/>" substr($0, j + 2) }
  { out($0) }' "$TMP/etd_all.mzML" > "$TMP/etd_noz.mzML"
[ "$(wc -c < "$TMP/etd_noz.mzML")" -eq "$(wc -c < "$SRC")" ] || fail "etd_noz is not byte-length equal to the source"
[ "$(grep -c 'MS:1000041' "$TMP/etd_noz.mzML")" -eq 0 ] || fail "etd_noz still has charge states"
for th in 1 3 8; do
  runb "inf_t$th" "$TMP/etd_noz.mzML" "$th" -ion_series auto -unknown_charge infer -census -census_out "$TMP/inf_t$th.census.tsv"
done
col() { head -1 "$1" | tr '\t' '\n' | grep -nx -- "$2" | head -1 | cut -d: -f1; }
[ "$(lastcol "$TMP/inf_t1.tsv")" = ion_series ] || fail "auto + infer: ion_series is not the last column"
[ -n "$(col "$TMP/inf_t1.tsv" selected)" ] && [ "$(col "$TMP/inf_t1.tsv" selected)" -lt "$(col "$TMP/inf_t1.tsv" ion_series)" ] \
  || fail "auto + infer: ion_series does not follow #6's columns"
[ "$(valuesof "$TMP/inf_t1.tsv")" = cz ] || fail "auto + infer: rows not all cz"
cs=$(col "$TMP/inf_t1.tsv" charge_src)
awk -F'\t' -v c="$cs" 'NR > 1 { print $c }' "$TMP/inf_t1.tsv" | grep -qx 'inferred\|ambiguous' \
  || fail "auto + infer: no row at an inferred charge (the construct is vacuous)"
for th in 3 8; do
  cmp -s "$TMP/inf_t1.tsv" "$TMP/inf_t$th.tsv" || fail "auto + infer: tags differ at $th threads"
  cmp -s "$TMP/inf_t1.census.tsv" "$TMP/inf_t$th.census.tsv" || fail "auto + infer: census differs at $th threads"
  cmp -s "$TMP/inf_t1.lines" "$TMP/inf_t$th.lines" || fail "auto + infer: INFO/WARN lines differ at $th threads"
done
echo "ion_series_cli_test: -ion_series auto -unknown_charge infer identical at 1/3/8 threads"

# ---- with #11 phase B (-census_ids, F11B) once merged ----
# -census_ids takes Census::header() as the table's layout; the run-level
# header carries best_ion_series, so identified and triage follow it.
IDS_HELPER="${9:-}"   # census_ids_test (F11B); empty before F11B
if [ -n "$IDS_HELPER" ] && grep -q -- '-census_ids' <<< "$("$BIN" --helphelp 2>&1)"; then
  "$IDS_HELPER" --write-ids "$SRC" "$TMP/good.idXML" good "$TMP/good.want" > /dev/null || fail "census_ids_test --write-ids"
  for c in "cz:$SRC" "auto:$TMP/etd_all.mzML"; do
    m=${c%%:*}; in=${c#*:}
    runb "ids_$m" "$in" 2 -ion_series "$m" -census -census_out "$TMP/ids_$m.census.tsv" -census_ids "$TMP/good.idXML"
    h=$(head -1 "$TMP/ids_$m.census.tsv" | tr '\t' '\n' | tail -3 | tr '\n' ' ')
    [ "$h" = "best_ion_series identified triage " ] || fail "-census_ids under -ion_series $m: header ends with '$h'"
    nf=$(head -1 "$TMP/ids_$m.census.tsv" | awk -F'\t' '{ print NF }')
    awk -F'\t' -v n="$nf" 'NF != n { exit 1 }' "$TMP/ids_$m.census.tsv" || fail "-census_ids under -ion_series $m: a row has not $nf fields"
    [ "$(awk -F'\t' 'NR > 1 && $(NF - 1) == "1"' "$TMP/ids_$m.census.tsv" | wc -l)" -gt 0 ] \
      || fail "-census_ids under -ion_series $m: nothing identified"
  done
  echo "ion_series_cli_test: -census_ids joins the c/z census (best_ion_series, identified, triage)"
else
  echo "ion_series_cli_test: -census_ids not in this binary; its c/z case is skipped"
fi

echo "ion_series_cli_test: passed"
