#!/usr/bin/env bash
# -recon_id_out .mzid against the real binary: placements give a non-empty
# file; no placements give an empty (0-byte) file that replaces an earlier one.
# Exits 77 (ctest SKIP) when the binary cannot start.
set -u
BIN="$1"
IN="$2"
DB="$3"  # proteins that tags from $IN place in

if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi

TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-recon-ids-test.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
ARGS=(-in "$IN" -out "$TMP/t.tsv" -recon_out "$TMP/r.tsv" -recon_id_out "$TMP/ids.mzid"
      -extension 1 -fragment_tolerance 0.3 -fragment_tolerance_unit Da -threads 2)

"$BIN" "${ARGS[@]}" -fasta "$DB" >"$TMP/a.log" 2>&1 || fail "placing run exited $? ($(tail -1 "$TMP/a.log"))"
[ "$(wc -l < "$TMP/r.tsv")" -gt 1 ] || fail "nothing placed; the check would prove nothing"
grep -q '<SpectrumIdentificationItem' "$TMP/ids.mzid" || fail "placements but no identifications in the mzid"

# A database no tag occurs in, and an earlier result at the output path.
printf '>none\n%s\n' "$(printf 'W%.0s' {1..40})" > "$TMP/none.fasta"
echo "OLD RESULTS" > "$TMP/ids.mzid"
"$BIN" "${ARGS[@]}" -recon_fasta "$TMP/none.fasta" >"$TMP/b.log" 2>&1 || fail "empty run exited $? ($(tail -1 "$TMP/b.log"))"
[ "$(wc -l < "$TMP/r.tsv")" -eq 1 ] || fail "the W-only database placed tags; the check would prove nothing"
[ -f "$TMP/ids.mzid" ] && [ ! -s "$TMP/ids.mzid" ] || fail "no placements: the mzid must exist and be empty"
echo "PASS"
