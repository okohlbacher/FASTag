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
SH=(-search_engine comet -search_config_out "$TMP/sh.params")
G2=(-massgap_min_spectra 2)
run "${COMMON[@]}" -out "$TMP/s0.tsv" "${R[@]}" -delta_out "$TMP/sdelta0.tsv" -massgap_out "$TMP/sgap0.tsv" "${G2[@]}"
cp "$TMP/recon.tsv" "$TMP/srecon0.tsv"
run "${COMMON[@]}" -out "$TMP/s1.tsv" "${R[@]}" -delta_out "$TMP/sdelta1.tsv" -massgap_out "$TMP/sgap1.tsv" "${G2[@]}" \
  -search_shifts both "${SH[@]}" -search_shifts_out "$TMP/shifts.tsv"
same "$TMP/s0.tsv" "$TMP/s1.tsv" "-search_shifts changed the tag TSV"
same "$TMP/srecon0.tsv" "$TMP/recon.tsv" "-search_shifts changed -recon_out"
same "$TMP/sdelta0.tsv" "$TMP/sdelta1.tsv" "-search_shifts changed -delta_out"
same "$TMP/sgap0.tsv" "$TMP/sgap1.tsv" "-search_shifts changed -massgap_out"
# at the -massgap_* defaults too, against the runs above without it
run "${COMMON[@]}" -out "$TMP/s2.tsv" "${R[@]}" -delta_out "$TMP/sdelta2.tsv" -massgap_out "$TMP/sgap2.tsv" \
  -search_shifts both "${SH[@]}"
same "$TMP/delta0.tsv" "$TMP/sdelta2.tsv" "-search_shifts changed -delta_out at the -massgap defaults"
same "$TMP/gap1.tsv" "$TMP/sgap2.tsv" "-search_shifts changed -massgap_out at the -massgap defaults"
# -search_shifts none equals the option absent
run "${COMMON[@]}" -out "$TMP/s3.tsv" "${R[@]}" -delta_out "$TMP/sdelta3.tsv" -massgap_out "$TMP/sgap3.tsv" "${G2[@]}" -search_shifts none
same "$TMP/sdelta0.tsv" "$TMP/sdelta3.tsv" "-search_shifts none changed -delta_out"
same "$TMP/sgap0.tsv" "$TMP/sgap3.tsv" "-search_shifts none changed -massgap_out"
if [ -n "${FASTAG_BASELINE_BIN:-}" ]; then
  mkdir -p "$TMP/bl"
  "$FASTAG_BASELINE_BIN" -threads 2 "${COMMON[@]}" -out "$TMP/bl/s.tsv" -recon_fasta "$DB" -recon_out "$TMP/bl/recon.tsv" \
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
  "$BIN" -threads $t "${COMMON[@]}" -out "$TMP/st$t.tsv" "${R[@]}" -massgap_min_spectra 2 -search_shifts both \
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
  run "${COMMON[@]}" -out "$rf/t.tsv" -recon_fasta "$DB" -fixed_modifications -massgap_min_spectra 2 $loc \
    -search_shifts both -search_engine comet -search_config_out "$rf/c.params"
  [ -s "$rf/c.params" ] || fail "report-free -search_shifts$loc: no config"
  [ "$(ls "$rf" | tr '\n' ' ')" = "c.params t.tsv " ] || fail "report-free -search_shifts$loc wrote $(ls "$rf" | tr '\n' ' ')"
  same "$TMP/sht1.params" "$rf/c.params" "report-free -search_shifts$loc: the config differs from the run with reports"
done
# site expansion with -recon_localize runs
run "${COMMON[@]}" -out "$TMP/se.tsv" "${R[@]}" -recon_localize -massgap_min_spectra 2 -search_shifts both \
  -search_engine comet -search_config_out "$TMP/se.params" -shift_expand_sites -search_shifts_out "$TMP/se.shifts.tsv"
[ -s "$TMP/se.params" ] || fail "-shift_expand_sites: no config"
# refusals
nope() { local want="$1"; shift; "$BIN" "${COMMON[@]}" -out "$TMP/n.tsv" "$@" > "$TMP/log" 2>&1; local rc=$?
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
"$BIN" "${COMMON[@]}" -out "$TMP/w.tsv" -search_shifts_out "$TMP/w.shifts.tsv" -shift_max_variable 5 > "$TMP/log" 2>&1 \
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

echo "digest_cli_test: all checks passed"
