#!/usr/bin/env bash
# 1.16 mass-shift survey: the -delta_out site and name columns against the
# real binary. On test/fixtures/delta_sites.mgf (in-silico spectra of four
# Ecoli_MS2_small.fasta peptides, each with one unsearched modification; see
# make_delta_sites_fixture.py) the rows carry the expected sites and names:
# Cys->Dha against the fixed Carbamidomethyl at -91.009, Dehydrated on S,
# Oxidation on M, Acetyl at a terminal-ambiguous N-term|L. On both that file
# and the vendored E. coli run: the 1.15 columns and -recon_out are unchanged
# by -delta_out; every row has eight fields; localized is the sum of the
# residues counts and localized + unlocalized never exceed spectra; names
# appear only on rows with a localized site; the table is the same with and
# without -recon_localize and at 1, 2 and 4 threads; a Da name tolerance
# changes the names only.
# Exits 77 (ctest SKIP) when the binary cannot start.
set -u
BIN="$1"
IN="$2"     # test/fixtures/Ecoli_MS2_small.mzML
DB="$3"     # test/fixtures/Ecoli_MS2_small.fasta
SYN="$4"    # test/fixtures/delta_sites.mgf
if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-delta-sites.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
same() {
  tr -d '\r' < "$1" > "$1.lf" && tr -d '\r' < "$2" > "$2.lf" || fail "cannot read $1 or $2"
  cmp -s "$1.lf" "$2.lf" && return
  diff "$1.lf" "$2.lf" | head -8 | sed -n l >&2
  fail "$3"
}
run() { "$BIN" "$@" > "$TMP/log" 2>&1 || { cat "$TMP/log" >&2; fail "FASTag $*"; }; }
# row FILE LO HI: the first row with LO <= delta <= HI
row() { tr -d '\r' < "$1" | awk -F'\t' -v lo="$2" -v hi="$3" 'NR > 1 && $1 + 0 >= lo && $1 + 0 <= hi { print; exit }'; }
invariants() {
  head -1 "$1" | tr -d '\r' | grep -qx $'delta\tspectra\ttop_interps\tlocalized\tresidues\tunlocalized\tunimod\tpsimod' \
    || fail "$2: header $(head -1 "$1")"
  tr -d '\r' < "$1" | awk -F'\t' '
    NR == 1 { next }
    NF != 8 { print "row " NR ": " NF " fields"; bad = 1; next }
    {
      sum = 0
      if ($5 != "-") { n = split($5, parts, ","); for (i = 1; i <= n; ++i) { c = parts[i]; sub(/.*:/, "", c); sum += c } }
      if (sum != $4) { print "row " NR ": localized " $4 " but residues sum to " sum; bad = 1 }
      if ($4 + $6 > $2) { print "row " NR ": localized + unlocalized > spectra"; bad = 1 }
      if ($4 == 0 && ($7 != "-" || $8 != "-")) { print "row " NR ": a name without a localized site"; bad = 1 }
      if ($7 != "-" && $7 !~ /@[^;]*\([+-][0-9.]+(ppm|mDa)\)/) { print "row " NR ": unimod cell " $7; bad = 1 }
      if ($8 != "-" && $8 !~ /^MOD:[0-9]+ /) { print "row " NR ": psimod cell " $8; bad = 1 }
      if ($1 == "0.0000" && ($4 != 0 || $6 != 0)) { print "the exact row counts gaps"; bad = 1 }
    }
    END { exit bad }' || fail "$2: survey columns"
}
# check NAME ARGS...: the invariants, -recon_out and the tags unchanged by
# -delta_out, the same table with -recon_localize and at 1 and 4 threads.
check_run() {
  local name="$1"; shift
  run "$@" -threads 2 -out "$TMP/$name.a.tsv" -recon_out "$TMP/$name.r0.tsv"
  run "$@" -threads 2 -out "$TMP/$name.b.tsv" -recon_out "$TMP/$name.r1.tsv" -delta_out "$TMP/$name.d.tsv"
  grep -q '^Delta sites: ' "$TMP/log" || fail "$name: no 'Delta sites:' log line"
  same "$TMP/$name.a.tsv" "$TMP/$name.b.tsv" "$name: -delta_out changed the tag TSV"
  same "$TMP/$name.r0.tsv" "$TMP/$name.r1.tsv" "$name: -delta_out changed -recon_out"
  invariants "$TMP/$name.d.tsv" "$name"
  run "$@" -threads 2 -out "$TMP/$name.c.tsv" -recon_out "$TMP/$name.r2.tsv" -delta_out "$TMP/$name.d2.tsv" -recon_localize
  same "$TMP/$name.d.tsv" "$TMP/$name.d2.tsv" "$name: -recon_localize changed -delta_out"
  for t in 1 4; do
    run "$@" -threads $t -out "$TMP/$name.t$t.tsv" -recon_out "$TMP/$name.rt$t.tsv" -delta_out "$TMP/$name.dt$t.tsv"
    same "$TMP/$name.d.tsv" "$TMP/$name.dt$t.tsv" "$name: -delta_out differs between 2 and $t threads"
  done
}

# ---- the synthetic fixture: expected sites and names
SYNARGS=(-in "$SYN" -recon_fasta "$DB" -extension 3)
check_run syn "${SYNARGS[@]}"
D="$TMP/syn.d.tsv"
r=$(row "$D" -91.02 -91.00); [ -n "$r" ] || fail "no -91.009 row (Cys->Dha on a Cys searched as carbamidomethyl)"
echo "$r" | awk -F'\t' '$2 == 3 && $4 == 3 && $5 == "C:3" && $6 == 0' | grep -q . || fail "-91.009 row: $r"
echo "$r" | cut -f7 | grep -q '^Cys->Dha@C\[-Carbamidomethyl\](' || fail "-91.009 row: unimod $(echo "$r" | cut -f7)"
echo "$r" | cut -f8 | grep -q 'MOD:00793 dehydroalanine (Cys)@C\[-Carbamidomethyl\]' || fail "-91.009 row: psimod"
r=$(row "$D" -18.02 -18.00); [ -n "$r" ] || fail "no -18.011 row"
echo "$r" | awk -F'\t' '$5 == "S:3"' | grep -q . || fail "-18.011 row: residues $(echo "$r" | cut -f5)"
echo "$r" | cut -f7 | grep -q '^Dehydrated@S(' || fail "-18.011 row: unimod"
echo "$r" | cut -f8 | grep -q 'MOD:00189 dehydroalanine (Ser)@S' || fail "-18.011 row: PSI-MOD's Unimod-linked MOD:00189"
r=$(row "$D" 42.00 42.02); [ -n "$r" ] || fail "no +42.011 row"
echo "$r" | awk -F'\t' '$5 == "N-term|L:3"' | grep -q . || fail "+42.011 row: residues $(echo "$r" | cut -f5)"
echo "$r" | cut -f7 | grep -q '^Acetyl@N-term(' || fail "+42.011 row: unimod"
echo "$r" | cut -f7 | grep -q 'Protein N-term' && fail "+42.011 row: a Protein N-term entry on an internal peptide"
tr -d '\r' < "$D" | awk -F'\t' '$1 + 0 > 15.99 && $1 + 0 < 16.0 { n += $4; if ($5 !~ /^M:/ || $7 !~ /^Oxidation@M\(/) bad = 1 } END { exit bad || n != 3 }' \
  || fail "+15.995 rows: not Oxidation@M on 3 spectra"
run "${SYNARGS[@]}" -threads 2 -out "$TMP/syn.e.tsv" -recon_out "$TMP/syn.r5.tsv" -delta_out "$TMP/syn.d5.tsv" \
  -delta_name_tolerance 0.02 -delta_name_tolerance_unit Da
tr -d '\r' < "$D" | cut -f1-6 > "$TMP/d.cut"
tr -d '\r' < "$TMP/syn.d5.tsv" | cut -f1-6 > "$TMP/d5.cut"
same "$TMP/d.cut" "$TMP/d5.cut" "the name tolerance changed the counts"
invariants "$TMP/syn.d5.tsv" "syn Da"
tr -d '\r' < "$TMP/syn.d5.tsv" | awk -F'\t' 'NR > 1 && $7 != "-" && $7 !~ /mDa\)/ { bad = 1 } END { exit bad }' \
  || fail "a Da tolerance does not write mDa errors"

# ---- the E. coli run (ion trap, Da tolerances, as digest_cli_test)
check_run ecoli -in "$IN" -tag_length 4 -fragment_tolerance 0.5 -fragment_tolerance_unit Da -recon_fasta "$DB"
echo "delta_sites_cli_test: passed"
