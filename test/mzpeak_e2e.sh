#!/usr/bin/env bash
# mzPeak integration: the reader against its own mzML twin, end to end.
#
# Unit tests cannot reach this -- it needs a real acquisition that exists in
# BOTH formats, which is the only way to tell "the reader works" from "the
# reader is consistently wrong". Point it at such a pair:
#
#   FASTAG_E2E_MZML=<run.mzML> FASTAG_E2E_MZPEAK=<same run.mzpeak> ctest
#
# Exits 77 (ctest SKIP) when they are not set, so a normal build is unaffected.
set -u
BIN="$1"

if [ -z "${FASTAG_E2E_MZML:-}" ] || [ -z "${FASTAG_E2E_MZPEAK:-}" ]; then
  echo "SKIP: set FASTAG_E2E_MZML and FASTAG_E2E_MZPEAK to a matched pair" >&2
  exit 77
fi
for f in "$FASTAG_E2E_MZML" "$FASTAG_E2E_MZPEAK"; do
  [ -r "$f" ] || { echo "SKIP: cannot read $f" >&2; exit 77; }
done

W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
A=(-fragment_tolerance "${FASTAG_E2E_PPM:-20}" -fragment_tolerance_unit ppm)
fail=0
ck() { if [ "$2" = "$3" ]; then echo "  ok   $1"; else echo "  FAIL $1: got '$2' want '$3'"; fail=1; fi; }
rows() { [ -s "$1" ] || { echo MISSING; return; }; echo $(( $(grep -c . "$1") - 1 )); }

"$BIN" -in "$FASTAG_E2E_MZML"   -out "$W/ml.tsv" -threads 4 "${A[@]}" >/dev/null 2>&1
"$BIN" -in "$FASTAG_E2E_MZPEAK" -out "$W/mp.tsv" -threads 4 "${A[@]}" >/dev/null 2>&1

# Both readers must see the same run. Tag counts may differ by a hair -- an
# archive storing m/z as float32 moves borderline matches across the tolerance
# -- so this asserts agreement, not equality: 99.9% of (spectrum, tag, length)
# triples shared. An actual reader bug is nowhere near that line.
a=$(rows "$W/ml.tsv"); b=$(rows "$W/mp.tsv")
ck "mzML produced tags"   "$([ "$a" != MISSING ] && [ "$a" -gt 0 ] && echo yes)" "yes"
ck "mzPeak produced tags" "$([ "$b" != MISSING ] && [ "$b" -gt 0 ] && echo yes)" "yes"
if [ "$a" != MISSING ] && [ "$b" != MISSING ]; then
  # Compare DISTINCT (spectrum, tag, length) triples on both sides. Counting
  # shared distinct triples against total ROWS would compare unlike things:
  # one triple can appear several times with different charges and flanks, so
  # the row count is always the larger number and the ratio is meaningless.
  cut -f1-3 "$W/ml.tsv" | sort -u > "$W/ml.keys"
  cut -f1-3 "$W/mp.tsv" | sort -u > "$W/mp.keys"
  uniq_ml=$(wc -l < "$W/ml.keys" | tr -d ' ')
  shared=$(comm -12 "$W/ml.keys" "$W/mp.keys" | wc -l | tr -d ' ')
  ck "readers agree on >=99.9% of distinct tags" \
     "$(awk -v s="$shared" -v n="$uniq_ml" 'BEGIN{print (n > 0 && s >= 0.999*n) ? "yes" : "no ("s"/"n")"}')" "yes"
fi

# Determinism: the tagger is order-independent, and a reader that is not shows
# up here rather than as an irreproducible result months later.
"$BIN" -in "$FASTAG_E2E_MZPEAK" -out "$W/t1.tsv" -threads 1 "${A[@]}" >/dev/null 2>&1
ck "mzPeak 1 vs 4 threads byte-identical" "$(cmp -s "$W/t1.tsv" "$W/mp.tsv" && echo same || echo differ)" "same"

# -out_spectra: every in/out combination. The written archive must then be
# RE-TAGGABLE: its spectra are exactly the ones that carried a tag, so tagging
# it again must find those same tags. That is the check that precursors
# survived the write -- without one FASTag refuses a spectrum outright, so a
# writer that dropped them would report a clean zero here.
"$BIN" -in "$FASTAG_E2E_MZPEAK" -out "$W/o.tsv" -out_spectra "$W/o.mzML" -threads 4 "${A[@]}" >/dev/null 2>&1
ck "mzpeak -> mzML spectra" "$([ -s "$W/o.mzML" ] && echo ok)" "ok"
"$BIN" -in "$FASTAG_E2E_MZPEAK" -out "$W/o2.tsv" -out_spectra "$W/o.mzpeak" -threads 4 "${A[@]}" >/dev/null 2>&1
ck "mzpeak -> mzpeak spectra" "$([ -s "$W/o.mzpeak" ] && echo ok)" "ok"
"$BIN" -in "$W/o.mzpeak" -out "$W/re.tsv" -threads 4 "${A[@]}" >/dev/null 2>&1
cut -f1-3 "$W/o2.tsv" | sort -u > "$W/o2.keys"
cut -f1-3 "$W/re.tsv" 2>/dev/null | sort -u > "$W/re.keys"
n=$(wc -l < "$W/o2.keys" | tr -d ' '); s=$(comm -12 "$W/o2.keys" "$W/re.keys" | wc -l | tr -d ' ')
ck "re-tagging the written mzpeak reproduces >=99.9% of its tags" \
   "$(awk -v s="$s" -v n="$n" 'BEGIN{print (n > 0 && s >= 0.999*n) ? "yes" : "no ("s"/"n")"}')" "yes"
"$BIN" -in "$FASTAG_E2E_MZML" -out "$W/o3.tsv" -out_spectra "$W/m.mzpeak" -threads 4 "${A[@]}" >/dev/null 2>&1
ck "mzML -> mzpeak spectra" "$([ -s "$W/m.mzpeak" ] && echo ok)" "ok"

[ "$fail" -eq 0 ] || exit 1
echo "mzpeak_e2e: all checks passed"
