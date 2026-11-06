#!/usr/bin/env bash
# tools/baseline_iface_added.py, the harness's interface rule ("new options
# may ADD lines, nothing existing may change"), on synthetic --help and CTD
# files: whole blocks of new options pass as ADDED; a line added inside an
# existing option's block, a changed line, a removed line, or an added line
# for a name the baseline CTD already has, is DIFF.
# Exits 77 (ctest SKIP) without python3.
set -u
CHECK="$1"   # tools/baseline_iface_added.py
PY=${FASTAG_PYTHON:-}
if [ -z "$PY" ]; then for c in python3 python; do command -v "$c" >/dev/null 2>&1 && { PY=$c; break; }; done; fi
[ -n "$PY" ] || { echo "SKIP: no python3" >&2; exit 77; }
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-iface-test.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
nfail=0
expect() { # want kind base cand
  local got st
  st=$("$PY" "$CHECK" "$2" "$TMP/$3" "$TMP/$4" "$TMP/b.ctd" "$TMP/c.ctd"); got=$?
  if { [ "$1" = ADDED ] && [ $got = 0 ]; } || { [ "$1" = DIFF ] && [ $got = 1 ]; }; then echo "ok   $1 $4: $st"
  else echo "FAIL want $1 for $4, got exit $got: $st" >&2; nfail=$((nfail + 1)); fi
}
cat > "$TMP/b.ctd" <<'X'
<NODE name="FASTag" description="x">
      <ITEM name="in" value="" type="input-file" description="input" required="true" advanced="false" />
      <ITEM name="max_tags" value="5" type="int" description="tags" required="false" advanced="false" />
      <ITEMLIST name="fixed_modifications" type="string" description="mods" required="false" advanced="false">
        <LISTITEM value="Carbamidomethyl (C)"/>
      </ITEMLIST>
      <ITEM name="threads" value="1" type="int" description="threads" required="false" advanced="false" />
</NODE>
X
# a new ITEM and a new ITEMLIST, each a whole block
awk '{ print } /name="max_tags"/ { print "      <ITEM name=\"pick_profile\" value=\"legacy\" type=\"string\" description=\"p\" required=\"false\" advanced=\"false\" />";
       print "      <ITEMLIST name=\"new_list\" type=\"string\" description=\"l\" required=\"false\" advanced=\"false\">";
       print "        <LISTITEM value=\"a\"/>"; print "      </ITEMLIST>" }' "$TMP/b.ctd" > "$TMP/c.ctd"
expect ADDED ctd b.ctd c.ctd
# an extra LISTITEM inside the existing ITEMLIST
awk '{ print } /Carbamidomethyl/ { print "        <LISTITEM value=\"Oxidation (M)\"/>" }' "$TMP/c.ctd" > "$TMP/c_inner.ctd"
cp "$TMP/c.ctd" "$TMP/keep.ctd"
"$PY" "$CHECK" ctd "$TMP/b.ctd" "$TMP/c_inner.ctd" "$TMP/b.ctd" "$TMP/keep.ctd" > /dev/null && { echo "FAIL LISTITEM in an existing list passed" >&2; nfail=$((nfail + 1)); } || echo "ok   DIFF c_inner.ctd"
# a changed attribute of an existing ITEM
sed 's/value="5"/value="6"/' "$TMP/c.ctd" > "$TMP/c_changed.ctd"
"$PY" "$CHECK" ctd "$TMP/b.ctd" "$TMP/c_changed.ctd" "$TMP/b.ctd" "$TMP/c.ctd" > /dev/null && { echo "FAIL changed ITEM passed" >&2; nfail=$((nfail + 1)); } || echo "ok   DIFF c_changed.ctd"
# a duplicate ITEM line for an existing name is not a new option
awk '{ print } /name="threads"/ { print }' "$TMP/b.ctd" > "$TMP/c_dup.ctd"
"$PY" "$CHECK" ctd "$TMP/b.ctd" "$TMP/c_dup.ctd" "$TMP/b.ctd" "$TMP/c_dup.ctd" > /dev/null && { echo "FAIL duplicate ITEM passed" >&2; nfail=$((nfail + 1)); } || echo "ok   DIFF c_dup.ctd"

cat > "$TMP/b.help" <<'X'
FASTag -- de novo sequence tags
Version: @FASTAG_VERSION@

Options (mandatory options marked with '*'):
  -in <file>*                Input spectra (valid formats: 'mzML')
  -max_tags <number>         Tags per spectrum (default: '5')
                             wrapped continuation of max_tags
  -threads <n>               Threads (default: '1')

X
awk '{ print } /continuation of max_tags/ { print "  -pick_profile <mode>       Centroid profile MS2 (default: '"'"'legacy'"'"')";
       print "                             wrapped continuation of pick_profile";
       print "  -new_list <list>           l" }' "$TMP/b.help" > "$TMP/c.help"
expect ADDED help b.help c.help
# an extra help line under the existing -max_tags (before the new block)
awk '{ print } /continuation of max_tags/ { print "                             an extra max_tags line" }' "$TMP/c.help" > "$TMP/c_extra.help"
expect DIFF help b.help c_extra.help
# an extra help line under the existing -threads (no new option next to it)
awk '{ print } /-threads/ { print "                             an extra threads line" }' "$TMP/b.help" > "$TMP/c_extra2.help"
expect DIFF help b.help c_extra2.help
# a removed help line
grep -v 'continuation of max_tags' "$TMP/c.help" > "$TMP/c_removed.help"
expect DIFF help b.help c_removed.help
# an added blank line or section heading
awk '{ print } /-threads/ { print ""; print "Advanced:" }' "$TMP/b.help" > "$TMP/c_section.help"
expect DIFF help b.help c_section.help
[ $nfail = 0 ] || { echo "baseline_iface_added_test: $nfail failures" >&2; exit 1; }
echo "baseline_iface_added_test: passed"
