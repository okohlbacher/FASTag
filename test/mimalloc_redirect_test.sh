#!/usr/bin/env bash
# Windows builds with FASTAG_MIMALLOC (CMakeLists.txt): the C runtime heap of
# the whole process, DLLs included, must be mimalloc's, and the allocator must
# not change any result.
#
#   mimalloc_redirect_test.sh <FASTag.exe> <fixture.mzML>
#
# Asserts, in the build tree's layout (the same flat one the release zip and
# the GUI's bundled CLI use: both DLLs beside the executable):
#   - mimalloc.dll and mimalloc-redirect.dll sit next to the executable;
#   - mimalloc reports the redirection (MIMALLOC_VERBOSE=1) and FASTag's own
#     mi_is_redirected() says so (FASTAG_TIMING's FASTAG_ALLOC line);
#   - MIMALLOC_DISABLE_REDIRECT=1, the documented runtime switch, turns it off;
#   - the tags of both runs are byte-identical.
# Registered only when FASTAG_MIMALLOC is on; never skips.
set -u
BIN="$1"
MZ="$2"

fail() { echo "FAIL: $*" >&2; exit 1; }

D=$(dirname "$BIN")
for f in mimalloc.dll mimalloc-redirect.dll; do
  [ -s "$D/$f" ] || fail "$f is not next to $BIN"
done

TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-mimalloc-test.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT

FASTAG_TIMING=1 MIMALLOC_VERBOSE=1 "$BIN" -in "$MZ" -out "$TMP/on.tsv" -threads 4 >"$TMP/on.log" 2>&1 \
  || { cat "$TMP/on.log"; fail "redirected run exited $?"; }
grep -E "FASTAG_ALLOC|mimalloc: (v[0-9]|malloc)" "$TMP/on.log"
grep -qE "^FASTAG_ALLOC allocator=mimalloc version=[0-9]+ redirected=1" "$TMP/on.log" \
  || { cat "$TMP/on.log"; fail "mi_is_redirected() is false: the CRT heap is not mimalloc's"; }
grep -q "mimalloc: malloc is redirected" "$TMP/on.log" \
  || { cat "$TMP/on.log"; fail "MIMALLOC_VERBOSE=1 did not report 'malloc is redirected'"; }

MIMALLOC_DISABLE_REDIRECT=1 FASTAG_TIMING=1 "$BIN" -in "$MZ" -out "$TMP/off.tsv" -threads 4 >"$TMP/off.log" 2>&1 \
  || { cat "$TMP/off.log"; fail "MIMALLOC_DISABLE_REDIRECT=1 run exited $?"; }
grep -E "FASTAG_ALLOC" "$TMP/off.log"
grep -qE "^FASTAG_ALLOC allocator=mimalloc version=[0-9]+ redirected=0" "$TMP/off.log" \
  || { cat "$TMP/off.log"; fail "MIMALLOC_DISABLE_REDIRECT=1 did not switch the redirection off"; }

[ "$(grep -c . "$TMP/on.tsv")" -gt 1 ] || fail "the redirected run wrote no tags"
cmp -s "$TMP/on.tsv" "$TMP/off.tsv" \
  || { diff "$TMP/on.tsv" "$TMP/off.tsv" | head; fail "tags differ between mimalloc and the CRT heap"; }
echo "mimalloc redirection active; switchable; tags byte-identical ($(grep -c . "$TMP/on.tsv") lines)"
