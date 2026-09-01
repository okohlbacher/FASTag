#!/usr/bin/env bash
# -stream integration: protocol round-trip against the real binary.
# Covers what unit tests cannot: the fd rewiring (clean stdout), one sentinel
# per block, #error + resync on malformed input, and survival to EOF.
# Exits 77 (ctest SKIP) when the OpenMS share data is not resolvable.
set -u
BIN="$1"

if [ -z "${OPENMS_DATA_PATH:-}" ]; then
  # Probe: without chemistry data the tool cannot start at all.
  if ! "$BIN" --help >/dev/null 2>&1; then
    echo "SKIP: OPENMS_DATA_PATH unset and binary cannot initialize" >&2
    exit 77
  fi
fi

OUT=$(printf 'spectrum good 500.25 2\n300.1 10\n400.2 20\n413.317 15\n\nspectrum bad_header_no_fields\n\nspectrum resync 600.5 2\n100 1\nnot numeric\nignored 5\n\nspectrum empty 500 2\n\nspectrum eof_mid 700.1 2\n200.2 5' \
      | "$BIN" -stream -fragment_tolerance 0.3 -fragment_tolerance_unit Da 2>/dev/null)
RC=$?
fail() { echo "FAIL: $1" >&2; printf '%s\n' "$OUT" >&2; exit 1; }

[ "$RC" -eq 0 ] || fail "nonzero exit $RC"
printf '%s\n' "$OUT" | head -1 | grep -q '^spectrum	tag	length' || fail "first line is not the TSV header"
# One terminal per block: an errored block ends with #error INSTEAD of #end.
[ "$(printf '%s\n' "$OUT" | grep -c '^#end ')" -eq 3 ] || fail "expected 3 #end sentinels (good/empty/eof_mid)"
[ "$(printf '%s\n' "$OUT" | grep -c '^#error ')" -eq 2 ] || fail "expected 2 #error terminals (bad header, bad peak)"
[ "$(printf '%s\n' "$OUT" | grep -c '^#')" -eq 5 ] || fail "five blocks in, five terminals out"
printf '%s\n' "$OUT" | grep -q '^#end empty 0$' || fail "zero-peak block must end with 0 tags"
printf '%s\n' "$OUT" | grep -q '^#end eof_mid ' || fail "EOF mid-block still gets its sentinel"
# Every non-sentinel line is the header or a 12-column row -- no stray prose.
BAD=$(printf '%s\n' "$OUT" | grep -v '^#' | awk -F'\t' 'NF != 12 { print; exit }')
[ -z "$BAD" ] || fail "non-12-column line on stdout: $BAD"
echo "stream_test: all checks passed"
