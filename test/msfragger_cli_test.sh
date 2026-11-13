#!/usr/bin/env bash
# -search_engine msfragger (1.13, backlog #18) against the real binary, on
# Ecoli_MS2_small.mzML and fixtures/Ecoli_shortlist.fasta:
#   a. with -fasta_out: exit 0; the config is a complete fragger.params naming
#      -fasta_out with the run's tolerances (separate precursor lower/upper/
#      units, true tolerance equal), mods and 0 as mass_offsets; -fasta_out is
#      the Sage run's -fasta_out followed by one reversed rev_ decoy per entry;
#   b. the shared outputs (-out, -recon_out, -shortlist_out) equal the Sage run's;
#   c. without -fasta_out a database without decoys is refused, nothing
#      written; a target-decoy database (rev_ on half the entries) is accepted;
#      -search_decoy_prefix sets the prefix of the appended decoys;
#   d. -search_config_template with msfragger is refused;
#   e. -search_shifts both and -shift_max_offsets with msfragger (removed in
#      1.14): accepted, one warning each, the config and FASTA unchanged;
#   f. decoys never enter the protease background: sage = msfragger on a
#      decoy-heavy database, and Sage's protease call on it equals the one on
#      the same targets without the decoys (no FASTAG_PREV_BIN needed); with
#      FASTAG_PREV_BIN the Sage and Comet hand-off outputs and logs equal that
#      build's (FASTAG_IDENTITY_REQUIRED=1: fail when it is unset);
#   h. the by-engine export defaults (isotope errors, missed cleavages,
#      precursor window, N-terminal acetylation);
#   i. the msfragger shortlist defaults (post-1.13.1): without the four options
#      the shortlist and exports equal a run that gives the held-out-tested
#      values -shortlist_gapped -shortlist_max_evalue 10 -recon_min_length 6
#      -recon_missed_cleavages 2, log and shortlist header say so; Sage keeps
#      1.13.1's values, as does -shortlist_protease auto; a value on the command
#      line or in an INI wins;
#   j. -shortlist_exact_only (removed in 1.14, failed its held-out test): with
#      msfragger, with -shortlist_gapped, from an INI and with Sage, one warning
#      and outputs byte-identical to the same run without it;
#   k. calibrate_mass 2 under the msfragger defaults (post-1.15, development
#      runs only), 0 outside them.
# Cases a, b and f give the four options explicitly (1.13.1 values, gapped on:
# a flag cannot be given off), so Sage and MSFragger runs share one shortlist.
# Exits 77 (ctest SKIP) when the binary cannot start.
set -u
BIN="$1"
FIX="$2"     # test/fixtures
DATA="$3"    # data/digest
IN="$FIX/Ecoli_MS2_small.mzML"
DB="$FIX/Ecoli_shortlist.fasta"

if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi
export FASTAG_DIGEST_DIR="$DATA"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-msfragger-cli.XXXXXX") || exit 1
# Windows (MSYS): the native binary and python see C:/..., not /tmp/...; compare and pass that form.
command -v cygpath >/dev/null 2>&1 && TMP=$(cygpath -m "$TMP")
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
ARGS=(-in "$IN" -recon_fasta "$DB" -tag_length 4 -extension 1 -fragment_tolerance 0.5
      -fragment_tolerance_unit Da -fixed_modifications 'Carbamidomethyl (C)'
      -variable_modifications 'Oxidation (M)' 'Acetyl (Protein N-term)'
      -search_precursor_tolerance 15 -search_isotope_errors 2 -search_missed_cleavages 1 -threads 2
      -shortlist_gapped -shortlist_max_evalue 0.1 -recon_min_length 0 -recon_missed_cleavages 1)
run() {
  local d=$1; shift
  mkdir -p "$d"
  ( cd "$d" && "$BIN" "${ARGS[@]}" "$@" > run.log 2>&1 ) || { cat "$d/run.log" >&2; fail "$(basename "$d"): exit non-zero"; }
}
key() { sed -n "s/^$2 = //p" "$1"; }
# fasta2tsv FASTA: id<TAB>sequence per entry
fasta2tsv() { awk '/^>/ { if (id != "") print id "\t" seq; id = substr($1, 2); seq = ""; next } { seq = seq $0 } END { if (id != "") print id "\t" seq }' "$1"; }

# ---- a/b
run "$TMP/s" -out t.tsv -recon_out r.tsv -shortlist_out sl.tsv -fasta_out red.fasta -search_config_out sage.json
run "$TMP/m" -out t.tsv -recon_out r.tsv -shortlist_out sl.tsv -fasta_out red.fasta -search_config_out fragger.params \
  -search_engine msfragger
C="$TMP/m/fragger.params"
head -1 "$C" | grep -q '^# MSFragger-4.4.1 parameters written by FASTag' || fail "a: no MSFragger header"
[ "$(key "$C" database_name)" = red.fasta ] || fail "a: database_name is not -fasta_out"
[ "$(key "$C" precursor_mass_lower)" = -15 ] && [ "$(key "$C" precursor_mass_upper)" = 15 ] \
  && [ "$(key "$C" precursor_mass_units)" = 1 ] || fail "a: precursor window"
[ "$(key "$C" precursor_true_tolerance)" = 15 ] && [ "$(key "$C" precursor_true_units)" = 1 ] || fail "a: true tolerance"
[ "$(key "$C" fragment_mass_tolerance)" = 0.5 ] && [ "$(key "$C" fragment_mass_units)" = 0 ] || fail "a: fragment tolerance"
[ "$(key "$C" isotope_error)" = 0/1/2 ] || fail "a: isotope_error"
[ "$(key "$C" mass_offsets)" = 0 ] || fail "a: mass_offsets is not 0"
[ "$(key "$C" decoy_prefix)" = rev_ ] || fail "a: decoy_prefix"
[ "$(key "$C" add_C_cysteine)" = 57.021464 ] || fail "a: fixed CAM"
[ "$(key "$C" variable_mod_01)" = "15.994915 M 3" ] && [ "$(key "$C" variable_mod_02)" = "42.010565 [^ 1" ] \
  || fail "a: variable mods"
grep -q '^variable_mod_03' "$C" && fail "a: an unused variable slot is written"
[ "$(key "$C" search_enzyme_cut_1)" = KR ] && [ "$(key "$C" search_enzyme_nocut_1)" = P ] \
  && [ "$(key "$C" allowed_missed_cleavage_1)" = 1 ] || fail "a: enzyme"
grep -q 'reversed decoys' "$TMP/m/run.log" || fail "a: the log does not report the decoys"
fasta2tsv "$TMP/s/red.fasta" > "$TMP/s.tsv"
fasta2tsv "$TMP/m/red.fasta" > "$TMP/m.tsv"
n=$(wc -l < "$TMP/s.tsv" | tr -d ' ')
[ "$n" -ge 3 ] || fail "a: the Sage run's FASTA holds $n entries"
[ "$(wc -l < "$TMP/m.tsv" | tr -d ' ')" -eq $((2 * n)) ] || fail "a: not one decoy per entry"
head -n "$n" "$TMP/m.tsv" | cmp -s - "$TMP/s.tsv" || fail "a: the targets differ from the Sage run's -fasta_out"
awk -F'\t' '{ s = ""; for (i = length($2); i > 0; --i) s = s substr($2, i, 1); print "rev_" $1 "\t" s }' "$TMP/s.tsv" \
  | cmp -s - <(tail -n "$n" "$TMP/m.tsv") || fail "a: the decoys are not the reversed targets with rev_"
grep -q '(no decoys)' "$TMP/s/run.log" || fail "a: the Sage run's log changed"
for f in t.tsv r.tsv sl.tsv; do cmp -s "$TMP/s/$f" "$TMP/m/$f" || fail "b: $f differs between sage and msfragger"; done

# ---- c
mkdir -p "$TMP/c1"
( cd "$TMP/c1" && "$BIN" "${ARGS[@]}" -out t.tsv -search_config_out f.params -search_engine msfragger > run.log 2>&1 ) \
  && fail "c: a database without a decoy set is accepted"
grep -q 'MSFragger generates no decoys' "$TMP/c1/run.log" || { cat "$TMP/c1/run.log" >&2; fail "c: no refusal message"; }
[ -e "$TMP/c1/f.params" ] && fail "c: the refused config was written"
# A target-decoy database: every entry and its reversed rev_ twin.
fasta2tsv "$DB" | grep -v '^rev_' | awk -F'\t' '{ print ">" $1 "\n" $2 } { s = ""; for (i = length($2); i > 0; --i) s = s substr($2, i, 1); d = d ">rev_" $1 "\n" s "\n" } END { printf "%s", d }' > "$TMP/td.fasta"
mkdir -p "$TMP/c2"
( cd "$TMP/c2" && "$BIN" "${ARGS[@]/$DB/$TMP/td.fasta}" -out t.tsv -search_config_out f.params -search_engine msfragger \
    > run.log 2>&1 ) || { cat "$TMP/c2/run.log" >&2; fail "c: a target-decoy database is refused"; }
[ "$(key "$TMP/c2/f.params" database_name)" = "$TMP/td.fasta" ] || fail "c: database_name is not the input database"
grep -q "entries with the decoy prefix 'rev_'" "$TMP/c2/run.log" || fail "c: no decoy count in the log"
run "$TMP/c3" -out t.tsv -fasta_out red.fasta -search_config_out f.params -search_engine msfragger -search_decoy_prefix XXX_
[ "$(key "$TMP/c3/f.params" decoy_prefix)" = XXX_ ] || fail "c: -search_decoy_prefix not in the config"
[ "$(grep -c '^>XXX_' "$TMP/c3/red.fasta")" -eq "$n" ] || fail "c: the decoys do not carry -search_decoy_prefix"

# ---- d
mkdir -p "$TMP/d"
echo "x = 1" > "$TMP/d/t.params"
( cd "$TMP/d" && "$BIN" "${ARGS[@]}" -out t.tsv -fasta_out r.fasta -search_config_out f.params -search_engine msfragger \
    -search_config_template t.params > run.log 2>&1 ) && fail "d: -search_config_template with msfragger accepted"
grep -q 'needs -search_engine comet' "$TMP/d/run.log" || fail "d: no refusal message"

# ---- e: -search_shifts and its options were removed in 1.14: no effect
run "$TMP/e0" -out t.tsv -fasta_out red.fasta -search_config_out f.params -search_engine msfragger
run "$TMP/e1" -out t.tsv -fasta_out red.fasta -search_config_out f.params -search_engine msfragger \
  -search_shifts both -shift_max_offsets 3
for o in search_shifts shift_max_offsets; do
  [ "$(grep -c -- "-$o was removed in 1.14 (failed its held-out test); it has no effect" "$TMP/e1/run.log")" = 1 ] \
    || fail "e: -$o: not exactly one removal warning"
done
for f in t.tsv red.fasta f.params; do cmp -s "$TMP/e0/$f" "$TMP/e1/$f" || fail "e: -search_shifts both changed $f"; done
[ "$(key "$TMP/e1/f.params" mass_offsets)" = 0 ] && [ "$(key "$TMP/e1/f.params" localize_delta_mass)" = 0 ] \
  || fail "e: mass offsets exported"
[ "$(key "$TMP/e1/f.params" num_threads)" = 2 ] || fail "e: num_threads is not -threads"
# ---- f: decoys stay out of the protease background (sage and msfragger alike),
# and with FASTAG_PREV_BIN (a build without -search_engine msfragger) the Sage
# and Comet hand-off outputs are byte-identical to it. The database has many
# W-only rev_ and DECOY_ entries, so counting them would move the background.
{ cat "$DB"; for i in $(seq 1 40); do printf '>rev_W%d\n%s\n>DECOY_W%d\n%s\n' $i "$(printf 'W%.0s' $(seq 1 300))" $i "$(printf 'W%.0s' $(seq 1 300))"; done; } > "$TMP/skew.fasta"
# The in-silico chymotryptic MGF at 20 ppm, so the protease check is scored
# against the database background (a Da run is never scored).
SK=(-in "$FIX/chymo_insilico.mgf" -recon_fasta "$TMP/skew.fasta" -fragment_tolerance 20 -fragment_tolerance_unit ppm
    -shortlist_force -threads 2 -shortlist_gapped -shortlist_max_evalue 0.1 -recon_min_length 0 -recon_missed_cleavages 1)
runf() { local d=$1 bin=$2; shift 2; mkdir -p "$d"; ( cd "$d" && "$bin" "${SK[@]}" -out t.tsv -shortlist_out sl.tsv "$@" > run.log 2>&1 ) || { cat "$d/run.log" >&2; fail "f: $(basename "$d") exit non-zero"; }; }
runf "$TMP/fs" "$BIN" -fasta_out red.fasta -search_config_out sage.json
runf "$TMP/fm" "$BIN" -fasta_out red.fasta -search_config_out f.params -search_engine msfragger
for f in t.tsv sl.tsv; do cmp -s "$TMP/fs/$f" "$TMP/fm/$f" || fail "f: $f differs between sage and msfragger on the decoy-heavy database"; done
grep -q '^# protease: non_tryptic Chymotrypsin' "$TMP/fs/sl.tsv" || fail "f: the protease check was not scored"
diff <(grep -i 'protease\|chymotrypsin\|fits' "$TMP/fs/run.log") <(grep -i 'protease\|chymotrypsin\|fits' "$TMP/fm/run.log") > /dev/null \
  || fail "f: the protease call differs between sage and msfragger"
# The same targets without the decoys: the background, and so the call, is equal.
SKT=()
for x in "${SK[@]}"; do [ "$x" = "$TMP/skew.fasta" ] && SKT+=("$DB") || SKT+=("$x"); done
mkdir -p "$TMP/ft"
( cd "$TMP/ft" && "$BIN" "${SKT[@]}" -out t.tsv -shortlist_out sl.tsv -fasta_out red.fasta -search_config_out sage.json \
    > run.log 2>&1 ) || { cat "$TMP/ft/run.log" >&2; fail "f: ft exit non-zero"; }
grep -q -- "-recon_fasta $DB" <(echo "${SKT[*]}") || fail "f: the target-only run does not use $DB"
diff <(grep '^# protease' "$TMP/fs/sl.tsv") <(grep '^# protease' "$TMP/ft/sl.tsv") > /dev/null \
  || fail "f: the sl.tsv protease call moves when decoys are added (decoys in the background)"
diff <(grep -i 'protease' "$TMP/fs/run.log") <(grep -i 'protease' "$TMP/ft/run.log") > /dev/null \
  || fail "f: the logged protease check moves when decoys are added (decoys in the background)"
if [ -z "${FASTAG_PREV_BIN:-}" ] && [ "${FASTAG_IDENTITY_REQUIRED:-0}" = 1 ]; then
  fail "f: FASTAG_IDENTITY_REQUIRED=1 but FASTAG_PREV_BIN is unset"
fi
if [ -n "${FASTAG_PREV_BIN:-}" ]; then
  for eng in sage comet; do
    X=(-fasta_out red.fasta -search_config_out cfg -search_engine $eng)
    runf "$TMP/fp_$eng" "$FASTAG_PREV_BIN" "${X[@]}"
    runf "$TMP/fn_$eng" "$BIN" "${X[@]}"
    for f in t.tsv sl.tsv red.fasta cfg; do
      cmp -s "$TMP/fp_$eng/$f" "$TMP/fn_$eng/$f" || fail "f: $eng $f differs from FASTAG_PREV_BIN"
    done
    diff <(grep -v 'took\|Peak Memory' "$TMP/fp_$eng/run.log") <(grep -v 'took\|Peak Memory' "$TMP/fn_$eng/run.log") > /dev/null \
      || fail "f: $eng log differs from FASTAG_PREV_BIN"
  done
  echo "f: sage and comet hand-off outputs equal FASTAG_PREV_BIN"
fi
# ---- h: without -search_isotope_errors MSFragger gets its own default 0..3, Sage none; an explicit 0 stays 0
HARGS=(-in "$IN" -recon_fasta "$DB" -tag_length 4 -extension 1 -fragment_tolerance 0.5 -fragment_tolerance_unit Da
       -out t.tsv -shortlist_out sl.tsv -fasta_out red.fasta -threads 2)
runh() {
  local d=$1; shift
  mkdir -p "$d"
  ( cd "$d" && "$BIN" "${HARGS[@]}" "$@" > run.log 2>&1 ) || { cat "$d/run.log" >&2; fail "$(basename "$d"): exit non-zero"; }
}
runh "$TMP/h1" -search_config_out f.params -search_engine msfragger
[ "$(key "$TMP/h1/f.params" isotope_error)" = 0/1/2/3 ] || fail "h: msfragger default isotope_error is not 0/1/2/3"
runh "$TMP/h2" -search_config_out f.params -search_engine msfragger -search_isotope_errors 0
[ "$(key "$TMP/h2/f.params" isotope_error)" = 0 ] || fail "h: an explicit -search_isotope_errors 0 is not kept"
runh "$TMP/h3" -search_config_out sage.json
grep -q '"isotope_errors": \[0, 0\]' "$TMP/h3/sage.json" || fail "h: the Sage default isotope errors changed"
# the other by-engine defaults: MSFragger 2 missed cleavages, 20 ppm, protein N-terminal acetylation;
# Sage keeps -recon_missed_cleavages, 10 ppm and no acetylation; explicit values are kept
H1=$TMP/h1/f.params
[ "$(key "$H1" allowed_missed_cleavage_1)" = 2 ] || fail "h: msfragger default missed cleavages are not 2"
[ "$(key "$H1" precursor_mass_upper)" = 20 ] && [ "$(key "$H1" precursor_true_tolerance)" = 20 ] \
  || fail "h: msfragger default precursor tolerance is not 20 ppm"
[ "$(key "$H1" variable_mod_01)" = "42.010565 [^ 1" ] || fail "h: msfragger default lacks protein N-terminal acetylation"
runh "$TMP/h4" -search_config_out f.params -search_engine msfragger -search_missed_cleavages 1 \
  -search_precursor_tolerance 10 -search_nterm_acetyl no
[ "$(key "$TMP/h4/f.params" allowed_missed_cleavage_1)" = 1 ] && [ "$(key "$TMP/h4/f.params" precursor_mass_upper)" = 10 ] \
  || fail "h: explicit missed cleavages / tolerance are not kept"
grep -q '^variable_mod_01' "$TMP/h4/f.params" && fail "h: -search_nterm_acetyl no still writes the modification"
grep -q '"missed_cleavages": 1,' "$TMP/h3/sage.json" && grep -q '"ppm": \[-10, 10\]' "$TMP/h3/sage.json" \
  || fail "h: the Sage default missed cleavages or precursor tolerance changed"
grep -q '42\.01' "$TMP/h3/sage.json" && fail "h: Sage got protein N-terminal acetylation by default"
echo "h: isotope error, missed cleavage, tolerance and acetylation defaults by engine"
# ---- i: the msfragger shortlist defaults
REC=(-shortlist_gapped -shortlist_max_evalue 10 -recon_min_length 6 -recon_missed_cleavages 2)
I=(-recon_out r.tsv -search_config_out cfg)
runh "$TMP/i1" "${I[@]}" -search_engine msfragger
runh "$TMP/i2" "${I[@]}" -search_engine msfragger "${REC[@]}"
for f in t.tsv r.tsv red.fasta cfg; do cmp -s "$TMP/i1/$f" "$TMP/i2/$f" || fail "i: $f differs from the explicit held-out recipe"; done
diff <(grep -v '^# msfragger defaults' "$TMP/i1/sl.tsv") "$TMP/i2/sl.tsv" > /dev/null || fail "i: sl.tsv differs from the explicit recipe"
grep -q '^# settings: max_evalue 10, min_spectra 2, gapped yes,' "$TMP/i1/sl.tsv" || fail "i: shortlist header settings"
grep -qx '# msfragger defaults (the configuration of its second held-out test): -shortlist_gapped on, -shortlist_max_evalue 10, -recon_min_length 6, -recon_missed_cleavages 2' \
  "$TMP/i1/sl.tsv" || fail "i: shortlist header lacks the msfragger defaults line"
grep -q 'MSFragger defaults (the configuration of its second held-out test): -shortlist_gapped on, -shortlist_max_evalue 10, -recon_min_length 6, -recon_missed_cleavages 2;' \
  "$TMP/i1/run.log" || fail "i: no log line for the msfragger defaults"
grep -q 'min tag length 6 (msfragger default)' "$TMP/i1/run.log" || fail "i: recon min length not logged as msfragger default"
grep -q 'msfragger defaults\|MSFragger defaults' "$TMP/i2/sl.tsv" "$TMP/i2/run.log" && fail "i: defaults reported although all four were given"
# Sage without the options: 1.13.1's values, no defaults line
runh "$TMP/i3" "${I[@]}"
grep -q '^# settings: max_evalue 0.1, min_spectra 2, gapped no,' "$TMP/i3/sl.tsv" || fail "i: Sage shortlist settings changed"
grep -q -i 'msfragger defaults' "$TMP/i3/sl.tsv" "$TMP/i3/run.log" && fail "i: msfragger defaults applied to Sage"
grep -q 'min tag length [0-9]* (derived)' "$TMP/i3/run.log" || fail "i: Sage recon min length not derived"
# -search_engine msfragger without -search_config_out: no defaults
runh "$TMP/i4" -recon_out r.tsv -search_engine msfragger
grep -q -i 'msfragger defaults' "$TMP/i4/sl.tsv" "$TMP/i4/run.log" && fail "i: msfragger defaults without -search_config_out"
# explicit values win, the rest stay msfragger defaults
runh "$TMP/i5" "${I[@]}" -search_engine msfragger -shortlist_max_evalue 0.1 -recon_min_length 0 -recon_missed_cleavages 1
grep -q '^# settings: max_evalue 0.1, min_spectra 2, gapped yes,' "$TMP/i5/sl.tsv" || fail "i: explicit -shortlist_max_evalue lost"
grep -qx '# msfragger defaults (the configuration of its second held-out test): -shortlist_gapped on' "$TMP/i5/sl.tsv" \
  || fail "i: header lists a default the command line set"
grep -q 'min tag length [0-9]* (derived)' "$TMP/i5/run.log" || fail "i: explicit -recon_min_length 0 lost"
# an INI value wins too
( cd "$TMP/i5" && "$BIN" -write_ini x.ini > /dev/null 2>&1 ) || fail "i: -write_ini"
sed 's/name="recon_min_length" value="0"/name="recon_min_length" value="7"/' "$TMP/i5/x.ini" > "$TMP/i5/y.ini"
grep -q 'name="recon_min_length" value="7"' "$TMP/i5/y.ini" || fail "i: INI edit"
runh "$TMP/i6" "${I[@]}" -search_engine msfragger -ini "$TMP/i5/y.ini"
grep -q 'min tag length 7 (set)' "$TMP/i6/run.log" || fail "i: the INI -recon_min_length 7 lost"
grep -q -- '-recon_min_length' <(grep '^# msfragger defaults' "$TMP/i6/sl.tsv") && fail "i: header lists the INI value as a default"
# a shortlist protease other than trypsin keeps 1.13.1's values (tested held-out with trypsin only)
runh "$TMP/i7" "${I[@]}" -search_engine msfragger -shortlist_protease auto
grep -q -i 'msfragger defaults' "$TMP/i7/sl.tsv" "$TMP/i7/run.log" && fail "i: msfragger defaults with -shortlist_protease auto"
grep -q '^# settings: max_evalue 0.1, min_spectra 2, gapped no,' "$TMP/i7/sl.tsv" || fail "i: -shortlist_protease auto settings changed"
echo "i: msfragger shortlist defaults, explicit values and INI win"
# ---- j: -shortlist_exact_only was removed in 1.14: no effect, one warning
W='-shortlist_exact_only was removed in 1.14 (failed its held-out test); it has no effect'
[ "$(grep -c -- "$W" "$TMP/i1/run.log")" = 0 ] || fail "j: warning without the option"
runh "$TMP/j1" "${I[@]}" -search_engine msfragger -shortlist_exact_only
runh "$TMP/j2" "${I[@]}" -search_engine msfragger -shortlist_exact_only -shortlist_gapped
runh "$TMP/j4" "${I[@]}" -search_engine msfragger -shortlist_gapped
( cd "$TMP/j1" && "$BIN" -write_ini x.ini > /dev/null 2>&1 ) || fail "j: -write_ini"
grep -q 'name="shortlist_exact_only" value="false"' "$TMP/j1/x.ini" || fail "j: INI lacks shortlist_exact_only"
sed 's/name="shortlist_exact_only" value="false"/name="shortlist_exact_only" value="true"/' "$TMP/j1/x.ini" > "$TMP/j1/y.ini"
grep -q 'name="shortlist_exact_only" value="true"' "$TMP/j1/y.ini" || fail "j: INI edit"
runh "$TMP/j3" "${I[@]}" -search_engine msfragger -ini "$TMP/j1/y.ini"
runh "$TMP/j5" "${I[@]}" -shortlist_exact_only
for p in j1:i1 j3:i1 j2:j4 j5:i3; do
  a=${p%%:*} b=${p##*:}
  [ "$(grep -c -- "$W" "$TMP/$a/run.log")" = 1 ] || fail "j: $a: not exactly one removal warning"
  for f in t.tsv r.tsv sl.tsv red.fasta cfg; do cmp -s "$TMP/$b/$f" "$TMP/$a/$f" || fail "j: $a: $f differs from $b"; done
done
grep -q '^# settings: max_evalue 10, min_spectra 2, gapped yes,' "$TMP/j1/sl.tsv" || fail "j: msfragger gapped default lost"
echo "j: -shortlist_exact_only has no effect and warns once (msfragger, with -shortlist_gapped, INI, Sage)"
# ---- k: calibrate_mass (post-1.15, development runs only): 2 under the msfragger defaults (also with the four
#      options given), 0 with -shortlist_protease auto; the log and header say so
for d in i1 i2; do
  [ "$(key "$TMP/$d/cfg" calibrate_mass)" = 2 ] || fail "k: $d: calibrate_mass is not 2 under the msfragger defaults"
  grep -q 'MSFragger defaults (development runs only, no held-out test): calibrate_mass 2' "$TMP/$d/run.log" \
    || fail "k: $d: no log line for calibrate_mass"
done
grep -q '^# calibrate_mass is not 0: MSFragger calibrates' "$TMP/i1/cfg" || fail "k: header comment"
[ "$(key "$TMP/i7/cfg" calibrate_mass)" = 0 ] || fail "k: calibrate_mass is not 0 with -shortlist_protease auto"
grep -q 'calibrate_mass 2' "$TMP/i7/run.log" && fail "k: calibrate_mass logged with -shortlist_protease auto"
echo "k: calibrate_mass 2 under the msfragger defaults, 0 outside them"
echo "msfragger_cli_test: all checks passed"
