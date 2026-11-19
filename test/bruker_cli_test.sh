#!/usr/bin/env bash
# Bruker timsTOF input (.d, .d.zip) end to end on a trimmed real run.
#
#   bruker_cli_test.sh <FASTag> <fixtures dir>
#
# The fixture test/fixtures/bruker/PXD040281_SA_02_trim.d is 44 frames of a
# DDA-PASEF run of PXD040281 (make_bruker_fixture.py; README there): 164
# precursors, 3 of them without a charge, MS1 frame data dropped.
#
# A FASTag built against an OpenMS without WITH_OPENTIMS must refuse the run
# with a message saying so; that is checked instead, and the test passes. The
# zip, dia-PASEF and run-name checks need python3 (standard library); without
# it they are skipped (exit 77 when nothing else ran).
set -u
BIN="$1"
FIX="$2/bruker/PXD040281_SA_02_trim.d"
[ -d "$FIX" ] || { echo "SKIP: no fixture $FIX" >&2; exit 77; }

W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
export OPENMS_TMPDIR="$W/tmp"; mkdir -p "$OPENMS_TMPDIR"
A=(-fragment_tolerance 20 -fragment_tolerance_unit ppm -threads 2)
fail=0
ck() { if [ "$2" = "$3" ]; then echo "  ok   $1"; else echo "  FAIL $1: got '$2' want '$3'"; fail=1; fi; }
has() { if grep -q -- "$2" "$3"; then echo "  ok   $1"; else echo "  FAIL $1: '$2' not in $3"; sed 's/^/       /' "$3" | head -20; fail=1; fi; }

"$BIN" -in "$FIX" -out "$W/d.tsv" "${A[@]}" > "$W/d.out" 2> "$W/d.err"
rc=$?
if grep -q "built without WITH_OPENTIMS" "$W/d.err"; then
  ck "no timsTOF support: refused with ILLEGAL_PARAMETERS (6)" "$rc" "6"
  [ $fail -eq 0 ] && echo "PASS (build without timsTOF support)"
  exit $fail
fi

# .d: every precursor gives one MS2; tags; the facts of analysis.tdf on stderr.
ck ".d exit code" "$rc" "0"
has ".d MS2 count" "^164 MS2 spectra, " "$W/d.out"
has ".d analysis.tdf facts" "44 frames, 4 MS1, 40 DDA-PASEF MS/MS, 0 dia-PASEF MS/MS; 164 precursors, 3 without a charge" "$W/d.err"
has ".d charge-unknown spectra counted" "3 of 164 MS2 spectra have no precursor charge" "$W/d.err"
has ".d acquisition check DDA" "Acquisition check: DDA" "$W/d.err"
n=$(($(grep -c . "$W/d.tsv") - 1))
ck ".d tags written" "$([ "$n" -gt 1000 ] && echo yes)" "yes"
ck ".d native IDs: OpenMS's frame/scan/precursor" \
   "$(awk -F'\t' 'NR>1 && $1 !~ /^frame=[0-9]+ scan=[0-9]+ precursor=[0-9]+$/ {print "bad: " $1; exit}' "$W/d.tsv")" ""
ck ".d spectra tagged" "$(awk -F'\t' 'NR>1 {print $1}' "$W/d.tsv" | sort -u | wc -l | tr -d ' ')" "164"

# A trailing separator names the same run.
"$BIN" -in "$FIX/" -out "$W/s.tsv" "${A[@]}" > /dev/null 2>&1
ck "trailing / exit code" "$?" "0"
ck "trailing / same tags" "$(cmp -s "$W/d.tsv" "$W/s.tsv" && echo same)" "same"

# Thread count does not change the tags.
"$BIN" -in "$FIX" -out "$W/t1.tsv" -fragment_tolerance 20 -fragment_tolerance_unit ppm -threads 1 > /dev/null 2>&1
ck "1 thread same tags" "$(cmp -s "$W/d.tsv" "$W/t1.tsv" && echo same)" "same"

# The GUI modes do not read .d yet: a clear refusal.
"$BIN" -probe_input "$FIX" > /dev/null 2> "$W/p.err"
ck "-probe_input refused (6)" "$?" "6"
has "-probe_input message" "does not read Bruker timsTOF runs" "$W/p.err"

# A plain compressed file is still refused as compressed.
printf 'x' > "$W/run.mzML.zip"
"$BIN" -in "$W/run.mzML.zip" -out "$W/z.tsv" > /dev/null 2> "$W/z.err"
ck "x.mzML.zip refused" "$?" "6"
has "x.mzML.zip message" "zip-compressed" "$W/z.err"

if ! command -v python3 > /dev/null 2>&1; then
  echo "SKIP: python3 missing; .d.zip, dia-PASEF and USI checks not run" >&2
  [ $fail -eq 0 ] && echo "PASS (partial)"
  exit $fail
fi

# .d.zip: unpacked into OPENMS_TMPDIR, the same tags, nothing left behind.
python3 -I - "$FIX" "$W/PXD040281_SA_02_trim.d.zip" <<'EOF'
import os, sys, zipfile
src, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for f in sorted(os.listdir(src)):
        z.write(os.path.join(src, f), os.path.basename(src) + "/" + f)
EOF
"$BIN" -in "$W/PXD040281_SA_02_trim.d.zip" -out "$W/z.tsv" "${A[@]}" > "$W/z.out" 2> "$W/z.err"
ck ".d.zip exit code" "$?" "0"
ck ".d.zip same tags as .d" "$(cmp -s "$W/d.tsv" "$W/z.tsv" && echo same)" "same"
has ".d.zip unpacked under OPENMS_TMPDIR" "unpacked under $OPENMS_TMPDIR" "$W/z.err"
ck ".d.zip temp space released" "$(find "$OPENMS_TMPDIR" -mindepth 1 | head -1)" ""

# USI: the msRun is the run name without .d / .d.zip; OpenMS's merged
# per-precursor native IDs are no PSI format, so the index is the position.
"$BIN" -in "$W/PXD040281_SA_02_trim.d.zip" -out "$W/u.tsv" -usi_collection PXD040281 "${A[@]}" > /dev/null 2>&1
ck "USI run name" "$(awk -F'\t' 'NR==1 {for (i=1;i<=NF;i++) if ($i=="usi") c=i} NR==2 {print $c}' "$W/u.tsv" | cut -d: -f1-3)" \
   "mzspec:PXD040281:PXD040281_SA_02_trim"

# dia-PASEF (a DiaFrameMsMsWindows table) is refused from analysis.tdf,
# before anything is decoded, with exit 11 and the refusal sentinel.
cp -R "$FIX" "$W/dia.d"
python3 -I - "$W/dia.d/analysis.tdf" <<'EOF'
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.execute("INSERT INTO DiaFrameMsMsWindowGroups (Id) VALUES (1)")
db.executemany("INSERT INTO DiaFrameMsMsWindows (WindowGroup, ScanNumBegin, ScanNumEnd, IsolationMz, "
               "IsolationWidth, CollisionEnergy) VALUES (1, ?, ?, ?, ?, 30.0)",
               [(0, 300, 500.0, 25.0), (300, 600, 525.0, 25.0), (600, 900, 550.0, 50.0)])
db.commit()
EOF
"$BIN" -in "$W/dia.d" -out "$W/dia.tsv" "${A[@]}" > /dev/null 2> "$W/dia.err"
ck "dia-PASEF refused (INCOMPATIBLE_INPUT_DATA, 11)" "$?" "11"
has "dia-PASEF message" "is dia-PASEF: analysis.tdf lists 3 isolation windows (median width 25 Th)" "$W/dia.err"
has "dia-PASEF sentinel" "^FASTAG_REFUSED reason=raw_dia windows=3 median_width=25$" "$W/dia.err"
ck "dia-PASEF no output" "$([ -e "$W/dia.tsv" ] && echo written)" ""
# -acquisition_check off hands the run to the reader. (This one is not
# really dia-PASEF -- its frames are DDA-PASEF -- so OpenMS's DIA path stops
# on it, exit 3; the point is that FASTag no longer refuses it.)
"$BIN" -in "$W/dia.d" -out "$W/dia.tsv" -acquisition_check off "${A[@]}" > /dev/null 2> "$W/dia.err"
ck "dia-PASEF with -acquisition_check off not refused" \
   "$([ $? -ne 11 ] && ! grep -q FASTAG_REFUSED "$W/dia.err" && echo yes)" "yes"

# A .d without analysis.tdf is not a timsTOF run.
mkdir -p "$W/empty.d"
"$BIN" -in "$W/empty.d" -out "$W/e.tsv" "${A[@]}" > /dev/null 2> "$W/e.err"
ck "empty .d exit code (INPUT_FILE_CORRUPT)" "$?" "3"
has "empty .d message" "no analysis.tdf" "$W/e.err"

[ $fail -eq 0 ] && echo PASS
exit $fail
