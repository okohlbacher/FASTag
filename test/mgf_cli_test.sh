#!/usr/bin/env bash
# MGF input against the real binary. The fixture MGF was written from the
# fixture mzML by tools/mzml_to_mgf.py (exact peaks, RT by unit), so:
#   a. every TSV equals the mzML run's once column 1 is cut, and column 1 is
#      index=<k> for the k-th MS2 (default, -fasta/-recon_out/-glyco/
#      -proforma/-res_conf/-delta_out, -tag_lengths)
#   b. 1, 3 and 8 threads write byte-identical outputs
#   c. -out_spectra .mzML / .mzpeak from the MGF re-tag to the same TSV, id
#      column included; the mzML names the MGF as its source (MS:1000774,
#      Mascot MGF format), keeps TITLE, and keeps the MGF's RTs
#   d. -usi_collection: the run is the file name WITH .mgf; scan:<n> from
#      SCANS, index:<k> without
#   e. -recon_id_out .mzid: SpectraData is an MGF, references index=<k>, RTs
#      equal the mzML run's
#   f. -digest_out: instrument, scan window, timsTOF and ion mobility absent
#   g. charge-less MGF = charge-less mzML; CHARGE=2+ and 3+ = no CHARGE
#   h. errors: compressed, empty, truncated, bad peak, bad CHARGE, -out_spectra = -in
#   i. subsampling is deterministic and a subset of the full run
#   j. regressions: a bad block outside the tolerance probe leaves no partial
#      report; a lost BEGIN IONS is warned about; SCANS with a control byte
#      and RTINSECONDS=nan give a well-formed, re-readable -out_spectra; a
#      malformed first peak line is an error; -out_spectra carries the MGF's
#      SHA-1; a header CHARGE= is warned about only when a block lacks one
#   k. -proforma declares fixed residue modifications only: a terminal fixed
#      modification is in the flanking masses, not in the prefix
# Exits 77 (ctest SKIP) when the binary cannot start.
set -u
BIN="$1"
MZML="$2"
MGF="$3"
DB="$4"
DATA="$5"   # data/digest
if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi
export FASTAG_DIGEST_DIR="$DATA"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-mgf-cli.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
ARGS=(-tag_length 4 -extension 1 -fragment_tolerance 0.3 -fragment_tolerance_unit Da -threads 2)
run() {  # run <log> <args...>: must exit 0
  local log="$1"; shift
  "$BIN" "$@" >"$log" 2>&1 || { cat "$log" >&2; fail "run failed: $*"; }
}
same_body() {  # same_body <a.tsv> <b.tsv> <what>: equal once column 1 is cut
  [ "$(wc -l < "$1")" -gt 1 ] || fail "$3: no rows; the check would prove nothing"
  cmp -s <(cut -f2- "$1") <(cut -f2- "$2") || { diff <(cut -f2- "$1") <(cut -f2- "$2") | head >&2; fail "$3 differs between mzML and MGF"; }
}

# The k-th MS2 of the mzML is block k. Every fixture spectrum is MS2.
grep -o '<spectrum id="[^"]*"' "$MZML" | sed 's/<spectrum id="//; s/"$//' | awk '{print $0 "\tindex=" NR-1}' > "$TMP/ids.map"
[ "$(wc -l < "$TMP/ids.map")" -eq "$(grep -c '^BEGIN IONS' "$MGF")" ] || fail "fixture: mzML and MGF hold different spectrum counts"

# ---- a. equivalence
for variant in plain full lengths; do
  for fmt in mzML mgf; do
    d="$TMP/a_${variant}_$fmt"; mkdir -p "$d"
    in=$MZML; [ $fmt = mgf ] && in=$MGF
    case $variant in
      plain)   run "$d/log" -in "$in" -out "$d/tags.tsv" "${ARGS[@]}" ;;
      full)    run "$d/log" -in "$in" -out "$d/tags.tsv" "${ARGS[@]}" -fasta "$DB" -recon_out "$d/recon.tsv" \
                   -glyco -glyco_out "$d/glyco.tsv" -proforma -res_conf -delta_out "$d/delta.tsv" ;;
      lengths) run "$d/log" -in "$in" -out "$d/tags.tsv" "${ARGS[@]}" -tag_lengths 3 4 ;;
    esac
  done
  m="$TMP/a_${variant}_mzML"; g="$TMP/a_${variant}_mgf"
  same_body "$m/tags.tsv" "$g/tags.tsv" "tags.tsv ($variant)"
  if [ $variant = full ]; then
    same_body "$m/recon.tsv" "$g/recon.tsv" "recon.tsv"
    same_body "$m/glyco.tsv" "$g/glyco.tsv" "glyco.tsv"
    cmp -s "$m/delta.tsv" "$g/delta.tsv" || fail "delta.tsv differs between mzML and MGF"
  fi
  # Column 1: the MGF id is index=<k> of the mzML row's spectrum.
  paste <(cut -f1 "$m/tags.tsv" | tail -n +2) <(cut -f1 "$g/tags.tsv" | tail -n +2) \
    | awk -F'\t' 'NR==FNR {k[$1]=$2; next} k[$1] != $2 {bad=1; print "row " FNR ": " $1 " -> " $2 > "/dev/stderr"} END {exit bad}' "$TMP/ids.map" - \
    || fail "MGF column 1 is not index=<MS2 ordinal> ($variant)"
  head -1 "$g/tags.tsv" | cmp -s - <(head -1 "$m/tags.tsv") || fail "header differs ($variant)"
done
grep -q "MS2 spectra" "$TMP/a_plain_mgf/log" || fail "no summary line on MGF"
[ "$(grep -o '[0-9]* MS2 spectra, [0-9]* tags' "$TMP/a_plain_mgf/log")" = "$(grep -o '[0-9]* MS2 spectra, [0-9]* tags' "$TMP/a_plain_mzML/log")" ] \
  || fail "MS2 and tag counts differ between mzML and MGF"

# ---- b. thread counts
OUTS=(tags recon delta digest label massgap glyco)
for t in 1 3 8; do
  d="$TMP/b$t"; mkdir -p "$d"
  run "$d/log" -in "$MGF" -out "$d/tags.tsv" -threads "$t" \
    -tag_length 4 -extension 1 -fragment_tolerance 0.3 -fragment_tolerance_unit Da \
    -fasta "$DB" -recon_out "$d/recon.tsv" -delta_out "$d/delta.tsv" \
    -digest_out "$d/digest.tsv" -label_out "$d/label.tsv" -massgap_out "$d/massgap.tsv" \
    -glyco -glyco_out "$d/glyco.tsv"
done
for f in "${OUTS[@]}"; do
  [ "$(wc -l < "$TMP/b1/$f.tsv")" -gt 1 ] || fail "$f.tsv has no rows at -threads 1"
  for t in 3 8; do cmp -s "$TMP/b1/$f.tsv" "$TMP/b$t/$f.tsv" || fail "$f.tsv differs between -threads 1 and $t on MGF"; done
done

# ---- c. -out_spectra round trip
c="$TMP/c"; mkdir -p "$c"
run "$c/log" -in "$MGF" -out "$c/tags.tsv" -out_spectra "$c/kept.mzML" "${ARGS[@]}"
run "$c/log2" -in "$c/kept.mzML" -out "$c/again.tsv" "${ARGS[@]}"
cmp -s "$c/tags.tsv" "$c/again.tsv" || fail "MGF -> -out_spectra mzML -> tags differs (id column included)"
grep -q 'accession="MS:1000774"' "$c/kept.mzML" || fail "the written mzML does not declare MS:1000774"
grep -q 'name="Mascot MGF format"' "$c/kept.mzML" || fail "the written mzML does not name the MGF format"
grep -q 'name="Ecoli_MS2_small.mgf"' "$c/kept.mzML" || fail "the written mzML does not name the MGF as source"
grep -q '<userParam name="TITLE"' "$c/kept.mzML" || fail "the written mzML lost the TITLEs"
# RTs: each written spectrum keeps its block's RTINSECONDS.
awk '/^BEGIN IONS/ {k++} /^RTINSECONDS=/ {sub(/RTINSECONDS=/, ""); print "index=" k-1 "\t" $0}' "$MGF" > "$TMP/rt.mgf"
awk '/<spectrum / {match($0, /id="[^"]*"/); id=substr($0, RSTART+4, RLENGTH-5)}
     /MS:1000016/ {match($0, /value="[^"]*"/); print id "\t" substr($0, RSTART+7, RLENGTH-8)}' "$c/kept.mzML" > "$TMP/rt.kept"
[ "$(wc -l < "$TMP/rt.kept")" -gt 0 ] || fail "no RT in the written mzML"
awk -F'\t' 'NR==FNR {rt[$1]=$2; next} !($1 in rt) || (rt[$1]+0) != ($2+0) {bad=1; print $1 ": " rt[$1] " vs " $2 > "/dev/stderr"} END {exit bad}' \
  "$TMP/rt.mgf" "$TMP/rt.kept" || fail "the written mzML changed an RT"
if "$BIN" -in "$MGF" -out "$c/tags2.tsv" -out_spectra "$c/kept.mzpeak" "${ARGS[@]}" >"$c/log3" 2>&1; then
  run "$c/log4" -in "$c/kept.mzpeak" -out "$c/again2.tsv" "${ARGS[@]}"
  cmp -s "$c/tags.tsv" "$c/again2.tsv" || fail "MGF -> -out_spectra mzpeak -> tags differs"
else
  grep -q "no mzPeak support" "$c/log3" || { cat "$c/log3" >&2; fail "-out_spectra .mzpeak from MGF failed"; }
fi

# ---- d. USI
d="$TMP/d"; mkdir -p "$d"
run "$d/log" -in "$MGF" -out "$d/tags.tsv" -usi_collection USI000000 "${ARGS[@]}"
tail -n +2 "$d/tags.tsv" | awk -F'\t' '$NF !~ /^mzspec:USI000000:Ecoli_MS2_small\.mgf:scan:[0-9]+$/ {bad=1} END {exit bad}' \
  || fail "USI on MGF with SCANS is not mzspec:USI000000:Ecoli_MS2_small.mgf:scan:<n>"
paste <(cut -f1 "$d/tags.tsv") <(awk -F'\t' '{print $NF}' "$d/tags.tsv") | tail -n +2 | head -1 | grep -q $'^index=0\tmzspec:USI000000:Ecoli_MS2_small.mgf:scan:11461$' \
  || fail "the first tag's USI does not name scan 11461"
grep -v '^SCANS=' "$MGF" > "$d/noscans.mgf"
run "$d/log2" -in "$d/noscans.mgf" -out "$d/tags2.tsv" -usi_collection USI000000 "${ARGS[@]}"
tail -n +2 "$d/tags2.tsv" | awk -F'\t' '{split($1, a, "="); if ($NF != "mzspec:USI000000:noscans.mgf:index:" a[2]) bad=1} END {exit bad}' \
  || fail "USI on MGF without SCANS is not index:<k>"

# ---- e. -recon_id_out .mzid
e="$TMP/e"; mkdir -p "$e"
for fmt in mzML mgf; do
  in=$MZML; [ $fmt = mgf ] && in=$MGF
  run "$e/$fmt.log" -in "$in" -out "$e/$fmt.tsv" -fasta "$DB" -recon_out "$e/$fmt.recon.tsv" -recon_id_out "$e/$fmt.mzid" "${ARGS[@]}"
done
grep -q '<SpectrumIdentificationItem' "$e/mgf.mzid" || fail "no identifications in the MGF run's mzid"
grep -A3 '<SpectraData' "$e/mgf.mzid" | grep -q 'Mascot MGF format' || fail "mzid SpectraData is not Mascot MGF format"
grep -A6 '<SpectraData' "$e/mgf.mzid" | grep -q 'MS:1000774' || fail "mzid SpectraData is not MS:1000774"
grep -o 'spectrumID="[^"]*"' "$e/mgf.mzid" | grep -qv 'spectrumID="index=[0-9]*"' && fail "mzid references other than index=<k>"
rts() { grep 'name="retention time"' "$1" | grep -o 'value="[^"]*"'; }
[ -n "$(rts "$e/mgf.mzid")" ] || fail "no retention times in the MGF run's mzid"
cmp -s <(rts "$e/mzML.mzid") <(rts "$e/mgf.mzid") || fail "mzid retention times differ between mzML and MGF"

# ---- f. -digest_out
f="$TMP/f"; mkdir -p "$f"
run "$f/log" -in "$MGF" -out "$f/tags.tsv" -digest_out "$f/digest.tsv" "${ARGS[@]}"
grep -q "could not read the run header" "$f/log" && fail "-digest_out tried to read an MGF as mzML"
row() { awk -F'\t' -v s="$1" -v k="$2" '$1==s && $2==k {print $3}' "$f/digest.tsv"; }
[ "$(row meta instrument)" = "-" ] || fail "digest instrument is not '-' on MGF"
[ "$(row meta ion_mobility)" = "absent" ] || fail "digest ion_mobility is not 'absent' on MGF"
[ "$(row nocall timstof)" = "unknown" ] || fail "digest timstof is not 'unknown' on MGF"
[ "$(row nocall ms2_scan_window)" = "unknown" ] || fail "digest ms2_scan_window is not 'unknown' on MGF"
[ "$(row meta ms2_first_peak_mz)" != "-" ] || fail "digest ms2_first_peak_mz missing on MGF"
# ion_counts: the fixture's intensities are not whole numbers, so the rule
# stays off; the same MGF with whole-number intensities (ion counts, as
# timsTOF data) is withheld, as its mzML would be by timstof.
[ "$(row nocall ion_counts)" = "no" ] || fail "digest ion_counts is not 'no' on the fixture MGF"
awk '/^[0-9]/ {printf "%s %d\n", $1, $2 + 0.5; next} {print}' "$MGF" > "$f/counts.mgf"
run "$f/log2" -in "$f/counts.mgf" -out "$f/tags2.tsv" -digest_out "$f/counts.tsv" "${ARGS[@]}"
crow() { awk -F'\t' -v s="$1" -v k="$2" '$1==s && $2==k {print $3}' "$f/counts.tsv"; }
[ "$(crow meta ms2_whole_intensity_share)" = "1" ] || fail "whole-number MGF: whole-intensity share is not 1"
[ "$(crow nocall ion_counts)" = "yes" ] || fail "whole-number MGF: ion_counts did not fire"
[ "$(crow call status)" = "no_call" ] || fail "whole-number MGF: a protease call was made"
# Zero-intensity peaks (profile data, padding) carry no ion count: two of them
# after every peak leave the share and the rule as on the fixture.
awk '/^[0-9]/ {print; printf "%.6f 0\n%.6f 0\n", $1 + 0.001, $1 + 0.002; next} {print}' "$MGF" > "$f/zeros.mgf"
run "$f/log6" -in "$f/zeros.mgf" -out "$f/tags6.tsv" -digest_out "$f/zeros.tsv" "${ARGS[@]}"
zrow() { awk -F'\t' -v s="$1" -v k="$2" '$1==s && $2==k {print $3}' "$f/zeros.tsv"; }
[ "$(zrow meta ms2_whole_intensity_share)" = "$(row meta ms2_whole_intensity_share)" ] || fail "zero-intensity peaks change the whole-intensity share"
[ "$(zrow nocall ion_counts)" = "no" ] || fail "zero-intensity peaks make ion_counts fire"
# Written back to mzML (-out_spectra), the MGF names only the peak-list native
# ID format MS:1000774, which names no instrument: the rule still fires there.
# (OpenMS FileConverter writes the generic MS:1000777 instead; digest_test.)
run "$f/log4" -in "$f/counts.mgf" -out "$f/tags4.tsv" -out_spectra "$f/counts.mzML" "${ARGS[@]}"
grep -q 'accession="MS:1000774"' "$f/counts.mzML" || fail "the mzML written from the MGF does not name MS:1000774"
run "$f/log5" -in "$f/counts.mzML" -out "$f/tags5.tsv" -digest_out "$f/counts_mzml.tsv" "${ARGS[@]}"
mrow() { awk -F'\t' -v s="$1" -v k="$2" '$1==s && $2==k {print $3}' "$f/counts_mzml.tsv"; }
[ "$(mrow nocall timstof)" = "unknown" ] || fail "mzML from a whole-number MGF: timstof is not 'unknown'"
[ "$(mrow nocall ion_counts)" = "yes" ] || fail "mzML from a whole-number MGF: ion_counts did not fire"
[ "$(mrow call status)" = "no_call" ] || fail "mzML from a whole-number MGF: a protease call was made"
# The mzML names its instrument, so the rule reads no there.
run "$f/log3" -in "$MZML" -out "$f/tags3.tsv" -digest_out "$f/mzml.tsv" "${ARGS[@]}"
[ "$(awk -F'\t' '$1=="nocall" && $2=="ion_counts" {print $3}' "$f/mzml.tsv")" = "no" ] || fail "digest ion_counts is not 'no' on the fixture mzML"

# ---- g. charge-less input
g="$TMP/g"; mkdir -p "$g"
grep -v 'MS:1000041' "$MZML" > "$g/nocharge.mzML"
grep -v '^CHARGE=' "$MGF" > "$g/nocharge.mgf"
sed 's/^CHARGE=.*/CHARGE=2+ and 3+/' "$MGF" > "$g/multi.mgf"
for x in nocharge.mzML nocharge.mgf multi.mgf; do run "$g/$x.log" -in "$g/$x" -out "$g/$x.tsv" "${ARGS[@]}"; done
same_body "$g/nocharge.mzML.tsv" "$g/nocharge.mgf.tsv" "charge-less tags.tsv"
cmp -s "$g/nocharge.mgf.tsv" "$g/multi.mgf.tsv" || fail "CHARGE=2+ and 3+ is not tagged as no CHARGE"
n_ms2=$(grep -c '^BEGIN IONS' "$MGF")
for x in nocharge.mzML nocharge.mgf multi.mgf; do
  grep -q "$n_ms2 of $n_ms2 MS2 spectra carry no precursor charge" "$g/$x.log" || fail "$x: no-charge count is not $n_ms2"
done
grep -q "($n_ms2 of them list several possible charges)" "$g/multi.mgf.log" || fail "the several-charges count is missing"
grep -q "list several possible charges" "$g/nocharge.mgf.log" && fail "a missing CHARGE counted as several charges"

# ---- h. errors
h="$TMP/h"; mkdir -p "$h"
expect() {  # expect <code> <message> <args...>
  local code="$1" msg="$2"; shift 2
  "$BIN" "$@" >"$h/log" 2>&1; local rc=$?
  [ "$rc" -eq "$code" ] || { cat "$h/log" >&2; fail "exit $rc, expected $code: $*"; }
  grep -qF -- "$msg" "$h/log" || { cat "$h/log" >&2; fail "no message '$msg': $*"; }
}
for z in gz:gzip bz2:bzip2 zip:zip; do
  cp "$MGF" "$h/run.mgf.${z%%:*}"
  expect 6 "is ${z#*:}-compressed" -in "$h/run.mgf.${z%%:*}" -out "$h/x.tsv" "${ARGS[@]}"   # ILLEGAL_PARAMETERS
done
: > "$h/empty.mgf"
# (A 0-byte file is refused by TOPPBase's own input check, with the same code.)
expect 4 "is empty" -in "$h/empty.mgf" -out "$h/x.tsv" "${ARGS[@]}"                        # INPUT_FILE_EMPTY
printf 'this is not\nan MGF file\n' > "$h/text.mgf"
expect 4 "contains no BEGIN IONS block" -in "$h/text.mgf" -out "$h/x.tsv" "${ARGS[@]}"
cp "$MZML" "$h/run.txt"
expect 6 "neither .mzML, .mzpeak nor .mgf" -in "$h/run.txt" -out "$h/x.tsv" "${ARGS[@]}"
# A truncated last block: refused before any output is opened.
head -c $(( $(wc -c < "$MGF") - 20 )) "$MGF" > "$h/trunc.mgf"
rm -f "$h/trunc.tsv"
expect 3 "MGF block $((n_ms2 - 1)) (byte " -in "$h/trunc.mgf" -out "$h/trunc.tsv" "${ARGS[@]}"   # INPUT_FILE_CORRUPT
grep -q "no END IONS before the end of the file" "$h/log" || fail "truncation not explained"
[ -e "$h/trunc.tsv" ] && fail "a truncated MGF left an output file"
# One bad block each: a peak line and a CHARGE.
awk '/^BEGIN IONS/ {k++} k==6 && /^[0-9]/ && !done {print "100.5x 3"; done=1; next} {print}' "$MGF" > "$h/badpeak.mgf"
expect 3 "MGF block 5 (byte " -in "$h/badpeak.mgf" -out "$h/x.tsv" "${ARGS[@]}"
grep -q "does not start with a number" "$h/log" || fail "bad peak not explained"
awk '/^BEGIN IONS/ {k++} k==10 && /^CHARGE=/ {print "CHARGE=2x"; next} {print}' "$MGF" > "$h/badcharge.mgf"
expect 3 "MGF block 9 (byte " -in "$h/badcharge.mgf" -out "$h/x.tsv" "${ARGS[@]}"
cp "$MGF" "$h/self.mgf"
"$BIN" -in "$h/self.mgf" -out "$h/x.tsv" -out_spectra "$h/self.mgf" "${ARGS[@]}" >"$h/log" 2>&1 && fail "-out_spectra equal to an MGF -in ran"
cmp -s "$MGF" "$h/self.mgf" || fail "the MGF input was modified"

# ---- j. regressions
j="$TMP/j"; mkdir -p "$j"
# A bad block the serial tolerance probe does not read (for 139 blocks it
# reads 0-7, 17-24, ...): it fails in the tagging loop, after -out, -recon_out
# and -glyco_out are open. None of them may stay behind.
awk '/^BEGIN IONS/ {k++} k==64 && /^[0-9]/ && !done {print $1 " 12x4"; done=1; next} {print}' "$MGF" > "$j/bad63.mgf"
expect 3 "MGF block 63 (byte " -in "$j/bad63.mgf" -out "$j/t.tsv" -fasta "$DB" -recon_out "$j/r.tsv" \
  -glyco -glyco_out "$j/g.tsv" -tag_length 4 -extension 1 -fragment_tolerance 0.3 -fragment_tolerance_unit Da -threads 8
grep -q "is not a number" "$h/log" || fail "bad intensity in block 63 not explained"
for f in t r g; do [ -e "$j/$f.tsv" ] && fail "a bad block 63 left $f.tsv behind"; done
# A lost BEGIN IONS line: the block's spectrum is ignored, as in OpenMS, but
# never silently. Mid-file, and the first one (whose CHARGE= then sits in the
# header: no misleading header-CHARGE warning, every block has its own).
for which in 6 1; do
  awk -v w=$which '/^BEGIN IONS/ {k++; if (k==w) next} {print}' "$MGF" > "$j/lost$which.mgf"
  run "$j/lost$which.log" -in "$j/lost$which.mgf" -out "$j/lost$which.tsv" "${ARGS[@]}"
  grep -q "$((n_ms2 - 1)) MS2 spectra" "$j/lost$which.log" || fail "lost BEGIN IONS ($which): not $((n_ms2 - 1)) spectra"
  grep -q "1 END IONS line(s) outside any block" "$j/lost$which.log" || { cat "$j/lost$which.log" >&2; fail "lost BEGIN IONS ($which): no stray END IONS warning"; }
  grep -q "1 stretch(es) of text outside" "$j/lost$which.log" || fail "lost BEGIN IONS ($which): no spectrum-like text warning"
  grep -q "file-level CHARGE=" "$j/lost$which.log" && fail "lost BEGIN IONS ($which): header-CHARGE warning"
done
grep -q "outside any block\|stretch(es) of text" "$TMP/a_plain_mgf/log" && fail "the clean fixture warns about text outside its blocks"
# SCANS with a control byte, RTINSECONDS=nan: -out_spectra stays well-formed
# XML that FASTag reads back, with no "nan" time.
awk '/^BEGIN IONS/ {k++} k==6 && /^SCANS=/ {printf "SCANS=1\001\n"; next} k==7 && /^RTINSECONDS=/ {print "RTINSECONDS=nan"; next} {print}' "$MGF" > "$j/meta.mgf"
run "$j/meta.log" -in "$j/meta.mgf" -out "$j/meta.tsv" -out_spectra "$j/meta.mzML" "${ARGS[@]}"
grep -q "1 MGF SCANS values carry control bytes" "$j/meta.log" || fail "SCANS control byte not counted"
grep -q "1 MGF blocks have an RTINSECONDS that is not finite" "$j/meta.log" || fail "RTINSECONDS=nan not counted"
LC_ALL=C grep -q $'\x01' "$j/meta.mzML" && fail "a control byte reached the mzML"
grep -q 'value="nan"' "$j/meta.mzML" && fail "RTINSECONDS=nan written as value=\"nan\""
run "$j/meta2.log" -in "$j/meta.mzML" -out "$j/meta2.tsv" "${ARGS[@]}"
cmp -s <(cut -f2- "$j/meta.tsv") <(cut -f2- "$j/meta2.tsv") || fail "the -out_spectra of SCANS/RT edge cases does not re-tag the same"
# A malformed FIRST peak line, outside the probe: an error, not a dropped peak.
for bad in "nan 5" "-100 5" ".5 5" "+200 5"; do
  awk -v b="$bad" '/^BEGIN IONS/ {k++; p=0} k==64 && /^[0-9]/ && !p++ {print b; next} {print}' "$MGF" > "$j/first.mgf"
  expect 3 "looks like a peak line" -in "$j/first.mgf" -out "$j/first.tsv" "${ARGS[@]}"
  grep -q "MGF block 63 (byte " "$h/log" || fail "first peak '$bad': not block 63"
  [ -e "$j/first.tsv" ] && fail "first peak '$bad' left first.tsv behind"
done
# -out_spectra names the MGF with its SHA-1, as FileConverter does.
sha=$( (sha1sum "$MGF" 2>/dev/null || shasum -a 1 "$MGF") | cut -d' ' -f1)
grep -q "name=\"SHA-1\" value=\"$sha\"" "$c/kept.mzML" || { grep SHA-1 "$c/kept.mzML" >&2; fail "-out_spectra from MGF has no SHA-1 $sha"; }
# A header CHARGE= (OpenMS's MGF writer puts one in every file): warned about
# only when a block has no CHARGE of its own.
{ printf 'COM=header\nCHARGE=1+, 2+ and 3+\n'; cat "$MGF"; } > "$j/hdr.mgf"
run "$j/hdr.log" -in "$j/hdr.mgf" -out "$j/hdr.tsv" "${ARGS[@]}"
grep -q "file-level CHARGE=" "$j/hdr.log" && fail "header-CHARGE warning although every block has a CHARGE"
{ printf 'COM=header\nCHARGE=1+, 2+ and 3+\n'; awk '/^BEGIN IONS/ {k++} k==1 && /^CHARGE=/ {next} {print}' "$MGF"; } > "$j/hdr1.mgf"
run "$j/hdr1.log" -in "$j/hdr1.mgf" -out "$j/hdr1.tsv" "${ARGS[@]}"
grep -q "file-level CHARGE=.*1 block(s) without" "$j/hdr1.log" || { cat "$j/hdr1.log" >&2; fail "no header-CHARGE warning for 1 block without CHARGE"; }

# ---- i. subsampling
s="$TMP/s"; mkdir -p "$s"
for r in 1 2; do run "$s/log$r" -in "$MGF" -out "$s/sub$r.tsv" -subsample_fraction 0.5 -subsample_seed 7 "${ARGS[@]}"; done
cmp -s "$s/sub1.tsv" "$s/sub2.tsv" || fail "subsampling on MGF is not deterministic"
[ "$(wc -l < "$s/sub1.tsv")" -gt 1 ] && [ "$(wc -l < "$s/sub1.tsv")" -lt "$(wc -l < "$TMP/a_plain_mgf/tags.tsv")" ] \
  || fail "subsampling kept no rows, or all of them"
[ -z "$(comm -23 <(sort "$s/sub1.tsv") <(sort "$TMP/a_plain_mgf/tags.tsv"))" ] || fail "subsampled rows are not a subset of the full run"

# ---- k. -proforma prefix: residue fixed mods only
k="$TMP/k"; mkdir -p "$k"
run "$k/log" -in "$MGF" -out "$k/tags.tsv" "${ARGS[@]}" -proforma \
    -fixed_modifications "Carbamidomethyl (C)" "TMT6plex (N-term)"
col=$(head -1 "$k/tags.tsv" | tr '\t' '\n' | grep -nx proforma | cut -d: -f1)
[ -n "$col" ] || fail "-proforma: no proforma column"
[ "$(wc -l < "$k/tags.tsv")" -gt 1 ] || fail "-proforma: no rows; the check would prove nothing"
awk -F'\t' -v c="$col" 'NR > 1 && (index($c, "<[Carbamidomethyl]@C>") != 1 || index($c, "<[TMT6plex]")) {print; exit 1}' "$k/tags.tsv" \
  || fail "-proforma prefix is not <[Carbamidomethyl]@C> alone (a terminal fixed mod leaked in)"

echo "mgf_cli_test: all checks passed"
