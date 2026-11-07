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
# a ppm run with v2, detection, flank2 and the calibration: the v2 rows, p_correct with a call
PPM=(-in "$IN" -tag_length 4 -digest_tag_min 5)
run "${PPM[@]}" -out "$TMP/v1.tsv" -digest_out "$TMP/vdigest1.tsv"
run "${PPM[@]}" -out "$TMP/v2.tsv" -digest_out "$TMP/vdigest2.tsv" -digest_models_version v2 \
  -digest_detection shipped -digest_flank2 auto
same "$TMP/v1.tsv" "$TMP/v2.tsv" "-digest_models_version v2 changed the tag TSV"
tr -d '\r' < "$TMP/vdigest2.tsv" | awk -F'\t' 'NF != 5 || $5 == "" { bad = 1 } END { exit bad }' || fail "v2 digest: a malformed row"
[ "$(val "$TMP/vdigest2.tsv" run models) $(val "$TMP/vdigest2.tsv" run models_version)" = "shipped_v2 v2" ] \
  || fail "v2: run.models/models_version"
[ "$(val "$TMP/vdigest2.tsv" run detection) $(val "$TMP/vdigest2.tsv" run flank2) $(val "$TMP/vdigest2.tsv" run calibration)" = "shipped auto shipped" ] \
  || fail "v2: run.detection/flank2/calibration"
[ -n "$(val "$TMP/vdigest2.tsv" meta instrument_class)" ] && [ -n "$(val "$TMP/vdigest2.tsv" count flank2_n)" ] \
  && [ -n "$(val "$TMP/vdigest2.tsv" nocall low_confidence)" ] && [ -n "$(val "$TMP/vdigest2.tsv" call flank2_used)" ] \
  || fail "v2: instrument_class, flank2_n, low_confidence or flank2_used row missing"
[ "$(val "$TMP/vdigest2.tsv" call status)" = call ] || fail "v2 on the ppm fixture is not a call: $(val "$TMP/vdigest2.tsv" call reason)"
# the shipped calibration is unfitted (all coefficients 0): p_correct 0.5
[ "$(val "$TMP/vdigest2.tsv" call p_correct)" = 0.5 ] || fail "v2 does not write p_correct 0.5"
run "${PPM[@]}" -out "$TMP/v3.tsv" -digest_out "$TMP/vdigest3.tsv" -digest_min_confidence 0.9
[ "$(val "$TMP/vdigest3.tsv" call status) $(val "$TMP/vdigest3.tsv" call reason)" = "no_call low_confidence" ] \
  || fail "-digest_min_confidence 0.9 with p_correct 0.5 is not no_call low_confidence"
# the calls of the v1 rows are kept: v2 without detection, flank2 or calibration calls the same model here
[ "$(val "$TMP/vdigest1.tsv" call model)" = "$(val "$TMP/vdigest2.tsv" call model)" ] \
  || fail "v2 on the ppm fixture calls $(val "$TMP/vdigest2.tsv" call model), v1 $(val "$TMP/vdigest1.tsv" call model)"
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
[ "$(val "$TMP/alk0.tsv" run run_report_version)" = 3 ] || fail "alk0: run rows are not the versioned format 3"
[ "$(val "$TMP/alk0.tsv" alk_run tags)" -gt 0 ] || fail "alk0: no tag looked at"
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
same "$TMP/alk0.tsv" "$TMP/alk3.tsv" "-alkylation_out differs between 2 and 1 threads"
# a ppm run: window 0.02; no fixed C modification: fixed_c_delta 0
run -in "$IN" -tag_length 4 -out "$TMP/a5.tsv" -alkylation_out "$TMP/alk5.tsv" -alkylation_proteome "$DB" -fixed_modifications
alk_check "$TMP/alk5.tsv"
[ "$(val "$TMP/alk5.tsv" alk_run window) $(val "$TMP/alk5.tsv" alk_run fixed_c_delta)" = "0.02 0" ] || fail "alk5: window/fixed_c_delta"
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
"$BIN" "${COMMON[@]}" -out "$TMP/x.tsv" -alkylation_out "$TMP/x9.tsv" -alkylation_proteome zebrafish > "$TMP/log" 2>&1 \
  && fail "an unknown -alkylation_proteome was accepted"
grep -q "is neither auto" "$TMP/log" || fail "no message for an unknown -alkylation_proteome"
printf '' | "$BIN" -stream -alkylation_out "$TMP/x10.tsv" > "$TMP/log" 2>&1 && fail "-stream with -alkylation_out was accepted"
"$BIN" "${COMMON[@]}" -out "$TMP/w.tsv" -alkylation_min_spectra 5 > "$TMP/log" 2>&1 \
  || fail "-alkylation_min_spectra without -alkylation_out was refused"
grep -q -- "-alkylation_min_spectra is only read for -alkylation_out" "$TMP/log" || fail "no warning for -alkylation_min_spectra"
run "${COMMON[@]}" -out "$TMP/a7.tsv" -recon_fasta "$DB" -alkylation_out "$TMP/alk7.tsv" -alkylation_proteome human
grep -q -- "-alkylation_proteome is ignored" "$TMP/log" || fail "no warning for -alkylation_proteome with -recon_fasta"
[ ! -e "$TMP/alk7.tsv.part" ] || fail "a .part file is left behind"

echo "digest_cli_test: all checks passed"
