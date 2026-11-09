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
#   e. -search_shifts both with msfragger: mass_offsets starts with 0 and each
#      decision row of an offset is in it; Comet's non-negative rule does not apply.
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
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
ARGS=(-in "$IN" -recon_fasta "$DB" -tag_length 4 -extension 1 -fragment_tolerance 0.5
      -fragment_tolerance_unit Da -fixed_modifications 'Carbamidomethyl (C)'
      -variable_modifications 'Oxidation (M)' 'Acetyl (Protein N-term)'
      -search_precursor_tolerance 15 -search_isotope_errors 2 -threads 2)
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

# ---- e
run "$TMP/e" -out t.tsv -fasta_out red.fasta -search_config_out f.params -search_engine msfragger -search_shifts both \
  -search_shifts_out sh.tsv -massgap_min_spectra 2
off=$(key "$TMP/e/f.params" mass_offsets)
case "$off" in 0|0/*) ;; *) fail "e: mass_offsets '$off' does not start with 0" ;; esac
awk -F'\t' '!/^#/ && $5 == "offset" { print $8 }' "$TMP/e/sh.tsv" > "$TMP/e/off.txt"
while read -r o; do
  case "/$off/" in *"/$o/"*) ;; *) fail "e: the exported offset $o is not in mass_offsets '$off'" ;; esac
done < "$TMP/e/off.txt"
grep -q 'kept non-negative' "$TMP/e/sh.tsv" && fail "e: Comet's non-negative rule applied to MSFragger"
[ "$(key "$TMP/e/f.params" localize_delta_mass)" = "$([ "$off" = 0 ] && echo 0 || echo 1)" ] \
  || fail "e: localize_delta_mass does not follow the offsets"
echo "e: mass_offsets $off ($(wc -l < "$TMP/e/off.txt" | tr -d ' ') offsets)"
echo "msfragger_cli_test: all checks passed"
