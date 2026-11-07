#!/usr/bin/env bash
# -digest_out, -label_out and -massgap_out against the real binary on the
# vendored fixture: the existing outputs are byte-identical with and without
# them, every report row has five fields, the counts agree with a recount of
# the tag TSV, a synthetic -digest_models table is used as given, the
# -massgap_out histogram is the -delta_out one, FASTAG_FULL_PRECISION only
# widens the masses, and the refusals hold.
# Exits 77 (ctest SKIP) when the binary cannot start.
set -u
BIN="$1"
IN="$2"
DB="$3"
DATA="$4"   # data/digest
BUILDTAXDB="${5:-}"  # optional: buildtaxdb, for the species-independence check (1.12 D #3c)
TAXDIR="${6:-}"      # optional: data/taxonomy (nodes.dmp, names.dmp)
FIX="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/fixtures"

if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi
export FASTAG_DIGEST_DIR="$DATA"
unset FASTAG_FULL_PRECISION

TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-digest-test.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
# same EXPECTED ACTUAL MESSAGE, line endings aside (Windows writes CRLF)
same() {
  tr -d '\r' < "$1" > "$1.lf" && tr -d '\r' < "$2" > "$2.lf" || fail "cannot read $1 or $2"
  cmp -s "$1.lf" "$2.lf" && return
  diff "$1.lf" "$2.lf" | head -8 | sed -n l >&2
  fail "$3"
}
run() { "$BIN" -threads 2 "$@" > "$TMP/log" 2>&1 || { cat "$TMP/log" >&2; fail "FASTag $*"; }; }
# val FILE SECTION KEY
val() { tr -d '\r' < "$1" | awk -F'\t' -v s="$2" -v k="$3" '$1 == s && $2 == k { print $3; exit }'; }

# The fixture's MS2 is ion trap: at 20 ppm almost no tag passes E <= 1.
COMMON=(-in "$IN" -tag_length 4 -fragment_tolerance 0.5 -fragment_tolerance_unit Da)

# ---- existing outputs unchanged, report structure
run "${COMMON[@]}" -out "$TMP/base.tsv"
run "${COMMON[@]}" -out "$TMP/d.tsv" -digest_out "$TMP/digest.tsv" -label_out "$TMP/label.tsv"
same "$TMP/base.tsv" "$TMP/d.tsv" "-digest_out/-label_out changed the tag TSV"
for f in digest label; do
  head -1 "$TMP/$f.tsv" | tr -d '\r' | grep -qx $'section\tkey\tvalue\tn\tdescription' || fail "$f header"
  tr -d '\r' < "$TMP/$f.tsv" | awk -F'\t' 'NF != 5 || $5 == "" { bad = 1 } END { exit bad }' \
    || fail "$f: a row without five fields or a description"
done
for s in run meta count residue pos share nocall call; do
  tr -d '\r' < "$TMP/digest.tsv" | cut -f1 | grep -qx "$s" || fail "digest: no $s section"
done
merged=0
for k in K K+TMT K+TMTpro K+iTRAQ4 K+8; do merged=$((merged + $(val "$TMP/digest.tsv" residue "C.$k"))); done
[ "$(val "$TMP/digest.tsv" pos C.P1.K)" = "$merged" ] || fail "C.P1.K is not the merged K"
# A Da run is written, as no_call.
[ "$(val "$TMP/digest.tsv" call status) $(val "$TMP/digest.tsv" call reason)" = "no_call low_resolution" ] \
  || fail "a Da run is not no_call low_resolution"
[ "$(val "$TMP/digest.tsv" count tags_filtered)" -gt 100 ] || fail "fewer than 100 filtered tags on the fixture"
[ "$(val "$TMP/digest.tsv" run background)" = shipped_human ] || fail "default background is not the shipped one"

# ---- counts against a recount of the full-precision tag TSV
FASTAG_FULL_PRECISION=1 run "${COMMON[@]}" -out "$TMP/full.tsv"
[ "$(wc -l < "$TMP/full.tsv")" = "$(wc -l < "$TMP/base.tsv")" ] || fail "FASTAG_FULL_PRECISION changed the row count"
# full-precision masses round to the default 4 decimals
tr -d '\r' < "$TMP/full.tsv" | awk -F'\t' 'NR > 1 { printf "%.4f\t%.4f\n", $5, $6 }' > "$TMP/full46"
tr -d '\r' < "$TMP/base.tsv" | awk -F'\t' 'NR > 1 { print $5 "\t" $6 }' > "$TMP/base46"
same "$TMP/base46" "$TMP/full46" "full-precision masses do not round to the default ones"
tr -d '\r' < "$TMP/full.tsv" | cut -f1-4,7,8,10- > "$TMP/full.rest"
tr -d '\r' < "$TMP/base.tsv" | cut -f1-4,7,8,10- > "$TMP/base.rest"
same "$TMP/base.rest" "$TMP/full.rest" "FASTAG_FULL_PRECISION changed a column other than the masses and evalue"
recount=$(tr -d '\r' < "$TMP/full.tsv" | awk -F'\t' -v w=0.008 '
  NR > 1 && $8 == "0" && $9 + 0 <= 1 {
    n++; m = 156.10111; mh = m + 18.010565
    if ($6 >= m - w && $6 <= m + w) r++
    if ($5 >= mh - w && $5 <= mh + w) r++
  } END { print n + 0, r + 0 }')
[ "$recount" = "$(val "$TMP/digest.tsv" count tags_filtered) $(val "$TMP/digest.tsv" residue C.R)" ] \
  || fail "recount (tags, C-terminal R) $recount differs from the report"

# ---- a synthetic model table is read as given, its background wins over a FASTA
{
  printf '# synthetic\nmodel\tclass\tend\tresidue\tfreq\n'
  for e in C N; do for a in G A S P V T C L N D Q K E M H F R Y W; do printf 'background\t-\t%s\t%s\t1\n' $e $a; done; done
  printf 'KR\tKR\tC\tK\t1\nKR\tKR\tC\tR\t1\nflat\tnone\tC\t*\t-\n'
} > "$TMP/models.tsv"
run "${COMMON[@]}" -out "$TMP/m.tsv" -digest_models "$TMP/models.tsv" -digest_out "$TMP/digest2.tsv" -fasta "$DB" -digest_tag_min 1
[ "$(val "$TMP/digest2.tsv" run background)" = models_table ] || fail "the table's background did not win over -fasta"
[ "$(val "$TMP/digest2.tsv" model KR.class)" = KR ] || fail "model KR not scored"
[ -n "$(val "$TMP/digest2.tsv" model flat.loglik)" ] || fail "model flat not scored"
# the distributions behind the scores: the table's background, KR normalised, flat's C end the background
[ "$(val "$TMP/digest2.tsv" background C.K)" = "$(val "$TMP/digest2.tsv" background N.W)" ] || fail "uniform background not reported"
[ "$(val "$TMP/digest2.tsv" model KR.C.K) $(val "$TMP/digest2.tsv" model KR.C.G)" = "0.5 0" ] || fail "KR's C end is not K, R at 0.5"
[ "$(val "$TMP/digest2.tsv" model flat.C.A)" = "$(val "$TMP/digest2.tsv" background C.A)" ] || fail "flat's C end is not the background"
[ "$(tr -d '\r' < "$TMP/digest2.tsv" | awk -F'\t' '$1 == "background"' | wc -l | tr -d ' ')" = 38 ] || fail "background rows are not 2 x 19"
printf 'model\tclass\tend\tresidue\tfreq\nKR\tKR\tC\tK\t1\n' > "$TMP/nobg.tsv"
run "${COMMON[@]}" -out "$TMP/m.tsv" -digest_models "$TMP/nobg.tsv" -digest_out "$TMP/digest3.tsv" -fasta "$DB"
[ "$(val "$TMP/digest3.tsv" run background)" = "fasta:$DB" ] || fail "a table without background does not take the FASTA's"
printf 'model\tclass\tend\tresidue\tfreq\nKR\tKR\tC\tI\t1\n' > "$TMP/bad.tsv"
"$BIN" "${COMMON[@]}" -out "$TMP/m.tsv" -digest_models "$TMP/bad.tsv" -digest_out "$TMP/x.tsv" > "$TMP/log" 2>&1 \
  && fail "a malformed -digest_models was accepted"

# ---- mass gaps: the -delta_out histogram, other outputs unchanged
R=(-recon_fasta "$DB" -recon_out "$TMP/recon.tsv" -fixed_modifications)
run "${COMMON[@]}" -out "$TMP/g0.tsv" "${R[@]}" -delta_out "$TMP/delta0.tsv"
cp "$TMP/recon.tsv" "$TMP/recon0.tsv"
run "${COMMON[@]}" -out "$TMP/g1.tsv" "${R[@]}" -delta_out "$TMP/delta1.tsv" -massgap_out "$TMP/gap1.tsv"
same "$TMP/g0.tsv" "$TMP/g1.tsv" "-massgap_out changed the tag TSV"
same "$TMP/recon0.tsv" "$TMP/recon.tsv" "-massgap_out changed -recon_out"
same "$TMP/delta0.tsv" "$TMP/delta1.tsv" "-massgap_out changed -delta_out"
run "${COMMON[@]}" -out "$TMP/g2.tsv" "${R[@]}" -massgap_out "$TMP/gap2.tsv"
tr -d '\r' < "$TMP/delta0.tsv" | awk -F'\t' 'NR > 1 { print $1 "\t" $2 }' > "$TMP/hist.want"
for g in gap1 gap2; do
  tr -d '\r' < "$TMP/$g.tsv" | awk -F'\t' '$1 == "hist" { print $2 "\t" $3 }' > "$TMP/$g.hist"
  same "$TMP/hist.want" "$TMP/$g.hist" "$g: the hist rows are not the -delta_out rows"
  tr -d '\r' < "$TMP/$g.tsv" | awk -F'\t' 'NF != 5 || $5 == "" { bad = 1 } END { exit bad }' || fail "$g: a malformed row"
done
[ "$(val "$TMP/gap2.tsv" cys spectra)" = "$(awk -F'\t' 'NR > 1 { s += $2 } END { print s + 0 }' "$TMP/delta0.tsv")" ] \
  || fail "cys spectra is not the histogram total"

# ---- label_call (1.12 #3a): five rows appended after the 1.11 rows
# the rows before label_call are the 1.11.0 binary's -label_out on the same run
# (test/fixtures/label_1.11.0_Ecoli_MS2_small_Da.tsv), the run version row aside
legacy() { tr -d '\r' < "$1" | awk -F'\t' '$1 != "label_call" && !($1 == "run" && $2 == "version")'; }
legacy "$TMP/label.tsv" > "$TMP/label.old"
legacy "$FIX/label_1.11.0_Ecoli_MS2_small_Da.tsv" > "$TMP/label.want"
same "$TMP/label.want" "$TMP/label.old" "-label_out: the rows before label_call are not the 1.11.0 rows"
tr -d '\r' < "$TMP/label.tsv" | awk -F'\t' -v n="$(tr -d '\r' < "$TMP/label.tsv" | wc -l)" '
  $1 == "label_call" { keys = keys (keys == "" ? "" : ",") $2; if (NR <= n - 5) early = 1 }
  END { if (early || keys != "status,label,basis,silac,reason") { print keys; exit 1 } }' \
  || fail "-label_out: label_call is not the last five rows status, label, basis, silac, reason"
[ "$(val "$TMP/label.tsv" label_call status) $(val "$TMP/label.tsv" label_call reason)" = "no_call low_resolution" ] \
  || fail "label_call: a Da run is not no_call low_resolution"
# a ppm run: few_tags exactly when the digest counts fewer than 175 C-terminal tag ends
run -in "$IN" -tag_length 4 -out "$TMP/p.tsv" -digest_out "$TMP/pdigest.tsv" -label_out "$TMP/plabel.tsv"
ptot=$(val "$TMP/pdigest.tsv" count tot)
pcall="$(val "$TMP/plabel.tsv" label_call status) $(val "$TMP/plabel.tsv" label_call reason)"
if [ "$ptot" -lt 175 ]; then [ "$pcall" = "no_call few_tags" ] || fail "label_call: $ptot tag ends at 20 ppm gave '$pcall'"
else [ "$pcall" = "call -" ] || fail "label_call: $ptot tag ends at 20 ppm gave '$pcall'"; fi
# label_call reads the tag ends only: the same with and without -recon_out/-massgap_out, at 1, 2 and 3
# threads (all with R's empty -fixed_modifications, which changes the tags themselves)
run "${COMMON[@]}" -out "$TMP/l0.tsv" -fixed_modifications -label_out "$TMP/label0.tsv"
run "${COMMON[@]}" -out "$TMP/l1.tsv" "${R[@]}" -delta_out "$TMP/delta2.tsv" -label_out "$TMP/label1.tsv"
run "${COMMON[@]}" -out "$TMP/l2.tsv" "${R[@]}" -delta_out "$TMP/delta3.tsv" -massgap_out "$TMP/gap3.tsv" -label_out "$TMP/label2.tsv"
same "$TMP/label1.tsv" "$TMP/label2.tsv" "-massgap_out changed -label_out"
same "$TMP/label0.tsv" "$TMP/label1.tsv" "-recon_out changed -label_out"
"$BIN" "${COMMON[@]}" -threads 1 -out "$TMP/l3.tsv" -fixed_modifications -label_out "$TMP/label3.tsv" > "$TMP/log" 2>&1 \
  || fail "FASTag -threads 1"
"$BIN" "${COMMON[@]}" -threads 3 -out "$TMP/l4.tsv" -fixed_modifications -label_out "$TMP/label4.tsv" > "$TMP/log" 2>&1 \
  || fail "FASTag -threads 3"
same "$TMP/label3.tsv" "$TMP/label4.tsv" "-label_out differs between 1 and 3 threads"
same "$TMP/label0.tsv" "$TMP/label3.tsv" "-label_out differs between 2 and 1 threads"

# ---- -search_shifts (1.12 #17): -delta_out/-massgap_out unchanged, the decisions in the config
# masked: the run version row aside (the baseline binary may carry another version)
nover() { tr -d '\r' < "$1" | awk -F'\t' '!($1 == "run" && $2 == "version")'; }
# The ion-trap fixture places too few spectra for a gap peak: shifts_insilico.mgf
# (make_shift_fixture.py) carries Oxidation, Acetyl, a 13C spacing, an
# unexplained and a negative unexplained N-terminal shift on Ecoli_MS2_small.fasta.
SC=(-in "$FIX/shifts_insilico.mgf" -extension 3)
SH=(-search_engine comet -search_config_out "$TMP/sh.params")
G2=(-massgap_min_spectra 2)
run "${SC[@]}" -out "$TMP/s0.tsv" "${R[@]}" -delta_out "$TMP/sdelta0.tsv" -massgap_out "$TMP/sgap0.tsv" "${G2[@]}"
cp "$TMP/recon.tsv" "$TMP/srecon0.tsv"
run "${SC[@]}" -out "$TMP/s1.tsv" "${R[@]}" -delta_out "$TMP/sdelta1.tsv" -massgap_out "$TMP/sgap1.tsv" "${G2[@]}" \
  -search_shifts both "${SH[@]}" -search_shifts_out "$TMP/shifts.tsv"
same "$TMP/s0.tsv" "$TMP/s1.tsv" "-search_shifts changed the tag TSV"
same "$TMP/srecon0.tsv" "$TMP/recon.tsv" "-search_shifts changed -recon_out"
same "$TMP/sdelta0.tsv" "$TMP/sdelta1.tsv" "-search_shifts changed -delta_out"
same "$TMP/sgap0.tsv" "$TMP/sgap1.tsv" "-search_shifts changed -massgap_out"
# at the -massgap_* defaults too, against the runs above without it
run "${SC[@]}" -out "$TMP/s2a.tsv" "${R[@]}" -delta_out "$TMP/sdelta2a.tsv" -massgap_out "$TMP/sgap2a.tsv"
run "${SC[@]}" -out "$TMP/s2.tsv" "${R[@]}" -delta_out "$TMP/sdelta2.tsv" -massgap_out "$TMP/sgap2.tsv" \
  -search_shifts both -search_engine comet -search_config_out "$TMP/sh2.params"
same "$TMP/sdelta2a.tsv" "$TMP/sdelta2.tsv" "-search_shifts changed -delta_out at the -massgap defaults"
same "$TMP/sgap2a.tsv" "$TMP/sgap2.tsv" "-search_shifts changed -massgap_out at the -massgap defaults"
# -search_shifts none equals the option absent
run "${SC[@]}" -out "$TMP/s3.tsv" "${R[@]}" -delta_out "$TMP/sdelta3.tsv" -massgap_out "$TMP/sgap3.tsv" "${G2[@]}" -search_shifts none
same "$TMP/sdelta0.tsv" "$TMP/sdelta3.tsv" "-search_shifts none changed -delta_out"
same "$TMP/sgap0.tsv" "$TMP/sgap3.tsv" "-search_shifts none changed -massgap_out"
if [ -n "${FASTAG_BASELINE_BIN:-}" ]; then
  mkdir -p "$TMP/bl"
  "$FASTAG_BASELINE_BIN" -threads 2 "${SC[@]}" -out "$TMP/bl/s.tsv" -recon_fasta "$DB" -recon_out "$TMP/bl/recon.tsv" \
    -fixed_modifications -delta_out "$TMP/bl/delta.tsv" -massgap_out "$TMP/bl/gap.tsv" "${G2[@]}" > "$TMP/log" 2>&1 \
    || { cat "$TMP/log" >&2; fail "baseline binary"; }
  same "$TMP/bl/delta.tsv" "$TMP/sdelta1.tsv" "-delta_out with -search_shifts differs from the baseline binary"
  nover "$TMP/bl/gap.tsv" > "$TMP/bl/gap.nv"; nover "$TMP/sgap1.tsv" > "$TMP/sgap1.nv"
  same "$TMP/bl/gap.nv" "$TMP/sgap1.nv" "-massgap_out with -search_shifts differs from the baseline binary"
  same "$TMP/bl/s.tsv" "$TMP/s1.tsv" "the tag TSV with -search_shifts differs from the baseline binary"
elif [ "${FASTAG_BASELINE_REQUIRED:-0}" = 1 ]; then
  fail "FASTAG_BASELINE_REQUIRED=1 but FASTAG_BASELINE_BIN is not set"
else
  echo "NOTE: FASTAG_BASELINE_BIN not set; -search_shifts baseline compare skipped" >&2
fi
# one row per gap peak, every exported row in the config, no dropped/skipped one
npeaks=$(tr -d '\r' < "$TMP/sgap1.tsv" | awk -F'\t' '$1 == "peak" && $2 ~ /\.delta$/' | wc -l | tr -d ' ')
tr -d '\r' < "$TMP/shifts.tsv" | grep -v '^#' > "$TMP/shifts.rows"
head -1 "$TMP/shifts.rows" | grep -qx $'peak\tdelta\tspectra\texplanation\taction\tmod_id\tsites\texported\tsubstitution_share\tlocalized\treason' \
  || fail "-search_shifts_out header"
[ "$(($(wc -l < "$TMP/shifts.rows") - 1))" = "$npeaks" ] || fail "-search_shifts_out has not one row per -massgap_out peak ($npeaks)"
[ "$npeaks" -gt 0 ] || fail "the fixture gives no gap peak at -massgap_min_spectra 2"
nexp=$(awk -F'\t' 'NR > 1 && ($5 == "variable" || $5 == "offset" || $5 == "fixed")' "$TMP/shifts.rows" | wc -l | tr -d ' ')
[ "$nexp" -gt 0 ] || fail "no exported shift on the fixture (the checks below would be vacuous)"
nvar=$(awk -F'\t' 'NR > 1 && $5 == "variable"' "$TMP/shifts.rows" | wc -l | tr -d ' ')
[ "$nvar" -le 3 ] || fail "$nvar variable shifts exceed -shift_max_variable 3"
# the fixture's shifts, each with its rule
act() { awk -F'\t' -v d="$1" 'NR > 1 && $2 == d { print $5 }' "$TMP/shifts.rows"; }
[ "$(act 15.9950)" = variable ] || fail "Oxidation is not a variable modification: $(act 15.9950)"
[ "$(act 42.0105)" = variable ] || fail "Acetyl is not a variable modification: $(act 42.0105)"
[ "$(act 1.0035)" = skipped_isotope ] || fail "the 13C spacing is not skipped_isotope: $(act 1.0035)"
[ "$(act 123.4565)" = offset ] || fail "the unexplained shift is not an offset: $(act 123.4565)"
[ "$(act -77.7775)" = dropped_engine ] || fail "the negative offset is not dropped_engine: $(act -77.7775)"
tr -d '\r' < "$TMP/sh.params" | grep -qx 'isotope_error = 1' || fail "the 13C peak did not set isotope_error 1"
tr -d '\r' < "$TMP/sh.params" | grep -qx 'mass_offsets = 0.0 123.4565' || fail "mass_offsets is not 0.0 123.4565"
# the in-silico fixture has no precursor bias: the 13C peak is no calibration
# peak and the binning's error (within the centroid resolution) is not applied
tr -d '\r' < "$TMP/shifts.tsv" | grep -q '^# calibration: offsets uncorrected, .* over 2 single-modification peaks' \
  || { grep '^# calibration' "$TMP/shifts.tsv" >&2; fail "the calibration header: not uncorrected over the 2 non-isotope peaks"; }
# Sage: no offsets, the variable ones written
run "${SC[@]}" -out "$TMP/sg.tsv" "${R[@]}" "${G2[@]}" -search_shifts variable -search_config_out "$TMP/sg.json" \
  -search_shifts_out "$TMP/sg.shifts.tsv"
tr -d '\r' < "$TMP/sg.json" | grep -q '15\.99491' || fail "Sage config without the Oxidation shift"
[ "$(awk -F'\t' '!/^#/ && $5 == "offset"' "$TMP/sg.shifts.tsv" | wc -l | tr -d ' ')" = 0 ] || fail "Sage got an offset"
# the config's masses, 4 decimals: variable_modNN, mass_offsets and add_* values
tr -d '\r' < "$TMP/sh.params" | awk '
  /^variable_mod[0-9][0-9] = / && $3 + 0 != 0 { printf "v %.4f\n", $3 }
  /^mass_offsets = / { for (i = 3; i <= NF; i++) printf "o %.4f\n", $i }
  /^add_/ && $3 + 0 != 0 { printf "f %.4f\n", $3 }' | sort -u > "$TMP/cfg.masses"
awk -F'\t' 'NR > 1 { k = ($5 == "variable" ? "v" : $5 == "offset" ? "o" : $5 == "fixed" ? "f" : "")
  if (k != "") print k " " $8 }' "$TMP/shifts.rows" | sort -u > "$TMP/exp.masses"
[ -z "$(comm -23 "$TMP/exp.masses" "$TMP/cfg.masses")" ] || { comm -23 "$TMP/exp.masses" "$TMP/cfg.masses" >&2; fail "an exported shift is not in the config"; }
awk -F'\t' 'NR > 1 && ($5 ~ /^dropped_/ || $5 ~ /^skipped_/ || $5 == "expected_label" || $5 ~ /_questionable$/ || $5 == "label_incomplete") && $8 != "-" {
  print "v " $8; print "o " $8 }' "$TMP/shifts.rows" | sort -u > "$TMP/drop.masses"
[ -z "$(comm -12 "$TMP/drop.masses" "$TMP/cfg.masses" | comm -23 - "$TMP/exp.masses")" ] \
  || fail "a dropped or skipped shift is in the config"
if awk -F'\t' 'NR > 1 && $5 == "offset"' "$TMP/shifts.rows" | grep -q .; then
  tr -d '\r' < "$TMP/sh.params" | grep -q '^mass_offsets = 0.0 ' || fail "offsets without 0 first"
fi
# the same at 1, 3 and 8 threads
for t in 1 3 8; do
  "$BIN" -threads $t "${SC[@]}" -out "$TMP/st$t.tsv" "${R[@]}" -massgap_min_spectra 2 -search_shifts both \
    -search_engine comet -search_config_out "$TMP/sht$t.params" -search_shifts_out "$TMP/shiftst$t.tsv" > "$TMP/log" 2>&1 \
    || { cat "$TMP/log" >&2; fail "-search_shifts at $t threads"; }
done
same "$TMP/shiftst1.tsv" "$TMP/shiftst3.tsv" "-search_shifts_out differs between 1 and 3 threads"
same "$TMP/sht1.params" "$TMP/sht3.params" "the shift config differs between 1 and 3 threads"
same "$TMP/shiftst1.tsv" "$TMP/shiftst8.tsv" "-search_shifts_out differs between 1 and 8 threads"
same "$TMP/sht1.params" "$TMP/sht8.params" "the shift config differs between 1 and 8 threads"
same "$TMP/shifts.tsv" "$TMP/shiftst1.tsv" "-search_shifts_out differs between 2 and 1 threads"
# report-free: no -recon_out, -delta_out, -massgap_out or -digest_out, with and without -recon_localize
for loc in "" -recon_localize; do
  rf="$TMP/rf$loc"; mkdir -p "$rf"
  run "${SC[@]}" -out "$rf/t.tsv" -recon_fasta "$DB" -fixed_modifications -massgap_min_spectra 2 $loc \
    -search_shifts both -search_engine comet -search_config_out "$rf/c.params"
  [ -s "$rf/c.params" ] || fail "report-free -search_shifts$loc: no config"
  [ "$(ls "$rf" | tr '\n' ' ')" = "c.params t.tsv " ] || fail "report-free -search_shifts$loc wrote $(ls "$rf" | tr '\n' ' ')"
  same "$TMP/sht1.params" "$rf/c.params" "report-free -search_shifts$loc: the config differs from the run with reports"
done
# site expansion with -recon_localize runs
run "${SC[@]}" -out "$TMP/se.tsv" "${R[@]}" -recon_localize -massgap_min_spectra 2 -search_shifts both \
  -search_engine comet -search_config_out "$TMP/se.params" -shift_expand_sites -search_shifts_out "$TMP/se.shifts.tsv"
[ -s "$TMP/se.params" ] || fail "-shift_expand_sites: no config"
# refusals
nope() { local want="$1"; shift; "$BIN" "${SC[@]}" -out "$TMP/n.tsv" "$@" > "$TMP/log" 2>&1; local rc=$?
  [ "$rc" = "$want" ] || { cat "$TMP/log" >&2; fail "exit $rc (want $want): $*"; }; }
nope 6 "${R[@]}" -search_shifts both
grep -q -- "-search_shifts writes into the engine configuration" "$TMP/log" || fail "no -search_config_out: message"
nope 6 "${R[@]}" -search_shifts offsets -search_config_out "$TMP/n.json"
grep -q -- "Sage has no mass offsets" "$TMP/log" || fail "offsets with sage: message"
nope 6 -search_shifts both -search_engine comet -search_config_out "$TMP/n.params"
grep -q -- "needs a database" "$TMP/log" || fail "no database: message"
nope 6 "${R[@]}" -search_shifts both "${SH[@]}" -shift_expand_sites
grep -q -- "-shift_expand_sites needs -recon_localize" "$TMP/log" || fail "expand without localize: message"
printf '' | "$BIN" -stream -search_shifts both > "$TMP/log" 2>&1 && fail "-stream with -search_shifts was accepted"
grep -q -- "-stream cannot be combined with -search_shifts" "$TMP/log" || fail "-stream: message"
mkdir -p "$TMP/baddig"; cp "$DATA"/* "$TMP/baddig/"
printf 'Bogus\tBogusmod (X)\t1.0\n' >> "$TMP/baddig/massgap_mods.tsv"
FASTAG_DIGEST_DIR="$TMP/baddig" nope 3 "${R[@]}" -search_shifts both "${SH[@]}"
grep -q -- "-search_shifts: OpenMS does not know the modification 'Bogusmod (X)'" "$TMP/log" || fail "unknown mod id: message"
"$BIN" "${SC[@]}" -out "$TMP/w.tsv" -search_shifts_out "$TMP/w.shifts.tsv" -shift_max_variable 5 > "$TMP/log" 2>&1 \
  || fail "-search_shifts_out without -search_shifts was refused"
grep -q -- "-search_shifts_out is only read for -search_shifts" "$TMP/log" || fail "no warning for -search_shifts_out"
grep -q -- "-shift_max_variable is only read for -search_shifts" "$TMP/log" || fail "no warning for -shift_max_variable"
[ ! -e "$TMP/w.shifts.tsv" ] || fail "-search_shifts_out written without -search_shifts"

# ---- refusals
"$BIN" "${COMMON[@]}" -out "$TMP/x.tsv" -massgap_out "$TMP/x2.tsv" > "$TMP/log" 2>&1 \
  && fail "-massgap_out without -recon_out was accepted"
printf '' | "$BIN" -stream -digest_out "$TMP/x3.tsv" > "$TMP/log" 2>&1 && fail "-stream with -digest_out was accepted"
# Beside the build-tree binary there is no share/FASTag/digest either.
FASTAG_DIGEST_DIR="$TMP/none" "$BIN" "${COMMON[@]}" -out "$TMP/x.tsv" -digest_out "$TMP/x4.tsv" > "$TMP/log" 2>&1 \
  && fail "no shipped models and no -digest_models, but no error"

# ---- digest options without their report: warned about, not refused
"$BIN" "${COMMON[@]}" -out "$TMP/w.tsv" -digest_tag_min 50 -digest_window 0.01 > "$TMP/log" 2>&1 \
  || fail "-digest_tag_min without -digest_out was refused"
grep -q -- "-digest_tag_min is only read for -digest_out" "$TMP/log" || fail "no warning for -digest_tag_min"
grep -q -- "-digest_window is only read for -digest_out or -label_out" "$TMP/log" || fail "no warning for -digest_window"
"$BIN" "${COMMON[@]}" -out "$TMP/w.tsv" -label_out "$TMP/w2.tsv" -digest_window 0.01 > "$TMP/log" 2>&1
grep -q -- "-digest_window is only read" "$TMP/log" && fail "-digest_window warned although -label_out reads it"
"$BIN" "${COMMON[@]}" -out "$TMP/w.tsv" -digest_silac_min 10 -glyco_out "$TMP/w3.tsv" > "$TMP/log" 2>&1 \
  || fail "-digest_silac_min without -label_out was refused"
grep -q -- "-digest_silac_min is only read for -label_out" "$TMP/log" || fail "no warning for -digest_silac_min"
grep -q -- "-glyco_out is only read for -glyco" "$TMP/log" || fail "no warning for -glyco_out"

# ---- 1.12 D: chemistry v2 (#3c-#3f), all opt-in
# default -digest_out equals the 1.11.0 binary's on the same run
# (test/fixtures/digest_1.11.0_Ecoli_MS2_small_Da.tsv), the run version row aside
legacy "$TMP/digest.tsv" > "$TMP/digest.old"
legacy "$FIX/digest_1.11.0_Ecoli_MS2_small_Da.tsv" > "$TMP/digest.want"
same "$TMP/digest.want" "$TMP/digest.old" "-digest_out at the defaults is not the 1.11.0 report"
# every new option at its default equals the option absent
run "${COMMON[@]}" -out "$TMP/v0.tsv" -digest_out "$TMP/vdigest0.tsv" -label_out "$TMP/vlabel0.tsv" \
  -digest_models_version shipped -digest_detection none -digest_flank2 off -digest_min_confidence 0 \
  -alkylation_proteome auto -alkylation_min_spectra 10 -alkylation_min_share 0.6 -alkylation_window 0
same "$TMP/digest.tsv" "$TMP/vdigest0.tsv" "-digest_out changed with the 1.12 D options at their defaults"
same "$TMP/label.tsv" "$TMP/vlabel0.tsv" "-label_out changed with the 1.12 D options at their defaults"
same "$TMP/base.tsv" "$TMP/v0.tsv" "the tag TSV changed with the 1.12 D options at their defaults"
# A wide ppm tolerance gives filtered tags; the fixture's first MS2 peak is
# above y1 (ms2_first_peak), so the 1.11 call is withheld there.
PPM=(-in "$IN" -tag_length 4 -digest_tag_min 5 -fragment_tolerance 300 -fragment_tolerance_unit ppm)
run "${PPM[@]}" -out "$TMP/v1.tsv" -digest_out "$TMP/vdigest1.tsv"
[ "$(val "$TMP/vdigest1.tsv" call status) $(val "$TMP/vdigest1.tsv" call reason)" = "no_call ms2_first_peak" ] \
  || fail "the ppm fixture run is not no_call ms2_first_peak at the defaults"
[ "$(val "$TMP/vdigest1.tsv" count tags_filtered)" -ge 100 ] || fail "the ppm fixture run has fewer than 100 filtered tags"
# v2 alone: the v2 rows; its pooled specificity at the v1 share scores every v1
# model as 1.11 does (same log-likelihoods), and the same rule withholds the call
run "${PPM[@]}" -out "$TMP/v2.tsv" -digest_out "$TMP/vdigest2.tsv" -digest_models_version v2
same "$TMP/v1.tsv" "$TMP/v2.tsv" "-digest_models_version v2 changed the tag TSV"
tr -d '\r' < "$TMP/vdigest2.tsv" | awk -F'\t' 'NF != 5 || $5 == "" { bad = 1 } END { exit bad }' || fail "v2 digest: a malformed row"
[ "$(val "$TMP/vdigest2.tsv" run models) $(val "$TMP/vdigest2.tsv" run models_version)" = "shipped_v2 v2" ] \
  || fail "v2: run.models/models_version"
[ "$(val "$TMP/vdigest2.tsv" run specificity) $(val "$TMP/vdigest2.tsv" run detection) $(val "$TMP/vdigest2.tsv" run flank2)" = "0.05,0.05 none off" ] \
  || fail "v2: run.specificity/detection/flank2"
for m in Trypsin Lys-C Arg-C Lys-N Asp-N Glu-C Chymotrypsin unspecific; do
  [ "$(val "$TMP/vdigest1.tsv" model "$m.loglik")" = "$(val "$TMP/vdigest2.tsv" model "$m.loglik")" ] \
    || fail "v2 scores $m otherwise than the v1 table at the same share"
done
[ -n "$(val "$TMP/vdigest2.tsv" model LysargiNase.loglik)" ] && [ -n "$(val "$TMP/vdigest2.tsv" model Asp-N_ambic.loglik)" ] \
  || fail "v2: no LysargiNase or Asp-N_ambic model"
[ "$(val "$TMP/vdigest2.tsv" call status) $(val "$TMP/vdigest2.tsv" call reason)" = "no_call ms2_first_peak" ] \
  || fail "v2 without flank2 is not withheld by ms2_first_peak"
[ "$(val "$TMP/vdigest2.tsv" call flank2_used) $(val "$TMP/vdigest2.tsv" call timstof_call) $(val "$TMP/vdigest2.tsv" meta instrument_class)" = "no no other" ] \
  || fail "v2: flank2_used/timstof_call/instrument_class (the LTQ Orbitrap XL fixture has ion-trap CID MS2: other)"
# p_correct needs a call; the shipped calibration is unfitted (all coefficients 0)
[ "$(val "$TMP/vdigest2.tsv" run calibration) $(val "$TMP/vdigest2.tsv" nocall low_confidence)" = "shipped no" ] \
  || fail "v2: the shipped calibration is not loaded"
[ -z "$(val "$TMP/vdigest2.tsv" call p_correct)" ] || fail "v2: p_correct written without a call"
# flank2 with detection: the two-residue sums are scored where y1 is cut off;
# on the shipped table the N-end models (background C end) tie there
run "${PPM[@]}" -out "$TMP/v4.tsv" -digest_out "$TMP/vdigest4.tsv" -digest_models_version v2 \
  -digest_detection shipped -digest_flank2 auto
[ "$(val "$TMP/vdigest4.tsv" call flank2_used) $(val "$TMP/vdigest4.tsv" run detection) $(val "$TMP/vdigest4.tsv" run flank2)" = "yes shipped auto" ] \
  || fail "flank2 auto is not used on the first-peak run"
[ "$(val "$TMP/vdigest4.tsv" count flank2_n)" -ge 5 ] || fail "flank2: fewer than 5 two-residue sums"
[ -n "$(val "$TMP/vdigest4.tsv" model Trypsin.flank2_loglik)" ] || fail "flank2: no flank2_loglik rows"
for th in 1 8; do
  "$BIN" "${PPM[@]}" -threads $th -out "$TMP/v4t.tsv" -digest_out "$TMP/vdigest4t$th.tsv" -digest_models_version v2 \
    -digest_detection shipped -digest_flank2 auto > "$TMP/log" 2>&1 || fail "FASTag -threads $th v2"
  same "$TMP/vdigest4.tsv" "$TMP/vdigest4t$th.tsv" "the v2 digest report differs at $th threads"
done
# a v2 table of the C-end proteases only: flank2 calls the run, with p_correct
awk -F'\t' '/^#/ || $1 == "model" || $1 == "background" || $1 == "Trypsin" || $1 == "Lys-C" || $1 == "Arg-C" ||
  $1 == "detection" || $1 == "specificity"' "$DATA/digest_models_v2.tsv" > "$TMP/cend.tsv"
run "${PPM[@]}" -out "$TMP/v5.tsv" -digest_out "$TMP/vdigest5.tsv" -digest_models "$TMP/cend.tsv" \
  -digest_detection shipped -digest_flank2 auto -digest_calibration "$DATA/digest_calibration.tsv"
[ "$(val "$TMP/vdigest5.tsv" call status) $(val "$TMP/vdigest5.tsv" call flank2_used)" = "call yes" ] \
  || fail "flank2 on the C-end table is not a call: $(val "$TMP/vdigest5.tsv" call reason)"
[ "$(val "$TMP/vdigest5.tsv" call p_correct) $(val "$TMP/vdigest5.tsv" run calibration)" = "0.5 $DATA/digest_calibration.tsv" ] \
  || fail "the unfitted calibration does not give p_correct 0.5"
run "${PPM[@]}" -out "$TMP/v3.tsv" -digest_out "$TMP/vdigest3.tsv" -digest_models "$TMP/cend.tsv" \
  -digest_detection shipped -digest_flank2 auto -digest_min_confidence 0.9
[ "$(val "$TMP/vdigest3.tsv" call status) $(val "$TMP/vdigest3.tsv" call reason) $(val "$TMP/vdigest3.tsv" call p_correct)" = "no_call low_confidence 0.5" ] \
  || fail "-digest_min_confidence 0.9 with p_correct 0.5 is not no_call low_confidence"
[ "$(val "$TMP/vdigest3.tsv" nocall low_confidence)" = yes ] || fail "nocall.low_confidence is not yes"
# refusals: detection without detection rows (v1 table; a v2 table missing a class), a bad calibration
"$BIN" "${PPM[@]}" -out "$TMP/x.tsv" -digest_out "$TMP/x5.tsv" -digest_detection shipped > "$TMP/log" 2>&1 \
  && fail "-digest_detection shipped with the v1 table was accepted"
grep -q "needs detection rows" "$TMP/log" || fail "no message for detection without rows"
grep -v $'^detection\ttimstof' "$DATA/digest_models_v2.tsv" > "$TMP/notims.tsv"
"$BIN" "${PPM[@]}" -out "$TMP/x.tsv" -digest_out "$TMP/x6.tsv" -digest_models "$TMP/notims.tsv" -digest_detection shipped \
  > "$TMP/log" 2>&1 && fail "a v2 table without the timstof detection class was accepted"
grep -q "none for timstof" "$TMP/log" || fail "no message for the missing timstof class"
printf 'feature\tcoef\nintercept\t1\n' > "$TMP/badcal.tsv"
"$BIN" "${PPM[@]}" -out "$TMP/x.tsv" -digest_out "$TMP/x7.tsv" -digest_calibration "$TMP/badcal.tsv" > "$TMP/log" 2>&1 \
  && fail "a malformed -digest_calibration was accepted"
"$BIN" "${COMMON[@]}" -out "$TMP/w.tsv" -digest_flank2 auto -digest_detection shipped > "$TMP/log" 2>&1 \
  || fail "-digest_flank2 without -digest_out was refused"
grep -q -- "-digest_flank2 is only read for -digest_out" "$TMP/log" || fail "no warning for -digest_flank2"
# the protease call never reads the run's species (#3c: the detection weights
# are fitted against one fixed reference): -digest_out is the same with and
# without -species on a toy index of the fixture proteome
if [ -n "$BUILDTAXDB" ] && [ -n "$TAXDIR" ]; then
  mkdir -p "$TMP/prot"
  cp "$DB" "$TMP/prot/562.fasta"
  "$BUILDTAXDB" "$TMP/prot" "$TMP/toy.taxdb" 4 > "$TMP/btx.log" 2>&1 || { cat "$TMP/btx.log" >&2; fail "buildtaxdb"; }
  V2=(-digest_models_version v2 -digest_detection shipped -digest_flank2 auto)
  run "${PPM[@]}" -out "$TMP/s0.tsv" -digest_out "$TMP/sdigest0.tsv" "${V2[@]}"
  run "${PPM[@]}" -out "$TMP/s1.tsv" -digest_out "$TMP/sdigest1.tsv" "${V2[@]}" -species -taxdb "$TMP/toy.taxdb" \
    -taxonomy_nodes "$TAXDIR/nodes.dmp" -taxonomy_names "$TAXDIR/names.dmp" -species_out "$TMP/s1.species.tsv"
  [ -s "$TMP/s1.species.tsv" ] || fail "-species wrote no species report"
  same "$TMP/sdigest0.tsv" "$TMP/sdigest1.tsv" "-digest_out (v2, detection, flank2) changed with -species"
fi

# ---- 1.12 D: -alkylation_out (#3g)
alk_check() {  # FILE: sections, five fields, the call rows
  tr -d '\r' < "$1" | awk -F'\t' 'NF != 5 || $5 == "" { bad = 1 } END { exit bad }' || fail "$1: a malformed row"
  for sct in run alk_run alk_cys alkylation_call; do
    tr -d '\r' < "$1" | cut -f1 | grep -qx "$sct" || fail "$1: no $sct section"
  done
  tr -d '\r' < "$1" | cut -f1 | grep -qx -e cys -e call && fail "$1: a cys or call section (the mass-gap or digest names)"
  [ "$(tr -d '\r' < "$1" | awk -F'\t' '$1 == "alkylation_call" { k = k (k == "" ? "" : ",") $2 } END { print k }')" \
    = "status,reagent,mass,share,reason" ] || fail "$1: alkylation_call rows"
  [ "$(val "$1" alk_run format)" = 1 ] || fail "$1: alk_run format"
}
counts_of() { tr -d '\r' < "$1" | awk -F'\t' '$1 == "alk_cys" || $1 == "alkylation_call" || ($1 == "alk_run" && ($2 == "tags" || $2 == "spectra"))'; }
run "${COMMON[@]}" -out "$TMP/a0.tsv" -alkylation_out "$TMP/alk0.tsv" -alkylation_proteome "$DB"
same "$TMP/base.tsv" "$TMP/a0.tsv" "-alkylation_out changed the tag TSV"
alk_check "$TMP/alk0.tsv"
[ "$(val "$TMP/alk0.tsv" alk_run database_source)" = proteome ] || fail "alk0: database_source"
[ "$(val "$TMP/alk0.tsv" alk_run window)" = 0.5 ] || fail "alk0: a Da run's window is not 0.5"
# the run rows are the versioned RunMeta rows (their own format number, src/RunMeta.h)
case "$(val "$TMP/alk0.tsv" run run_report_version)" in ''|*[!0-9]*) fail "alk0: no versioned run rows";; esac
[ "$(val "$TMP/alk0.tsv" alk_run tags)" -gt 0 ] || fail "alk0: no tag looked at"
# every placement of the looked-at tags is evaluated (the fixture proteome's
# placed peptides have no C: all of them are excluded.no_cys, n = all placements)
[ "$(tr -d '\r' < "$TMP/alk0.tsv" | awk -F'\t' '$1 == "alk_cys" && $2 == "excluded.no_cys" { print $4 }')" -gt 0 ] \
  || fail "alk0: no placement evaluated"
# -recon_out is byte-identical with and without -alkylation_out; the counts are those on the same database
run "${COMMON[@]}" -out "$TMP/a1.tsv" -recon_fasta "$DB" -recon_out "$TMP/ar1.tsv"
run "${COMMON[@]}" -out "$TMP/a2.tsv" -recon_fasta "$DB" -recon_out "$TMP/ar2.tsv" -alkylation_out "$TMP/alk2.tsv"
same "$TMP/ar1.tsv" "$TMP/ar2.tsv" "-alkylation_out changed -recon_out"
same "$TMP/a1.tsv" "$TMP/a2.tsv" "-alkylation_out changed the tag TSV (with -recon_out)"
alk_check "$TMP/alk2.tsv"
[ "$(val "$TMP/alk2.tsv" alk_run database_source)" = recon_fasta ] || fail "alk2: database_source"
counts_of "$TMP/alk0.tsv" > "$TMP/alk0.counts"; counts_of "$TMP/alk2.tsv" > "$TMP/alk2.counts"
same "$TMP/alk0.counts" "$TMP/alk2.counts" "-alkylation_out counts differ with and without -recon_out on one database"
# threads 1 and 3
"$BIN" "${COMMON[@]}" -threads 1 -out "$TMP/a3.tsv" -alkylation_out "$TMP/alk3.tsv" -alkylation_proteome "$DB" > "$TMP/log" 2>&1 \
  || fail "FASTag -threads 1 -alkylation_out"
"$BIN" "${COMMON[@]}" -threads 3 -out "$TMP/a4.tsv" -alkylation_out "$TMP/alk4.tsv" -alkylation_proteome "$DB" > "$TMP/log" 2>&1 \
  || fail "FASTag -threads 3 -alkylation_out"
same "$TMP/alk3.tsv" "$TMP/alk4.tsv" "-alkylation_out differs between 1 and 3 threads"
"$BIN" "${COMMON[@]}" -threads 8 -out "$TMP/a8.tsv" -alkylation_out "$TMP/alk8.tsv" -alkylation_proteome "$DB" > "$TMP/log" 2>&1 \
  || fail "FASTag -threads 8 -alkylation_out"
same "$TMP/alk3.tsv" "$TMP/alk8.tsv" "-alkylation_out differs between 1 and 8 threads"
same "$TMP/alk0.tsv" "$TMP/alk3.tsv" "-alkylation_out differs between 2 and 1 threads"
# a ppm run: window 0.02; no fixed C modification: fixed_c_delta 0
run -in "$IN" -tag_length 4 -out "$TMP/a5.tsv" -alkylation_out "$TMP/alk5.tsv" -alkylation_proteome "$DB" -fixed_modifications
alk_check "$TMP/alk5.tsv"
[ "$(val "$TMP/alk5.tsv" alk_run window) $(val "$TMP/alk5.tsv" alk_run fixed_c_delta)" = "0.02 0" ] || fail "alk5: window/fixed_c_delta"
[ "$(val "$TMP/alk0.tsv" alk_run fixed_nterm_delta) $(val "$TMP/alk0.tsv" alk_run fixed_cterm_delta) $(val "$TMP/alk0.tsv" alk_cys excluded.non_by)" = "0 0 0" ] \
  || fail "alk0: an unlabelled run has no terminal label and no excluded c/z tag"
# a fixed N-terminal label (TMT) reaches the alkylation settings, and -recon_out stays byte-identical with -alkylation_out
TMTRUN=("${COMMON[@]}" -fixed_modifications 'Carbamidomethyl (C)' 'TMT6plex (K)' 'TMT6plex (N-term)' -recon_fasta "$DB")
run "${TMTRUN[@]}" -out "$TMP/t1.tsv" -recon_out "$TMP/tr1.tsv"
run "${TMTRUN[@]}" -out "$TMP/t2.tsv" -recon_out "$TMP/tr2.tsv" -alkylation_out "$TMP/talk.tsv"
same "$TMP/tr1.tsv" "$TMP/tr2.tsv" "-alkylation_out changed -recon_out on a labelled run"
alk_check "$TMP/talk.tsv"
case "$(val "$TMP/talk.tsv" alk_run fixed_nterm_delta)" in 229.16*) ;; *) fail "talk: fixed_nterm_delta is not the TMT6plex mass";; esac
[ "$(val "$TMP/talk.tsv" alk_run fixed_cterm_delta)" = 0 ] || fail "talk: fixed_cterm_delta"
# the shipped proteomes beside the digest data (a gzip-compressed FASTA), found through FASTAG_DIGEST_DIR
if command -v gzip > /dev/null 2>&1; then
  mkdir -p "$TMP/share/digest" "$TMP/share/alkylation"
  cp "$DATA"/*.tsv "$TMP/share/digest/"
  gzip -c "$DB" > "$TMP/share/alkylation/ecoli.fasta.gz"
  FASTAG_DIGEST_DIR="$TMP/share/digest" run "${COMMON[@]}" -out "$TMP/a6.tsv" -alkylation_out "$TMP/alk6.tsv" \
    -alkylation_proteome ecoli
  [ "$(val "$TMP/alk6.tsv" alk_run database_source)" = bundled:ecoli ] || fail "alk6: database_source"
  counts_of "$TMP/alk6.tsv" > "$TMP/alk6.counts"
  same "$TMP/alk0.counts" "$TMP/alk6.counts" "the gzip-compressed shipped proteome gives other counts than the plain FASTA"
  FASTAG_DIGEST_DIR="$TMP/share/digest" "$BIN" "${COMMON[@]}" -out "$TMP/x.tsv" -alkylation_out "$TMP/x8.tsv" \
    > "$TMP/log" 2>&1 && fail "-alkylation_proteome auto without a shipped human proteome was accepted"
  grep -q "no shipped human proteome" "$TMP/log" || fail "no message for the missing human proteome"
else
  echo "note: gzip not found; the shipped-proteome check is skipped" >&2
fi
# refusals and warnings
"$BIN" "${COMMON[@]}" -out "$TMP/x.tsv" -alkylation_out "$TMP/x.tsv" -alkylation_proteome "$DB" > "$TMP/log" 2>&1 \
  && fail "-alkylation_out equal to -out was accepted"
# placing for -alkylation_out alone does not stand in for -recon_out (1.11 refusals kept)
for extra in "-delta_out $TMP/x11.tsv" "-massgap_out $TMP/x12.tsv" "-recon_localize"; do
  # shellcheck disable=SC2086
  "$BIN" "${COMMON[@]}" -out "$TMP/x.tsv" -alkylation_out "$TMP/x13.tsv" -alkylation_proteome "$DB" $extra \
    > "$TMP/log" 2>&1 && fail "$extra with -alkylation_out but without -recon_out was accepted"
  grep -q "requires -recon_out" "$TMP/log" || fail "no -recon_out message for $extra with -alkylation_out"
  [ ! -e "$TMP/x13.tsv" ] || fail "$extra: -alkylation_out written although the run was refused"
done
"$BIN" "${COMMON[@]}" -out "$TMP/x.tsv" -alkylation_out "$TMP/x9.tsv" -alkylation_proteome zebrafish > "$TMP/log" 2>&1 \
  && fail "an unknown -alkylation_proteome was accepted"
grep -q "is neither auto" "$TMP/log" || fail "no message for an unknown -alkylation_proteome"
printf '' | "$BIN" -stream -alkylation_out "$TMP/x10.tsv" > "$TMP/log" 2>&1 && fail "-stream with -alkylation_out was accepted"
grep -q -- "-stream cannot be combined with -alkylation_out" "$TMP/log" || fail "no -stream refusal message for -alkylation_out"
"$BIN" "${COMMON[@]}" -out "$TMP/w.tsv" -alkylation_min_spectra 5 > "$TMP/log" 2>&1 \
  || fail "-alkylation_min_spectra without -alkylation_out was refused"
grep -q -- "-alkylation_min_spectra is only read for -alkylation_out" "$TMP/log" || fail "no warning for -alkylation_min_spectra"
run "${COMMON[@]}" -out "$TMP/a7.tsv" -recon_fasta "$DB" -alkylation_out "$TMP/alk7.tsv" -alkylation_proteome human
grep -q -- "-alkylation_proteome is ignored" "$TMP/log" || fail "no warning for -alkylation_proteome with -recon_fasta"
[ ! -e "$TMP/alk7.tsv.part" ] || fail "a .part file is left behind"

echo "digest_cli_test: all checks passed"
