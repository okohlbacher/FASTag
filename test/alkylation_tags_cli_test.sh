#!/usr/bin/env bash
# -alkylation_tags_out (1.13 #22, the database-free alkylation call) against
# the real binary: on synthetic single-Cys mzML written by
# alkylation_tags_test the call is the reagent the spectra carry (CAM, NEM)
# or none (unmodified C), also under the default fixed Carbamidomethyl that the
# shadow pass must drop; the tag TSV is byte-identical with and without the
# option (synthetic and the real fixture); -alkylation_min_spectra applies;
# refusals (-stream, a collision with -out) and the shared-option warning.
# Exits 77 (ctest SKIP) when the binary cannot start.
set -u
BIN="$1"
GEN="$2"   # alkylation_tags_test (--write-mzml)
FIXTURE="$3"

if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-alkt-test.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
# same EXPECTED ACTUAL MESSAGE: byte for byte (both written by this binary on this platform)
same() {
  cmp -s "$1" "$2" && return
  diff "$1" "$2" | head -8 | sed -n l >&2
  fail "$3"
}
# the alkylation sections only (the run rows name the input and the version)
alk() { tr -d '\r' < "$1" | awk -F'\t' '$1 != "run"'; }
run() { "$BIN" -threads 2 "$@" > "$TMP/log" 2>&1 || { cat "$TMP/log" >&2; fail "FASTag $*"; }; }
val() { tr -d '\r' < "$1" | awk -F'\t' -v s="$2" -v k="$3" '$1 == s && $2 == k { print $3; exit }'; }
call() { if [ "$(val "$1" alkylation_tags_call status)" = call ]; then val "$1" alkylation_tags_call reagent; else echo "no_call:$(val "$1" alkylation_tags_call reason)"; fi; }

for f in Carbamidomethyl Nethylmaleimide unmodified mixed; do
  "$GEN" --write-mzml "$TMP/$f.mzML" "$f" 60 || fail "cannot write the synthetic $f mzML"
done
# With -extension: a vote needs a C inside the tag, and length-3 tags without
# extension leave 6 voting spectra of 60 (no call: few_cys_spectra).
COMMON=(-tag_length 4 -extension 6 -fragment_tolerance 20 -fragment_tolerance_unit ppm)

# ---- the call per reagent; the tags unchanged
for f in Carbamidomethyl Nethylmaleimide unmodified; do
  run -in "$TMP/$f.mzML" -out "$TMP/$f.base.tsv" "${COMMON[@]}"
  run -in "$TMP/$f.mzML" -out "$TMP/$f.tsv" "${COMMON[@]}" -alkylation_tags_out "$TMP/$f.alkt.tsv"
  same "$TMP/$f.base.tsv" "$TMP/$f.tsv" "-alkylation_tags_out changed the tag TSV ($f)"
  [ -s "$TMP/$f.alkt.tsv" ] || fail "no report for $f"
  [ ! -e "$TMP/$f.alkt.tsv.part" ] || fail "a .part file was left for $f"
  grep -q "Alkylation (tags, no database)" "$TMP/log" || fail "no log line for $f"
done
[ "$(call "$TMP/Carbamidomethyl.alkt.tsv")" = Carbamidomethyl ] || fail "CAM spectra: call $(call "$TMP/Carbamidomethyl.alkt.tsv")"
[ "$(call "$TMP/Nethylmaleimide.alkt.tsv")" = Nethylmaleimide ] || fail "NEM spectra: call $(call "$TMP/Nethylmaleimide.alkt.tsv")"
[ "$(call "$TMP/unmodified.alkt.tsv")" = none ] || fail "unmodified spectra: call $(call "$TMP/unmodified.alkt.tsv")"
awk -v m="$(val "$TMP/Nethylmaleimide.alkt.tsv" alkylation_tags_call mass)" 'BEGIN { d = m - 125.047679; exit !(d < 1e-4 && d > -1e-4) }' \
  || fail "NEM mass row"
# The default fixed Carbamidomethyl (C) is dropped by the shadow pass.
[ "$(val "$TMP/Nethylmaleimide.alkt.tsv" alkt_run c_mods_removed)" = "Carbamidomethyl (fixed)" ] \
  || fail "c_mods_removed does not name the default fixed CAM"
# ... and with no C modification at all, the same call.
run -in "$TMP/Nethylmaleimide.mzML" -out "$TMP/nofix.tsv" "${COMMON[@]}" -fixed_modifications -alkylation_tags_out "$TMP/nofix.alkt.tsv"
[ "$(call "$TMP/nofix.alkt.tsv")" = Nethylmaleimide ] || fail "NEM without fixed mods: call $(call "$TMP/nofix.alkt.tsv")"
[ "$(val "$TMP/nofix.alkt.tsv" alkt_run c_mods_removed)" = "-" ] || fail "c_mods_removed without C mods"

# ---- feedback 202dbcf4: -alkylation_out needs no database. Its default call
# is this tag call (format 2, now 3): database_source none, no proteome read (an
# empty FASTAG_ALKYLATION_DIR), the alkt_* sections and the tag call equal to
# -alkylation_tags_out's, and alkylation_call with source tags.
mkdir -p "$TMP/noalk"
for f in Carbamidomethyl Nethylmaleimide unmodified; do
  FASTAG_ALKYLATION_DIR="$TMP/noalk" run -in "$TMP/$f.mzML" -out "$TMP/$f.o.tsv" "${COMMON[@]}" \
    -alkylation_out "$TMP/$f.alk.tsv" -alkylation_tags_out "$TMP/$f.both.alkt.tsv"
  same "$TMP/$f.base.tsv" "$TMP/$f.o.tsv" "-alkylation_out changed the tag TSV ($f)"
  [ "$(val "$TMP/$f.alk.tsv" alk_run format) $(val "$TMP/$f.alk.tsv" alk_run method) $(val "$TMP/$f.alk.tsv" alk_run database_source)" \
    = "4 tags none" ] || fail "$f: -alkylation_out is not a format 4 tag-only report"
  [ "$(val "$TMP/$f.alk.tsv" alkylation_call source)" = tags ] || fail "$f: source is not tags"
  tr -d '\r' < "$TMP/$f.alk.tsv" | awk -F'\t' '$1 ~ /^alkt_|^alkylation_tags_call$/' > "$TMP/$f.a.sec"
  tr -d '\r' < "$TMP/$f.alkt.tsv" | awk -F'\t' '$1 ~ /^alkt_|^alkylation_tags_call$/' > "$TMP/$f.t.sec"
  same "$TMP/$f.t.sec" "$TMP/$f.a.sec" "$f: the tag sections of -alkylation_out differ from -alkylation_tags_out"
  for k in status reagent share; do
    [ "$(val "$TMP/$f.alk.tsv" alkylation_call $k)" = "$(val "$TMP/$f.alkt.tsv" alkylation_tags_call $k)" ] \
      || fail "$f: alkylation_call $k is not the tag call's"
  done
  grep -q "Recon index" "$TMP/log" && fail "$f: a database was indexed"
  grep -q "^Alkylation: .* spectra vote from their tags, .*(tags) -> " "$TMP/log" || fail "$f: no -alkylation_out log line"
done
[ "$(val "$TMP/Carbamidomethyl.alk.tsv" alkylation_call reagent)" = Carbamidomethyl ] || fail "-alkylation_out CAM call"
[ "$(val "$TMP/Nethylmaleimide.alk.tsv" alkylation_call reagent)" = Nethylmaleimide ] || fail "-alkylation_out NEM call"
[ "$(val "$TMP/unmodified.alk.tsv" alkylation_call reagent)" = none ] || fail "-alkylation_out unmodified call"
# the tag-only alk_run: six rows, no placement section
[ "$(tr -d '\r' < "$TMP/Carbamidomethyl.alk.tsv" | awk -F'\t' '$1 == "alk_run" { k = k (k == "" ? "" : ",") $2 } END { print k }')" \
  = "format,method,database,database_source,min_spectra,min_share" ] || fail "tag-only alk_run rows"
tr -d '\r' < "$TMP/Carbamidomethyl.alk.tsv" | cut -f1 | grep -qx -e alk_cys -e alkylation_placement_call \
  && fail "placement sections without a database"
# -alkylation_out alone (no -alkylation_tags_out) gives the same report
FASTAG_ALKYLATION_DIR="$TMP/noalk" run -in "$TMP/Carbamidomethyl.mzML" -out "$TMP/alone.tsv" "${COMMON[@]}" -alkylation_out "$TMP/alone.alk.tsv"
same "$TMP/Carbamidomethyl.alk.tsv" "$TMP/alone.alk.tsv" "-alkylation_out alone differs from -alkylation_out with -alkylation_tags_out"
# -alkylation_min_share is read for it (two thirds CAM, one third NEM)
run -in "$TMP/mixed.mzML" -out "$TMP/mxa.tsv" "${COMMON[@]}" -alkylation_out "$TMP/mxa.alk.tsv" -alkylation_min_share 0.9
[ "$(val "$TMP/mxa.alk.tsv" alkylation_call status) $(val "$TMP/mxa.alk.tsv" alkylation_call reason)" = "no_call ambiguous" ] \
  || fail "-alkylation_out, mixed with -alkylation_min_share 0.9"
# a 0.5 Da run: CAM and Carboxymethyl are twins (one edge), no call, the twin row says it
run -in "$TMP/Carbamidomethyl.mzML" -out "$TMP/daa.tsv" -tag_length 4 -extension 6 -fragment_tolerance 0.5 -fragment_tolerance_unit Da \
  -alkylation_out "$TMP/daa.alk.tsv"
[ "$(val "$TMP/daa.alk.tsv" alkylation_call reason)" = unresolved_forms ] || fail "0.5 Da -alkylation_out: $(val "$TMP/daa.alk.tsv" alkylation_call reason)"
[ "$(val "$TMP/daa.alk.tsv" alkt_form twin.Carbamidomethyl)" = "C[Carboxymethyl]:0.9840" ] \
  || fail "0.5 Da: twin.Carbamidomethyl '$(val "$TMP/daa.alk.tsv" alkt_form twin.Carbamidomethyl)'"
# a variable modification without a twin (Oxidation (M), 147.035) leaves the
# twin rows empty and the call made (twins of a modification: alkylation_tags_test)
run -in "$TMP/Carbamidomethyl.mzML" -out "$TMP/vm.tsv" "${COMMON[@]}" -variable_modifications 'Oxidation (M)' \
  -alkylation_out "$TMP/vm.alk.tsv"
[ "$(val "$TMP/vm.alk.tsv" alkt_form twin.Carbamidomethyl) $(val "$TMP/vm.alk.tsv" alkt_run forms_resolved)" = "- yes" ] \
  || fail "Oxidation (M) made a twin"
[ "$(val "$TMP/vm.alk.tsv" alkylation_call reagent)" = Carbamidomethyl ] || fail "with Oxidation (M): no CAM call"

# ---- report structure
R="$TMP/Carbamidomethyl.alkt.tsv"
head -1 "$R" | tr -d '\r' | grep -qx $'section\tkey\tvalue\tn\tdescription' || fail "report header"
tr -d '\r' < "$R" | awk -F'\t' 'NF != 5 || $5 == "" { bad = 1 } END { exit bad }' || fail "a row without five fields"
[ "$(val "$R" alkt_run format)" = 4 ] || fail "alkt_run format is not 4"
for s in run alkt_run alkt_form alkylation_tags_call; do
  tr -d '\r' < "$R" | cut -f1 | grep -qx "$s" || fail "no $s section"
done
dups=$(tr -d '\r' < "$R" | cut -f1,2 | sort | uniq -d | wc -l)
[ "$dups" -eq 0 ] || fail "duplicate (section, key) rows"
votes=$(val "$R" alkt_form Carbamidomethyl)
spectra=$(val "$R" alkt_run spectra)
[ "$votes" -ge 30 ] || fail "only $votes CAM votes of 60 spectra"
[ "$spectra" -le "$(val "$R" alkt_run spectra_tagged)" ] || fail "more voting spectra than tagged"
[ "$(val "$R" alkt_run spectra_tagged)" = 60 ] || fail "spectra_tagged is not 60"

# ---- the report does not depend on the thread count or on the run's output selection
"$BIN" -threads 1 -in "$TMP/Carbamidomethyl.mzML" -out "$TMP/t1.tsv" "${COMMON[@]}" -alkylation_tags_out "$TMP/t1.alkt.tsv" >"$TMP/log" 2>&1 \
  || { cat "$TMP/log" >&2; fail "-threads 1"; }
"$BIN" -threads 4 -in "$TMP/Carbamidomethyl.mzML" -out "$TMP/t4.tsv" "${COMMON[@]}" -alkylation_tags_out "$TMP/t4.alkt.tsv" >"$TMP/log" 2>&1 \
  || { cat "$TMP/log" >&2; fail "-threads 4"; }
alk "$TMP/t1.alkt.tsv" > "$TMP/t1.alk"; alk "$TMP/t4.alkt.tsv" > "$TMP/t4.alk"; alk "$R" > "$TMP/t2.alk"
same "$TMP/t1.alk" "$TMP/t4.alk" "the report differs between 1 and 4 threads"
same "$TMP/t1.alk" "$TMP/t2.alk" "the report differs between 1 and 2 threads"
run -in "$TMP/Carbamidomethyl.mzML" -out "$TMP/cap.tsv" "${COMMON[@]}" -max_tags 1 -max_evalue 0.01 -alkylation_tags_out "$TMP/cap.alkt.tsv"
alk "$TMP/cap.alkt.tsv" > "$TMP/cap.alk"
same "$TMP/t1.alk" "$TMP/cap.alk" "-max_tags/-max_evalue changed the alkylation report"

# ---- -alkylation_min_share applies (two thirds CAM, one third NEM)
run -in "$TMP/mixed.mzML" -out "$TMP/mx.tsv" "${COMMON[@]}" -alkylation_tags_out "$TMP/mx.alkt.tsv"
[ "$(call "$TMP/mx.alkt.tsv")" = Carbamidomethyl ] || fail "mixed (2:1) spectra: call $(call "$TMP/mx.alkt.tsv")"
run -in "$TMP/mixed.mzML" -out "$TMP/mx2.tsv" "${COMMON[@]}" -alkylation_tags_out "$TMP/mx2.alkt.tsv" -alkylation_min_share 0.9
[ "$(call "$TMP/mx2.alkt.tsv")" = "no_call:ambiguous" ] || fail "mixed with -alkylation_min_share 0.9: $(call "$TMP/mx2.alkt.tsv")"
grep -q -- "-alkylation_min_share is only read for" "$TMP/log" && fail "warned about -alkylation_min_share with -alkylation_tags_out"

# ---- a 0.5 Da run cannot resolve CAM from Carboxymethyl: no call
run -in "$TMP/Carbamidomethyl.mzML" -out "$TMP/da.tsv" -tag_length 4 -extension 6 -fragment_tolerance 0.5 -fragment_tolerance_unit Da \
  -alkylation_tags_out "$TMP/da.alkt.tsv"
[ "$(call "$TMP/da.alkt.tsv")" = "no_call:unresolved_forms" ] || fail "0.5 Da: $(call "$TMP/da.alkt.tsv")"
[ "$(val "$TMP/da.alkt.tsv" alkt_run forms_resolved)" = no ] || fail "0.5 Da: forms_resolved is not no"
# format 3 (review n2): at 0.5 Da no m/z resolves CAM from Carboxymethyl: no CAM
# vote is kept, the CAM edges are set aside as unresolved (forms without a twin,
# such as Methylthio, still vote; the call stays unresolved_forms)
[ "$(val "$TMP/da.alkt.tsv" alkt_run resolved_below_mz)" = 0 ] || fail "0.5 Da: resolved_below_mz is not 0"
[ "$(val "$TMP/da.alkt.tsv" alkt_form Carbamidomethyl)" = 0 ] \
  && [ "$(val "$TMP/da.alkt.tsv" alkt_form unresolved)" -gt "$(val "$TMP/da.alkt.tsv" alkt_run spectra)" ] \
  || fail "0.5 Da: the CAM votes are not set aside as unresolved"
# ... while in ppm the guard is per vote at the C edge's m/z: at 500 ppm (0.5 Da
# at 1000 m/z, where the run-wide guard of format 2 made no call) the CAM
# edges below 984 m/z resolve, and the run is called
run -in "$TMP/Carbamidomethyl.mzML" -out "$TMP/p500.tsv" -tag_length 4 -extension 6 -fragment_tolerance 500 \
  -fragment_tolerance_unit ppm -alkylation_tags_out "$TMP/p500.alkt.tsv"
[ "$(call "$TMP/p500.alkt.tsv")" = Carbamidomethyl ] || fail "500 ppm: $(call "$TMP/p500.alkt.tsv")"
[ "$(val "$TMP/p500.alkt.tsv" alkt_run forms_resolved)" = no ] || fail "500 ppm: forms_resolved at 1000 m/z is not no"
case "$(val "$TMP/p500.alkt.tsv" alkt_run resolved_below_mz)" in 984.01*) ;; *) fail "500 ppm: resolved_below_mz $(val "$TMP/p500.alkt.tsv" alkt_run resolved_below_mz)";; esac
# the share's n is the votes plus the conflicts (review n3), and the voted row says so
awk -v n="$(tr -d '\r' < "$TMP/p500.alkt.tsv" | awk -F'\t' '$1 == "alkylation_tags_call" && $2 == "share" { print $4 }')" \
    -v b="$(val "$TMP/p500.alkt.tsv" alkt_form conflict)" -v v="$(val "$TMP/p500.alkt.tsv" alkylation_tags_call voted)" \
    -v s="$(val "$TMP/p500.alkt.tsv" alkt_run spectra)" 'BEGIN { exit !(n == v && v == s && b > 0) }' \
  || fail "500 ppm: the share's n is not votes plus conflicts"
[ "$(val "$R" alkt_form alias_rejected)" = 0 ] || fail "20 ppm CAM: alias_rejected $(val "$R" alkt_form alias_rejected)"
[ "$(val "$R" alkt_run forms_resolved)" = yes ] || fail "20 ppm: forms_resolved is not yes"
val "$R" alkt_form alias.Propionamide | grep -q "S+S" || fail "20 ppm: S+S is not an alias of Propionamide"
[ "$(val "$R" alkt_form alias.Carboxymethyl)" = "C[Carbamidomethyl]+13C:0.0193" ] \
  || fail "20 ppm: the isotope twin is not the alias of Carboxymethyl"
[ "$(val "$R" alkt_run status)" = experimental ] || fail "alkt_run status is not experimental"
grep -q "held-out test passed at the margin, 40 of 57 runs called and 37 of the calls right" "$R" \
  || fail "the report does not state the held-out result"
grep -q "not tested on held-out data" "$R" && fail "the report still says that it is untested on held-out data"

# ---- -alkylation_min_spectra applies
run -in "$TMP/Carbamidomethyl.mzML" -out "$TMP/ms.tsv" "${COMMON[@]}" -alkylation_tags_out "$TMP/ms.alkt.tsv" \
  -alkylation_min_spectra 1000
[ "$(call "$TMP/ms.alkt.tsv")" = "no_call:few_cys_spectra" ] || fail "-alkylation_min_spectra 1000: $(call "$TMP/ms.alkt.tsv")"
grep -q -- "-alkylation_min_spectra is only read for" "$TMP/log" && fail "warned about -alkylation_min_spectra with -alkylation_tags_out"
run -in "$TMP/Carbamidomethyl.mzML" -out "$TMP/w.tsv" "${COMMON[@]}" -alkylation_min_spectra 5
grep -q -- "-alkylation_min_spectra is only read for -alkylation_out; it is ignored here" "$TMP/log" \
  || fail "the warning without either alkylation report changed"

# ---- the real fixture: tags unchanged, a report written
FCOM=(-in "$FIXTURE" -tag_length 4 -fragment_tolerance 0.5 -fragment_tolerance_unit Da)
run "${FCOM[@]}" -out "$TMP/fx.base.tsv"
run "${FCOM[@]}" -out "$TMP/fx.tsv" -alkylation_tags_out "$TMP/fx.alkt.tsv"
same "$TMP/fx.base.tsv" "$TMP/fx.tsv" "-alkylation_tags_out changed the fixture's tag TSV"
[ "$(val "$TMP/fx.alkt.tsv" alkt_run spectra_tagged)" -gt 0 ] || fail "fixture: nothing shadow-tagged"

# ---- refusals
"$BIN" -stream -alkylation_tags_out "$TMP/s.tsv" </dev/null >"$TMP/s.log" 2>&1 && fail "-stream -alkylation_tags_out ran"
grep -q "alkylation_tags_out" "$TMP/s.log" || fail "no -stream refusal naming -alkylation_tags_out"
"$BIN" -in "$TMP/unmodified.mzML" -out "$TMP/c.tsv" -alkylation_tags_out "$TMP/c.tsv" "${COMMON[@]}" >"$TMP/c.log" 2>&1 \
  && fail "-alkylation_tags_out equal to -out ran"
grep -q "name the same file" "$TMP/c.log" || fail "no message for -alkylation_tags_out equal to -out"
echo "alkylation_tags_cli_test: PASS"
