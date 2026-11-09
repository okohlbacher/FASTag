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
same() {
  tr -d '\r' < "$1" > "$1.lf" && tr -d '\r' < "$2" > "$2.lf" || fail "cannot read $1 or $2"
  cmp -s "$1.lf" "$2.lf" && return
  diff "$1.lf" "$2.lf" | head -8 | sed -n l >&2
  fail "$3"
}
run() { "$BIN" -threads 2 "$@" > "$TMP/log" 2>&1 || { cat "$TMP/log" >&2; fail "FASTag $*"; }; }
val() { tr -d '\r' < "$1" | awk -F'\t' -v s="$2" -v k="$3" '$1 == s && $2 == k { print $3; exit }'; }
call() { if [ "$(val "$1" alkylation_tags_call status)" = call ]; then val "$1" alkylation_tags_call reagent; else echo "no_call:$(val "$1" alkylation_tags_call reason)"; fi; }

for f in Carbamidomethyl Nethylmaleimide unmodified; do
  "$GEN" --write-mzml "$TMP/$f.mzML" "$f" 60 || fail "cannot write the synthetic $f mzML"
done
COMMON=(-tag_length 3 -fragment_tolerance 20 -fragment_tolerance_unit ppm)

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

# ---- report structure
R="$TMP/Carbamidomethyl.alkt.tsv"
head -1 "$R" | tr -d '\r' | grep -qx $'section\tkey\tvalue\tn\tdescription' || fail "report header"
tr -d '\r' < "$R" | awk -F'\t' 'NF != 5 || $5 == "" { bad = 1 } END { exit bad }' || fail "a row without five fields"
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
