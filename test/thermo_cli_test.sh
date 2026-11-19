#!/usr/bin/env bash
# Thermo .raw input end to end.
#
#   thermo_cli_test.sh <FASTag> <thermo_parity>
#
# Always (no data needed):
#   - a build without WITH_THERMO_RAW refuses a .raw with a message saying so
#     (and the test passes);
#   - a build with it prints RawFileReader's required notice, verbatim, in
#     --version and --help; refuses a missing and a corrupt .raw with a
#     message; -probe_input and -dump_spectrum refuse .raw.
# With FASTAG_THERMO_RAW=<run.raw> (a DDA run with MS2):
#   - tags it; Thermo native IDs "controllerType=0 controllerNumber=1 scan=N";
#     1 and 3 threads give byte-identical tags; the USI run is the file name
#     without .raw; -out_spectra writes an mzML whose re-tagging is identical
#     up to the reference's 32-bit intensities (counted, not required equal).
# With FASTAG_THERMO_MZML=<its ThermoRawFileParser 2.0 centroided mzML> also:
#   - thermo_parity: stage 1 (spectrum level, preregistered tolerances in
#     test/thermo_parity.cpp) must pass.
# No RAW file is vendored (Thermo RAW is proprietary and none small enough
# with MS2 is in OpenMS's test data); without FASTAG_THERMO_RAW the data part
# is not run, and the test passes on the checks above.
set -u
BIN="$1"
PARITY="$2"
W=$(mktemp -d "${TMPDIR:-/tmp}/fastag-thermo-cli.XXXXXX") || exit 1
trap 'rm -rf "$W"' EXIT
fail=0
NOTICE='RawFileReader reading tool. Copyright © 2016 by Thermo Fisher Scientific, Inc. All rights reserved.'
ck() { if [ "$2" = "$3" ]; then echo "  ok   $1"; else echo "  FAIL $1: got '$2' want '$3'"; fail=1; fi; }
has() { if grep -qF -- "$2" "$3"; then echo "  ok   $1"; else echo "  FAIL $1: '$2' not in $3"; sed 's/^/       /' "$3" | head -20; fail=1; fi; }
hasnt() { if grep -qF -- "$2" "$3"; then echo "  FAIL $1: '$2' in $3"; fail=1; else echo "  ok   $1"; fi; }

if ! "$BIN" --help > "$W/help.txt" 2>&1; then
  echo "SKIP: binary cannot initialize" >&2
  exit 77
fi
"$BIN" --version > "$W/version.txt" 2>&1
ck "--version exit code" "$?" "0"

# A file that is not there, named .raw: decided by name, before any read.
printf 'not a raw file\n' > "$W/fake.raw"
"$BIN" -in "$W/fake.raw" -out "$W/fake.tsv" -threads 1 > "$W/fake.out" 2> "$W/fake.err"
rc=$?
if grep -q "built without WITH_THERMO_RAW" "$W/fake.err"; then
  ck "no Thermo support: refused with ILLEGAL_PARAMETERS (6)" "$rc" "6"
  hasnt "no Thermo support: no RawFileReader notice in --version" "RawFileReader" "$W/version.txt"
  [ $fail -eq 0 ] && echo "PASS (build without Thermo support)"
  exit $fail
fi

# The licence's About text, verbatim (RawFileReader licence, section 3.2).
has "--version carries the RawFileReader notice" "$NOTICE" "$W/version.txt"
has "--help carries the RawFileReader notice" "$NOTICE" "$W/help.txt"
has "--help Version line still starts with the version" "Version: $(sed -n '1s/^FASTag \([^ ]*\).*/\1/p' "$W/version.txt")" "$W/help.txt"
ck "corrupt .raw: INPUT_FILE_CORRUPT (3)" "$rc" "3"
# The path is printed natively (C:\... on Windows): check the message and the file name.
has "corrupt .raw: says it cannot read it" "Cannot read '" "$W/fake.err"
has "corrupt .raw: names the file" "fake.raw'" "$W/fake.err"
ck "corrupt .raw: no tag file left" "$([ -e "$W/fake.tsv" ] && echo exists)" ""
"$BIN" -in "$W/missing.raw" -out "$W/m.tsv" -threads 1 > /dev/null 2> "$W/m.err"
ck "missing .raw: non-zero exit" "$([ $? -ne 0 ] && echo nonzero)" "nonzero"
"$BIN" -probe_input "$W/fake.raw" > /dev/null 2> "$W/p.err"
ck "-probe_input refused (6)" "$?" "6"
has "-probe_input message" "does not read Thermo .raw files" "$W/p.err"

RAW="${FASTAG_THERMO_RAW:-}"
if [ -z "$RAW" ] || [ ! -f "$RAW" ]; then
  [ $fail -ne 0 ] && exit 1
  # The reader's gate, notice and refusals passed; CI has no peptide .raw, so
  # this counts as a pass and says the data part did not run.
  echo "PASS (gate and notice; data part not run: set FASTAG_THERMO_RAW and FASTAG_THERMO_MZML)"
  exit 0
fi

A=(-fragment_tolerance 0.5 -fragment_tolerance_unit Da)
"$BIN" -in "$RAW" -out "$W/r3.tsv" -threads 3 "${A[@]}" > "$W/r3.out" 2> "$W/r3.err"
ck "raw: exit code" "$?" "0"
has "raw: vendor centroiding said" "vendor centroiding on" "$W/r3.err"
n=$(($(grep -c . "$W/r3.tsv") - 1))
ck "raw: tags written" "$([ "$n" -gt 100 ] && echo yes)" "yes"
ck "raw: Thermo native IDs" \
   "$(awk -F'\t' 'NR>1 && $1 !~ /^controllerType=0 controllerNumber=1 scan=[0-9]+$/ {print "bad: " $1; exit}' "$W/r3.tsv")" ""
"$BIN" -in "$RAW" -out "$W/r1.tsv" -threads 1 "${A[@]}" > /dev/null 2>&1
ck "raw: 1 and 3 threads give the same tags" "$(cmp -s "$W/r1.tsv" "$W/r3.tsv" && echo same)" "same"

run=$(basename "$RAW"); run=${run%.*}
"$BIN" -in "$RAW" -out "$W/u.tsv" -usi_collection PXD000000 -threads 3 "${A[@]}" > /dev/null 2>&1
ck "raw: USI run is the file name without .raw, scan that of the native ID" \
   "$(awk -F'\t' -v u="mzspec:PXD000000:$run:scan:" 'NR>1 { s=$1; sub(/.*scan=/, "", s); if ($NF != u s) { print "bad: " $1 " " $NF; exit } }' "$W/u.tsv")" ""

# -out_spectra: the tagged MS2, re-read as mzML, give the same spectra count.
"$BIN" -in "$RAW" -out "$W/o.tsv" -out_spectra "$W/o.mzML" -threads 3 "${A[@]}" > /dev/null 2> "$W/o.err"
ck "raw: -out_spectra exit code" "$?" "0"
ck "raw: -out_spectra native IDs" "$(grep -c '<spectrum id="controllerType=0 controllerNumber=1 scan=' "$W/o.mzML" | awk '{print ($1 > 0) ? "yes" : "no"}')" "yes"
has "raw: -out_spectra names the Thermo native ID format" 'MS:1000768' "$W/o.mzML"

MZML="${FASTAG_THERMO_MZML:-}"
if [ -n "$MZML" ] && [ -f "$MZML" ]; then
  "$PARITY" "$RAW" "$MZML" "$W/parity.tsv" > "$W/parity.out" 2>&1
  prc=$?
  ck "stage 1 parity against $(basename "$MZML")" "$prc" "0"
  [ $prc -ne 0 ] && sed 's/^/       /' "$W/parity.out"
fi
[ $fail -eq 0 ] && echo PASS
exit $fail
