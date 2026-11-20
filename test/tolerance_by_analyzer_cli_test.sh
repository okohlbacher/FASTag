#!/usr/bin/env bash
# 1.15.5 (PREREG-lowres-defaults): -tolerance_by_analyzer (change B) and the complement window under a Da
# fragment tolerance (change A), on the E. coli fixture (139 ion-trap MS2, "ITMS" filter strings) and two
# copies of it: every filter string rewritten to FTMS (Orbitrap only) and every second one (mixed).
#   - Orbitrap only: on and off give byte-identical tags (the guard of the held-out test, H3).
#   - ion trap only: on gives the tags of a manual 0.5 Da + complement auto run (same probe, same window).
#   - mixed: both classes counted; the FTMS spectra keep the tags they get with the option off.
#   - change A: 0.5 Da without complement options measures the window (log), 0.5 Da with
#     -complement_tolerance_unit Da does not.
set -uo pipefail
BIN="$1"; IN="$2"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
run() { local name=$1 in=$2; shift 2; "$BIN" -in "$in" -out "$TMP/$name.tsv" -threads 2 "$@" > "$TMP/$name.out" 2> "$TMP/$name.err" \
          || { cat "$TMP/$name.err" >&2; fail "FASTag $name exited non-zero"; }; }
sed 's/value="ITMS /value="FTMS /' "$IN" > "$TMP/ftms.mzML"
awk '/value="ITMS / { n++; if (n % 2 == 0) sub(/value="ITMS /, "value=\"FTMS ") } { print }' "$IN" > "$TMP/mixed.mzML"
[ "$(grep -c 'value="FTMS ' "$TMP/ftms.mzML")" = 139 ] || fail "FTMS copy"
[ "$(grep -c 'value="FTMS ' "$TMP/mixed.mzML")" = 69 ] || fail "mixed copy"

# Orbitrap only: identical with the option on and off.
run ftms_on "$TMP/ftms.mzML"
run ftms_off "$TMP/ftms.mzML" -tolerance_by_analyzer off
cmp -s "$TMP/ftms_on.tsv" "$TMP/ftms_off.tsv" || fail "Orbitrap-only run: tags differ between on and off"
grep -q 'The probe draw found 0 ion-trap MS2' "$TMP/ftms_on.err" || fail "Orbitrap-only run: no probe line"

# Ion trap only: on == manual 0.5 Da + complement auto.
run it_on "$IN"
run it_manual "$IN" -fragment_tolerance 0.5 -fragment_tolerance_unit Da -complement_tolerance_unit auto -tolerance_by_analyzer off
cmp -s "$TMP/it_on.tsv" "$TMP/it_manual.tsv" || fail "ion-trap run: on differs from the manual 0.5 Da + auto run"
grep -q 'Tolerance by analyzer: 139 ion-trap MS2 tagged at 0.5 Da, 0 other MS2' "$TMP/it_on.err" || fail "ion-trap counts"
run it_off "$IN" -tolerance_by_analyzer off
[ "$(wc -l < "$TMP/it_on.tsv")" -gt "$(wc -l < "$TMP/it_off.tsv")" ] || fail "ion-trap run: on does not tag more than off at 20 ppm"

# Mixed: both classes counted; FTMS spectra keep their tags.
run mx_on "$TMP/mixed.mzML"
run mx_off "$TMP/mixed.mzML" -tolerance_by_analyzer off
grep -q 'Tolerance by analyzer: 70 ion-trap MS2 tagged at 0.5 Da, 69 other MS2' "$TMP/mx_on.err" || fail "mixed counts"
ftms_ids=$(awk 'match($0, /<spectrum [^>]*id="[^"]*"/) { t = substr($0, RSTART, RLENGTH); sub(/.*id="/, "", t); sub(/"$/, "", t); id = t }
                /value="FTMS / { print id }' "$TMP/mixed.mzML" | sort -u)
[ "$(printf '%s\n' "$ftms_ids" | wc -l)" = 69 ] || fail "expected 69 FTMS spectrum ids"
[ -n "$ftms_ids" ] || fail "no FTMS ids in the mixed copy"
sel() { awk -F'\t' 'NR == FNR { k[$0] = 1; next } FNR == 1 || ($1 in k)' <(printf '%s\n' "$ftms_ids") "$1"; }
cmp -s <(sel "$TMP/mx_on.tsv") <(sel "$TMP/mx_off.tsv") || fail "mixed run: FTMS spectra changed their tags"

# Change A.
run a_auto "$IN" -fragment_tolerance 0.5 -fragment_tolerance_unit Da -tolerance_by_analyzer off
grep -q '^Complement tolerance (auto)' "$TMP/a_auto.err" || fail "A: no complement probe under Da"
run a_da "$IN" -fragment_tolerance 0.5 -fragment_tolerance_unit Da -complement_tolerance_unit Da -tolerance_by_analyzer off
grep -q '^Complement tolerance (auto)' "$TMP/a_da.err" && fail "A: complement probe although -complement_tolerance_unit Da was given"
echo "tolerance_by_analyzer_cli_test: all checks passed"
