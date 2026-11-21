#!/usr/bin/env bash
# 1.15.5 (PREREG-lowres-defaults): -tolerance_by_analyzer (change B) and the complement window under a Da
# fragment tolerance (change A), on the E. coli fixture (139 MS2; its only instrument configuration names an
# Orbitrap analyzer, but its spectrum-level userParam filter strings say ITMS, and the filter string decides;
# the fast reader reads them since 1.15.7) and copies of it: the filter strings rewritten to FTMS (Orbitrap
# only), the configuration's analyzer rewritten to "ion trap" (ion trap only), and, without filter strings, a
# second ion-trap configuration referenced by every second scan (mixed: the configurations decide).
#   - Orbitrap only: on and off give byte-identical tags (the guard of the held-out test, H3).
#   - ion trap only: on gives the tags of a manual 0.5 Da + complement auto run (same probe, same window).
#   - mixed: both classes counted; the Orbitrap spectra keep the tags they get with the option off.
#   - change A: 0.5 Da without complement options measures the window (log), 0.5 Da with
#     -complement_tolerance_unit Da does not.
set -uo pipefail
BIN="$1"; IN="$2"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
run() { local name=$1 in=$2; shift 2; "$BIN" -in "$in" -out "$TMP/$name.tsv" -threads 2 "$@" > "$TMP/$name.out" 2> "$TMP/$name.err" \
          || { cat "$TMP/$name.err" >&2; fail "FASTag $name exited non-zero"; }; }
sed 's/name="filter string" type="xsd:string" value="ITMS /name="filter string" type="xsd:string" value="FTMS /' "$IN" > "$TMP/ftms.mzML"
grep -q 'value="ITMS ' "$TMP/ftms.mzML" && fail "Orbitrap copy keeps ITMS filter strings"
grep -v '<userParam name="filter string"' "$IN" > "$TMP/nofilter.mzML"
sed 's/accession="MS:1000484" name="orbitrap"/accession="MS:1000264" name="ion trap"/' "$IN" > "$TMP/itms.mzML"
grep -q 'name="ion trap"' "$TMP/itms.mzML" || fail "ion-trap copy"
# mixed: a copy of ic_0 as ic_1 with an ion-trap analyzer; every second <scan > refers to it
awk 'BEGIN { inic = 0 }
     /<instrumentConfigurationList count="1">/ { sub(/count="1"/, "count=\"2\"") }
     /<instrumentConfiguration id="ic_0">/ { inic = 1; buf = "" }
     inic { buf = buf $0 "\n" }
     /<\/instrumentConfiguration>/ && inic { inic = 0; printf "%s", buf; b2 = buf; sub(/id="ic_0"/, "id=\"ic_1\"", b2);
                                             sub(/accession="MS:1000484" name="orbitrap"/, "accession=\"MS:1000264\" name=\"ion trap\"", b2);
                                             printf "%s", b2; next }
     inic { next }
     /<scan >/ { n++; if (n % 2 == 1) sub(/<scan >/, "<scan instrumentConfigurationRef=\"ic_1\">") }
     { print }' "$TMP/nofilter.mzML" > "$TMP/mixed.mzML"
[ "$(grep -c 'instrumentConfigurationRef="ic_1"' "$TMP/mixed.mzML")" -ge 69 ] || fail "mixed copy"

# Orbitrap only: identical with the option on and off.
run ftms_on "$TMP/ftms.mzML"
run ftms_off "$TMP/ftms.mzML" -tolerance_by_analyzer off
cmp -s "$TMP/ftms_on.tsv" "$TMP/ftms_off.tsv" || fail "Orbitrap-only run: tags differ between on and off"
grep -q 'The probe draw found 0 ion-trap MS2' "$TMP/ftms_on.err" || fail "Orbitrap-only run: no probe line"

# The fixture itself: its ITMS filter strings make every MS2 ion trap, the Orbitrap configuration aside.
run fx_on "$IN"
grep -q 'Tolerance by analyzer: 139 ion-trap MS2 tagged at 0.5 Da, 0 other MS2' "$TMP/fx_on.err" \
  || { grep 'Tolerance by analyzer' "$TMP/fx_on.err" >&2; fail "fixture: its ITMS filter strings are not read"; }

# Ion trap only: on == manual 0.5 Da + complement auto.
run it_on "$TMP/itms.mzML"
run it_manual "$TMP/itms.mzML" -fragment_tolerance 0.5 -fragment_tolerance_unit Da -complement_tolerance_unit auto -tolerance_by_analyzer off
cmp -s "$TMP/it_on.tsv" "$TMP/it_manual.tsv" || fail "ion-trap run: on differs from the manual 0.5 Da + auto run"
grep -q 'Tolerance by analyzer: 139 ion-trap MS2 tagged at 0.5 Da, 0 other MS2' "$TMP/it_on.err" || fail "ion-trap counts"
run it_off "$TMP/itms.mzML" -tolerance_by_analyzer off
[ "$(wc -l < "$TMP/it_on.tsv")" -gt "$(wc -l < "$TMP/it_off.tsv")" ] || fail "ion-trap run: on does not tag more than off at 20 ppm"

# Mixed: both classes counted; FTMS spectra keep their tags.
run mx_on "$TMP/mixed.mzML"
run mx_off "$TMP/mixed.mzML" -tolerance_by_analyzer off
grep -qE 'Tolerance by analyzer: [1-9][0-9]* ion-trap MS2 tagged at 0.5 Da, [1-9][0-9]* other MS2' "$TMP/mx_on.err" || fail "mixed counts"
# Orbitrap spectra of the mixed copy: those whose <scan > kept no reference (the run default ic_0)
ftms_ids=$(awk 'match($0, /<spectrum [^>]*id="[^"]*"/) { t = substr($0, RSTART, RLENGTH); sub(/.*id="/, "", t); sub(/"$/, "", t); id = t }
                /<scan >/ { print id }' "$TMP/mixed.mzML" | sort -u)
n_ft=$(printf '%s\n' "$ftms_ids" | grep -c .)
[ "$n_ft" -ge 60 ] || fail "too few Orbitrap spectra in the mixed copy ($n_ft)"
[ -n "$ftms_ids" ] || fail "no FTMS ids in the mixed copy"
sel() { awk -F'\t' 'NR == FNR { k[$0] = 1; next } FNR == 1 || ($1 in k)' <(printf '%s\n' "$ftms_ids") "$1"; }
cmp -s <(sel "$TMP/mx_on.tsv") <(sel "$TMP/mx_off.tsv") || fail "mixed run: FTMS spectra changed their tags"

# Change A.
run a_auto "$TMP/itms.mzML" -fragment_tolerance 0.5 -fragment_tolerance_unit Da -tolerance_by_analyzer off
grep -q '^Complement tolerance (auto)' "$TMP/a_auto.err" || fail "A: no complement probe under Da"
run a_da "$TMP/itms.mzML" -fragment_tolerance 0.5 -fragment_tolerance_unit Da -complement_tolerance_unit Da -tolerance_by_analyzer off
grep -q '^Complement tolerance (auto)' "$TMP/a_da.err" && fail "A: complement probe although -complement_tolerance_unit Da was given"
echo "tolerance_by_analyzer_cli_test: all checks passed"
