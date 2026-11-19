#!/usr/bin/env bash
# SCIEX MS Data Converter mzML (test/fixtures/sciex_paramgroup.mzML, cut from
# PXD079630) against the real binary:
#   a. the MS level, kept only in referenceableParamGroups, is read: 12 MS2,
#      tagged, exit 0, and the converter's index (offsets in the whitespace
#      before each spectrum) is used without the stale-index warning
#   b. the tags equal those of OpenMS's own reader (-out_spectra makes FASTag
#      read the run through OnDiscMSExperiment)
#   c. a run whose MS levels cannot be read (the group's MS level term
#      renamed) has spectra with precursors but no MS2: the outputs are
#      written and FASTag exits with 13 and an error
#   d. an MS1-only run (no MS2 level, no precursor) only warns, exit 0
# Exits 77 (ctest SKIP) when the binary cannot start.
#
# Copyright (c) 2026 Oliver Kohlbacher and contributors
# SPDX-License-Identifier: MIT
set -u
BIN="$1"
MZML="$2"
DATA="$3"   # data/digest
if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi
export FASTAG_DIGEST_DIR="$DATA"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-sciex-cli.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
ARGS=(-tag_length 3 -fragment_tolerance 30 -fragment_tolerance_unit ppm -threads 2)

# a. read as written
"$BIN" -in "$MZML" -out "$TMP/a.tsv" "${ARGS[@]}" >"$TMP/a.log" 2>&1 || { cat "$TMP/a.log" >&2; fail "a: exit $?"; }
grep -q "^12 MS2 spectra, " "$TMP/a.log" || { cat "$TMP/a.log" >&2; fail "a: not 12 MS2 spectra"; }
grep -q "no longer matches" "$TMP/a.log" && fail "a: the converter's index was not used"
[ "$(wc -l < "$TMP/a.tsv")" -gt 1 ] || fail "a: no tags"

# b. the same tags through OpenMS's reader
"$BIN" -in "$MZML" -out "$TMP/b.tsv" -out_spectra "$TMP/b.mzML" "${ARGS[@]}" >"$TMP/b.log" 2>&1 \
  || { cat "$TMP/b.log" >&2; fail "b: exit $?"; }
cmp -s "$TMP/a.tsv" "$TMP/b.tsv" || { diff "$TMP/a.tsv" "$TMP/b.tsv" | head >&2; fail "b: tags differ from OpenMS's reader"; }

# c. MS levels unreadable: refused after the run
sed 's/accession="MS:1000511"/accession="MS:9999511"/' "$MZML" > "$TMP/nolevel.mzML"
"$BIN" -in "$TMP/nolevel.mzML" -out "$TMP/c.tsv" "${ARGS[@]}" >"$TMP/c.log" 2>&1
rc=$?
[ "$rc" -eq 13 ] || { cat "$TMP/c.log" >&2; fail "c: exit $rc, want 13"; }
grep -q "None of the 14 spectra" "$TMP/c.log" || { cat "$TMP/c.log" >&2; fail "c: no error message"; }
[ -f "$TMP/c.tsv" ] || fail "c: the tag table was not written"

# d. MS1 only: a warning, exit 0
awk '/<precursorList/{skip=1} !skip{print} /<\/precursorList>/{skip=0}' "$MZML" \
  | sed 's/name="ms level" value="2"/name="ms level" value="1"/' > "$TMP/ms1.mzML"
"$BIN" -in "$TMP/ms1.mzML" -out "$TMP/d.tsv" "${ARGS[@]}" >"$TMP/d.log" 2>&1 || { cat "$TMP/d.log" >&2; fail "d: exit $?"; }
grep -q "an MS1-only run has nothing to tag" "$TMP/d.log" || { cat "$TMP/d.log" >&2; fail "d: no warning"; }

echo "PASS"
