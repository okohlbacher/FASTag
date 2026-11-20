#!/usr/bin/env bash
# -tolerance_by_analyzer on with mzPeak input: the tags of an archive equal the tags of the mzML it was
# written from, ion-trap spectra included.
#
#   mzpeak_tolerance_by_analyzer.sh <FASTag> <fixture.mzML> <outdir>
#
# The fixture (Ecoli_MS2_small, 139 MS2) names its analyzer in "filter string" userParams (ITMS). The
# OnDiscMSExperiment reader (used under -out_spectra) keeps them; the fast indexed reader reads only the
# MS:1000512 cvParam and classes the run by its Orbitrap instrument configuration. So the mzML reference
# here is a run with -out_spectra, which reads all 139 MS2 as ion trap.
#
#   W. Write an archive of all 139 spectra (the archive holds the tagged ones; seed length 2 at 1 Da without
#      an e-value cutoff tags every spectrum of the fixture). The whole run, in the same order, so the ion-trap probe (draw_probe: same candidates, same
#      picks) and its measured complement window are those of the mzML run.
#   M. The mzML reference, -tolerance_by_analyzer on (default options otherwise): 139 ion-trap MS2.
#   P. The archive, same options: the tags must be byte-identical to M's, the probe and its window too.
#
# An archive written by an OpenMS without the filter string fix (OpenMS/OpenMS#10955; FASTag's CI pin
# before it moves) carries no analyzer: the archive run must then find 0 ion-trap MS2 and give exactly the
# tags of -tolerance_by_analyzer off (the 1.15.5 behaviour), and the test SKIPs (77) after checking that.
# Also 77 when the build has no mzPeak support or OpenMS's shared data is unreachable.
set -u
export LC_ALL=C
BIN="$1"; MZ="$2"; OUT="$3"

[ -r "$MZ" ] || { echo "SKIP: fixture not readable: $MZ" >&2; exit 77; }
if ! HELP=$("$BIN" --help 2>&1); then
  if printf '%s' "$HELP" | grep -qiE 'OPENMS_DATA_PATH|share/OpenMS|shared data'; then
    echo "SKIP: OpenMS shared data unreachable; set OPENMS_DATA_PATH" >&2; exit 77
  fi
  echo "FAIL: $BIN --help failed:"; printf '%s\n' "$HELP" | tail -5; exit 1
fi

rm -rf "$OUT"; mkdir -p "$OUT"
fail=0
ck() { if [ "$2" = "$3" ]; then echo "  ok   $1"; else echo "  FAIL $1: got '$2' want '$3'"; fail=1; fi; }
same() { if command -v cmp >/dev/null 2>&1; then cmp -s "$1" "$2"; else diff -q "$1" "$2" >/dev/null 2>&1; fi; }
identical() { if same "$2" "$3"; then echo "  ok   $1"; else echo "  FAIL $1: $2 and $3 differ"; diff "$2" "$3" | head -5; fail=1; fi; }
run() { local name="$1"; shift; "$BIN" "$@" >"$OUT/$name.log" 2>&1; }
wrote() { grep -oE 'Wrote [0-9]+ spectra' "$1" | head -1 | cut -d' ' -f2; }
itms() { grep -oE 'Tolerance by analyzer: [0-9]+ ion-trap MS2 tagged' "$1" | head -1 | cut -d' ' -f4; }
# The probe line without the reader-specific timing line.
probe() { grep -E '^Tolerance by analyzer: ion-trap MS2 at' "$1"; }

# W. The archive: every spectrum of the fixture.
run w -in "$MZ" -out "$OUT/w.tsv" -out_spectra "$OUT/all.mzpeak" \
    -tag_length 2 -fragment_tolerance 1 -fragment_tolerance_unit Da -max_evalue 0 -tolerance_by_analyzer off -threads 4
rc=$?
if grep -q "This build has no mzPeak support" "$OUT/w.log"; then
  echo "SKIP: this build has no mzPeak support" >&2; exit 77
fi
ck "archive write exits 0" "$rc" "0"
ck "archive holds all 139 spectra" "$(wrote "$OUT/w.log")" "139"

# M. The mzML reference (OnDisc reader, through -out_spectra).
run m -in "$MZ" -out "$OUT/m.tsv" -out_spectra "$OUT/m.mzML" -threads 4
ck "mzML run exits 0" "$?" "0"
ck "mzML run tags 139 ion-trap MS2" "$(itms "$OUT/m.log")" "139"

# P. The archive.
run p -in "$OUT/all.mzpeak" -out "$OUT/p.tsv" -threads 4
ck "mzPeak run exits 0" "$?" "0"
ck "mzPeak run logs its probe pass" "$(grep -c '^Tolerance by analyzer: mzPeak probe pass' "$OUT/p.log")" "1"
N=$(itms "$OUT/p.log")
if [ "$N" = "0" ]; then
  # No analyzer in the archive (OpenMS without #10955): exactly the tags of -tolerance_by_analyzer off.
  run q -in "$OUT/all.mzpeak" -out "$OUT/q.tsv" -threads 4 -tolerance_by_analyzer off
  ck "mzPeak run with the option off exits 0" "$?" "0"
  identical "archive without analyzer: on == off" "$OUT/p.tsv" "$OUT/q.tsv"
  [ "$fail" -eq 0 ] || { echo "mzpeak_tolerance_by_analyzer: FAILED (logs in $OUT)"; exit 1; }
  echo "SKIP: the archive carries no analyzer (OpenMS without the mzPeak filter string, OpenMS/OpenMS#10955)" >&2
  exit 77
fi
ck "mzPeak run tags 139 ion-trap MS2" "$N" "139"
ck "same ion-trap probe and complement window" "$(probe "$OUT/p.log")" "$(probe "$OUT/m.log")"
identical "tags from the archive == tags from the mzML" "$OUT/m.tsv" "$OUT/p.tsv"
# Thread-count determinism of the archive run.
run p1 -in "$OUT/all.mzpeak" -out "$OUT/p1.tsv" -threads 1
ck "mzPeak run at 1 thread exits 0" "$?" "0"
identical "mzPeak 1 thread == 4 threads" "$OUT/p.tsv" "$OUT/p1.tsv"

[ "$fail" -eq 0 ] || { echo "mzpeak_tolerance_by_analyzer: FAILED (logs in $OUT)"; exit 1; }
echo "mzpeak_tolerance_by_analyzer: all checks passed"
