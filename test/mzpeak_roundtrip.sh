#!/usr/bin/env bash
# mzPeak in and out, on the vendored fixture, with no external data.
#
#   mzpeak_roundtrip.sh <FASTag> <fixture.mzML> <outdir>
#
# The tool writes an mzPeak archive from the mzML (-out_spectra), then tags
# that archive, and the tag TSV must be BYTE-IDENTICAL to the one from the
# mzML: same spectra, same rows, same order. The archive holds exactly the
# spectra that carried a reported tag -- a subset -- so the equality is
# checked alongside the counts: the writer's "Wrote N spectra" and the
# reader's "N MS2 spectra" must both equal the number of distinct spectra in
# the mzML tag list, and that number must be strictly between 0 and the
# fixture's 139 MS2. A reader returning zero peaks or zero precursors with
# exit 0 -- the silent failure this project has met three times -- shows up
# here as 0 MS2 and an empty TSV, not as a green run.
#
# What this cannot see: a halved intensity, a dropped second precursor, a
# zeroed retention time. Tagging ranks intensities and reads one precursor's
# m/z and charge, so those leave every tag untouched. mzpeak_adapter_test
# compares the fields themselves; this script proves the TOOL end to end.
#
# The archives are left in <outdir> for mzpeak_validate.sh (a ctest fixture).
# Exits 77 (ctest SKIP) when the binary was built without the library, or
# when OpenMS's shared data is unreachable; anything else that goes wrong is
# a failure, not a skip.
set -u
export LC_ALL=C
BIN="$1"; MZ="$2"; OUT="$3"

[ -r "$MZ" ] || { echo "SKIP: fixture not readable: $MZ" >&2; exit 77; }
# The only initialisation failure that is not this test's business: OpenMS
# cannot find its shared data (CV terms, residues). A loader error or a crash
# is not a skip.
if ! HELP=$("$BIN" --help 2>&1); then
  if printf '%s' "$HELP" | grep -qiE 'OPENMS_DATA_PATH|share/OpenMS|shared data'; then
    echo "SKIP: OpenMS shared data unreachable; set OPENMS_DATA_PATH" >&2; exit 77
  fi
  echo "FAIL: $BIN --help failed:"; printf '%s\n' "$HELP" | tail -5; exit 1
fi

rm -rf "$OUT"; mkdir -p "$OUT"
# Explicit, not the defaults: the subset property below (some but not all
# spectra tagged) holds at 20 ppm on this ion-trap fixture, and a future
# change of defaults must not turn a test into a tolerance question.
A=(-fragment_tolerance 20 -fragment_tolerance_unit ppm)
fail=0
ck() { if [ "$2" = "$3" ]; then echo "  ok   $1"; else echo "  FAIL $1: got '$2' want '$3'"; fail=1; fi; }
run() { local name="$1"; shift; "$BIN" "$@" >"$OUT/$name.log" 2>&1; }
ms2()   { grep -oE '[0-9]+ MS2 spectra' "$1" | head -1 | cut -d' ' -f1; }
wrote() { grep -oE 'Wrote [0-9]+ spectra' "$1" | head -1 | cut -d' ' -f2; }
rows()  { [ -s "$1" ] || { echo MISSING; return; }; echo $(( $(grep -c . "$1") - 1 )); }
# cmp is in diffutils everywhere this runs, Git for Windows included; diff -q
# is the fallback should a runner lack it.
same()  { if command -v cmp >/dev/null 2>&1; then cmp -s "$1" "$2"; else diff -q "$1" "$2" >/dev/null 2>&1; fi; }
identical() { if same "$2" "$3"; then echo "  ok   $1"; else echo "  FAIL $1: $2 and $3 differ"; diff "$2" "$3" | head -5; fail=1; fi; }

# A. The reference: mzML on the production path (no -out_spectra, so the
#    fast indexed reader). 139 is a property of the fixture.
run a -in "$MZ" -out "$OUT/a.tsv" -threads 4 "${A[@]}"
ck "mzML run exits 0" "$?" "0"
ck "mzML run reports 139 MS2 spectra" "$(ms2 "$OUT/a.log")" "139"
ROWS=$(rows "$OUT/a.tsv")
ck "mzML run produced tags" "$([ "$ROWS" != MISSING ] && [ "$ROWS" -gt 0 ] && echo yes)" "yes"
TAGGED=$(tail -n +2 "$OUT/a.tsv" | cut -f1 | sort -u | wc -l | tr -d ' ')
ck "some but not all spectra carry a tag (0 < $TAGGED < 139)" \
   "$([ "$TAGGED" -gt 0 ] && [ "$TAGGED" -lt 139 ] && echo yes)" "yes"

# B. Write the archive. This is where a library-less build says so.
run b -in "$MZ" -out "$OUT/b.tsv" -out_spectra "$OUT/rt.mzpeak" -threads 4 "${A[@]}"
rc=$?
if grep -q "This build has no mzPeak support" "$OUT/b.log"; then
  echo "SKIP: this build has no mzPeak support" >&2; exit 77
fi
ck "mzML -> mzpeak write exits 0" "$rc" "0"
ck "archive written" "$([ -s "$OUT/rt.mzpeak" ] && echo yes)" "yes"
# The writing run reads through OnDiscMSExperiment, not the fast reader: the
# two mzML paths are pinned to each other here, for free.
identical "tags with -out_spectra == tags without (both mzML readers agree)" "$OUT/a.tsv" "$OUT/b.tsv"
ck "wrote exactly the tagged spectra ($TAGGED)" "$(wrote "$OUT/b.log")" "$TAGGED"

# C. Tag the archive: byte-identical to the mzML run.
run c -in "$OUT/rt.mzpeak" -out "$OUT/c.tsv" -threads 4 "${A[@]}"
ck "mzpeak run exits 0" "$?" "0"
ck "mzpeak run sees exactly the tagged spectra ($TAGGED MS2)" "$(ms2 "$OUT/c.log")" "$TAGGED"
identical "tags from mzpeak == tags from mzML (4 threads)" "$OUT/a.tsv" "$OUT/c.tsv"

# D. Thread-count determinism smoke (1 vs 4; a race confined to cold decodes
#    on a two-core runner can escape this, the library's own tests go
#    further).
run d -in "$OUT/rt.mzpeak" -out "$OUT/d.tsv" -threads 1 "${A[@]}"
ck "mzpeak run at 1 thread exits 0" "$?" "0"
identical "mzpeak 1 thread == 4 threads" "$OUT/c.tsv" "$OUT/d.tsv"

# E. Archive -> archive: the raw-metadata write path, precursors from an
#    mzPeak-sourced spectrum. Then tag THAT.
run e -in "$OUT/rt.mzpeak" -out "$OUT/e.tsv" -out_spectra "$OUT/rt2.mzpeak" -threads 4 "${A[@]}"
ck "mzpeak -> mzpeak write exits 0" "$?" "0"
ck "second archive written" "$([ -s "$OUT/rt2.mzpeak" ] && echo yes)" "yes"
ck "second write kept all $TAGGED spectra" "$(wrote "$OUT/e.log")" "$TAGGED"
identical "tags while re-writing == tags from mzML" "$OUT/a.tsv" "$OUT/e.tsv"
run e2 -in "$OUT/rt2.mzpeak" -out "$OUT/e2.tsv" -threads 4 "${A[@]}"
ck "re-written archive tags (exit)" "$?" "0"
ck "re-written archive sees $TAGGED MS2" "$(ms2 "$OUT/e2.log")" "$TAGGED"
identical "tags from re-written archive == tags from mzML" "$OUT/a.tsv" "$OUT/e2.tsv"

# F. A multi-row-group archive of the same content (4096 points per group,
#    ~9 groups for this fixture), so the reader's group-boundary planning is
#    what runs. The "decoded N" line counts cache decodes -- equal to the
#    group count only when nothing is evicted, which is the case here -- so
#    N >= 2 is coarse evidence; mzpeak_adapter_test reads the footer.
FASTAG_MZPEAK_POINTS_PER_ROW_GROUP=4096 run f -in "$MZ" -out "$OUT/f.tsv" -out_spectra "$OUT/rt_rg.mzpeak" -threads 4 "${A[@]}"
ck "multi-row-group write exits 0" "$?" "0"
run g -in "$OUT/rt_rg.mzpeak" -out "$OUT/g.tsv" -threads 4 "${A[@]}"
ck "multi-row-group read exits 0" "$?" "0"
DECODED=$(grep -oE 'decoded [0-9]+ row groups' "$OUT/g.log" | head -1 | cut -d' ' -f2)
ck "reader decoded several row groups (got ${DECODED:-none})" \
   "$([ -n "$DECODED" ] && [ "$DECODED" -ge 2 ] && echo yes)" "yes"
ck "multi-row-group archive sees $TAGGED MS2" "$(ms2 "$OUT/g.log")" "$TAGGED"
identical "tags from multi-row-group archive == tags from mzML" "$OUT/a.tsv" "$OUT/g.tsv"

[ "$fail" -eq 0 ] || { echo "mzpeak_roundtrip: FAILED (logs in $OUT)"; exit 1; }
echo "mzpeak_roundtrip: all checks passed (139 MS2, $TAGGED tagged, $ROWS rows, ${DECODED} row groups decoded)"
