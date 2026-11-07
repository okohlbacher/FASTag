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
#   - -species leaves c/z rows out and says how many;
#   - -stream refuses -ion_series away from by;
#   - auto through OnDisc (-out_spectra) equals the fast reader; threads 1/3/8.
#
# Exits 77 (ctest SKIP) when the binary cannot start.
set -u
BIN="$1"
SRC="$2"   # Ecoli_MS2_small.mzML
MGF="$3"   # Ecoli_MS2_small.mgf
DB="${4:-}"          # Ecoli_MS2_small.fasta (phase B recon and species checks)
BUILDTAXDB="${5:-}"  # buildtaxdb (phase B species check)
TAXDIR="${6:-}"      # data/taxonomy (phase B species check)

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
  cmp -s <(grep -v 'took .* (wall)' "$TMP/$ref.err") <(grep -v 'took .* (wall)' "$TMP/by_$ref.err") \
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
head -1 "$TMP/auto_etd.tsv" | cmp -s - <(head -1 "$TMP/base.tsv" | sed 's/$/\tion_series/') \
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
  runb rby "$SRC" 2 -recon_fasta "$DB" -recon_out "$TMP/rby.recon.tsv" -census -census_out "$TMP/rby.census.tsv" \
    -digest_out "$TMP/rby.digest.tsv" -label_out "$TMP/rby.label.tsv" -massgap_out "$TMP/rby.massgap.tsv"
  runb rauto "$SRC" 2 -ion_series auto -recon_fasta "$DB" -recon_out "$TMP/rauto.recon.tsv" -census \
    -census_out "$TMP/rauto.census.tsv" -digest_out "$TMP/rauto.digest.tsv" -label_out "$TMP/rauto.label.tsv" \
    -massgap_out "$TMP/rauto.massgap.tsv"
  for o in tsv recon.tsv census.tsv digest.tsv label.tsv massgap.tsv; do
    cmp -s <(grep -v 'software_version\|^#' "$TMP/rby.$o") <(grep -v 'software_version\|^#' "$TMP/rauto.$o") \
      || fail "CID under auto: $o differs from by"
  done
  [ "$(wc -l < "$TMP/rby.recon.tsv")" -gt 1 ] || fail "no recon rows on the CID source; the check is weak"
  # c/z through every consumer: recon, digest, label and mass gap run; a c/z
  # placement exists (the ETD fixture's peaks are CID, so few place).
  runb rcz "$TMP/etd_all.mzML" 2 -ion_series auto -recon_fasta "$DB" -recon_out "$TMP/rcz.recon.tsv" \
    -digest_out "$TMP/rcz.digest.tsv" -label_out "$TMP/rcz.label.tsv" -massgap_out "$TMP/rcz.massgap.tsv"
  for o in recon digest label massgap; do [ -s "$TMP/rcz.$o.tsv" ] || fail "auto on etd_all: no $o output"; done
fi

# ---- cz on collisional spectra: the WARN ----
runb cz_cid "$SRC" 2 -ion_series cz
[ "$(lastcol "$TMP/cz_cid.tsv")" = ion_series ] || fail "cz always writes the ion_series column"
[ "$(grep -c '^Collisional activation' "$TMP/cz_cid.err")" -eq 1 ] || fail "cz on CID: no collisional WARN"
grep -q "^Collisional activation: $N of $N MS2 spectra" "$TMP/cz_cid.err" || fail "cz on CID: WARN counts"

# ---- -species counts b/y tags only ----
if [ -n "$BUILDTAXDB" ] && [ -n "$TAXDIR" ] && [ -n "$DB" ]; then
  mkdir -p "$TMP/prot"
  awk '/^>/ { if (s != "") print s; print; s = ""; next } { s = s $0 } END { if (s != "") print s }' "$DB" > "$TMP/prot/562.fasta"
  "$BUILDTAXDB" "$TMP/prot" "$TMP/toy.taxdb" 7 > "$TMP/buildtaxdb.log" 2>&1 || { cat "$TMP/buildtaxdb.log" >&2; fail "buildtaxdb"; }
  TAX=(-species -taxdb "$TMP/toy.taxdb" -taxonomy_nodes "$TAXDIR/nodes.dmp" -taxonomy_names "$TAXDIR/names.dmp")
  runb sp_by "$TMP/etd_all.mzML" 2 "${TAX[@]}"
  runb sp_cz "$TMP/etd_all.mzML" 2 -ion_series cz "${TAX[@]}"
  grep -q 'left out of -species' "$TMP/sp_by.err" && fail "by excludes rows from -species"
  rows=$(($(wc -l < "$TMP/sp_cz.tsv") - 1))
  [ "$rows" -gt 0 ] || fail "species: no c/z rows"
  grep -q "^Ion series: $rows tag rows read as c/z-dot ions were left out of -species" "$TMP/sp_cz.err" \
    || { grep 'species' "$TMP/sp_cz.err" >&2; fail "species: the exclusion count is not the c/z row count ($rows)"; }
  [ -s "$TMP/sp_by.species.tsv" ] || fail "species: no b/y species report"
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

echo "ion_series_cli_test: passed"
