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
# 1.16 follow-up: the isotope_error column (13C+k only where no better
# residue-specific name fits), -delta_group (default: every sampled
# spectrum in exactly one row, the rows the -delta_spectra_out lines name;
# 0: the 1.15 local-maximum rows, recomputed here from the per-spectrum
# deltas) and -delta_spectra_out (one line per sample, thread-independent).
# 1.16b: the appended columns (fragment_localized + sequence_constrained =
# localized, ambiguous within unlocalized, precursor_flank, charge_assumed,
# class, isobars), the provenance columns of -delta_spectra_out,
# -delta_counts_out (every sum check ok, thread-independent), the observation
# classes of the synthetic rows, -delta_select consensus and the 1.16a
# options (-delta_loc_model count -delta_loc_min_evidence 1
# -delta_isotope_flank any) leaving the sample columns unchanged.
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
  head -1 "$1" | tr -d '\r' | grep -qx $'delta\tspectra\ttop_interps\tlocalized\tresidues\tunlocalized\tunimod\tpsimod\tisotope_error\tfragment_localized\tsequence_constrained\tambiguous\tprecursor_flank\tcharge_assumed\tclass\tisobars' \
    || fail "$2: header $(head -1 "$1")"
  tr -d '\r' < "$1" | awk -F'\t' '
    NR == 1 { next }
    NF != 16 { print "row " NR ": " NF " fields"; bad = 1; next }
    $10 + $11 != $4 { print "row " NR ": fragment_localized + sequence_constrained != localized"; bad = 1 }
    $12 > $6 { print "row " NR ": ambiguous > unlocalized"; bad = 1 }
    $13 > $2 || $14 > $2 { print "row " NR ": precursor_flank or charge_assumed > spectra"; bad = 1 }
    $15 != "-" && $15 !~ /^[a-z_]+:[0-9]+(,[a-z_]+:[0-9]+)*$/ { print "row " NR ": class " $15; bad = 1 }
    $16 != "-" && $16 !~ /=/ { print "row " NR ": isobars " $16; bad = 1 }
    {
      sum = 0
      if ($5 != "-") { n = split($5, parts, ","); for (i = 1; i <= n; ++i) { c = parts[i]; sub(/.*:/, "", c); sum += c } }
      if (sum != $4) { print "row " NR ": localized " $4 " but residues sum to " sum; bad = 1 }
      if ($4 + $6 > $2) { print "row " NR ": localized + unlocalized > spectra"; bad = 1 }
      if ($4 == 0 && ($7 != "-" || $8 != "-")) { print "row " NR ": a name without a localized site"; bad = 1 }
      if ($7 != "-" && $7 !~ /@[^;]*\([+-][0-9.]+(ppm|mDa)\)/) { print "row " NR ": unimod cell " $7; bad = 1 }
      if ($8 != "-" && $8 !~ /^MOD:[0-9]+ /) { print "row " NR ": psimod cell " $8; bad = 1 }
      if ($1 == "0.0000" && ($4 != 0 || $6 != 0)) { print "the exact row counts gaps"; bad = 1 }
      if ($9 != "-" && $9 !~ /^13C\+[12]\([+-][0-9.]+(ppm|mDa)\)$/) { print "row " NR ": isotope_error " $9; bad = 1 }
      if ($9 != "-" && ($1 + 0 < 0.9 || ($1 + 0 > 1.1 && $1 + 0 < 1.9) || $1 + 0 > 2.1)) { print "row " NR ": isotope_error at " $1; bad = 1 }
    }
    END { exit bad }' || fail "$2: survey columns"
}
# spectra_rows TABLE SPECTRA N NAME: the rows hold N spectra, each once; the
# spectra file has N lines, each naming a row whose count it is part of.
spectra_rows() {
  head -1 "$2" | tr -d '\r' | grep -qx $'spectrum\tdelta\trow\tinterp\tpeptide\tsite\tsite_pos\tlocalized\tloc_evidence\tevalue\tdelta_full\ttag\tprotein\tpos\torientation\tgap_side\tflank\tregion\tcharge\tcharge_source\tprecursor_isotope\tloc_class\tloc_score\tloc_ties\tloc_excluded\tnull_class\tnull_evidence\tobs_class\tobs_detail\tn_placements\tn_exact\tn_gapped\tn_peptides\ttag_support\ttags_placed\tplacements' \
    || fail "$4: -delta_spectra_out header"
  tr -d '\r' < "$2" | awk -F'\t' '
    NR == 1 { next }
    NF != 36 { print "line " NR ": " NF " fields"; bad = 1; next }
    ($2 + 0 == 0) != ($16 == "-") { print "line " NR ": gap_side " $16 " for delta " $2; bad = 1 }
    $16 != "-" && $17 != "precursor" && $17 != "fragment" { print "line " NR ": flank " $17; bad = 1 }
    $20 != "given" && $20 != "assumed" && $20 != "inferred" { print "line " NR ": charge_source " $20; bad = 1 }
    $22 !~ /^(-|unlocalized|ambiguous|sequence|fragment)$/ { print "line " NR ": loc_class " $22; bad = 1 }
    ($8 != "-") != ($22 == "sequence" || $22 == "fragment") { print "line " NR ": localized " $8 " vs class " $22; bad = 1 }
    $30 != $31 + $32 || $30 < 1 { print "line " NR ": placements " $30 " != exact + gapped"; bad = 1 }
    $36 != "-" && split($36, pl, ";") != $30 { print "line " NR ": placements list"; bad = 1 }
    END { exit bad }' || fail "$4: -delta_spectra_out provenance columns"
  [ "$(($(wc -l < "$2") - 1))" = "$3" ] || fail "$4: -delta_spectra_out has not $3 lines"
  tr -d '\r' < "$1" | awk -F'\t' -v n="$3" 'NR > 1 { s += $2 } END { exit s != n }' \
    || fail "$4: the rows do not sum to the $3 sampled spectra"
  tr -d '\r' < "$2" | awk -F'\t' 'NR > 1 { print $3 }' | sort | uniq -c | awk '{ print $2 "\t" $1 }' | sort > "$TMP/per_row"
  tr -d '\r' < "$1" | awk -F'\t' 'NR > 1 { print $1 "\t" $2 }' | sort > "$TMP/rows"
  same "$TMP/rows" "$TMP/per_row" "$4: the spectra per row differ from the -delta_spectra_out lines"
}
# legacy_rows SPECTRA: the 1.15 rows (0.5 mDa bins; a bin no neighbour
# exceeds takes its strictly smaller neighbours) from the sampled deltas.
legacy_rows() {
  tr -d '\r' < "$1" | awk -F'\t' '
    NR == 1 { next }
    { x = $2 / 0.0005; k = x < 0 ? -int(-x + 0.5) : int(x + 0.5); c[k]++; if (!(k in seen)) { seen[k] = 1; keys[++nk] = k } }
    END {
      # keys ascending (insertion sort; small tables)
      for (i = 2; i <= nk; ++i) { v = keys[i]; j = i - 1; while (j > 0 && keys[j] > v) { keys[j + 1] = keys[j]; --j } keys[j + 1] = v }
      for (i = 1; i <= nk; ++i) {
        k = keys[i]; if (k in absorbed) continue
        nl = ((k - 1) in c) ? c[k - 1] : 0; nh = ((k + 1) in c) ? c[k + 1] : 0
        if (c[k] < nl || c[k] < nh) continue
        n = c[k]
        if (((k - 1) in c) && c[k - 1] < c[k] && !((k - 1) in absorbed)) { n += c[k - 1]; absorbed[k - 1] = 1 }
        if (((k + 1) in c) && c[k + 1] < c[k] && !((k + 1) in absorbed)) { n += c[k + 1]; absorbed[k + 1] = 1 }
        printf "%.4f\t%d\n", k * 0.0005, n
      }
    }'
}
# check NAME ARGS...: the invariants, -recon_out and the tags unchanged by
# -delta_out, the same table with -recon_localize and at 1 and 4 threads.
check_run() {
  local name="$1"; shift
  run "$@" -threads 2 -out "$TMP/$name.a.tsv" -recon_out "$TMP/$name.r0.tsv"
  run "$@" -threads 2 -out "$TMP/$name.b.tsv" -recon_out "$TMP/$name.r1.tsv" -delta_out "$TMP/$name.d.tsv" \
    -delta_spectra_out "$TMP/$name.s.tsv" -delta_counts_out "$TMP/$name.cnt.tsv"
  grep -q '^Delta sites: ' "$TMP/log" || fail "$name: no 'Delta sites:' log line"
  local n
  n=$(sed -n 's/^Delta histogram: \([0-9]*\) spectra sampled.*/\1/p' "$TMP/log")
  [ -n "$n" ] && [ "$n" -gt 0 ] || fail "$name: no samples"
  spectra_rows "$TMP/$name.d.tsv" "$TMP/$name.s.tsv" "$n" "$name"
  # -delta_counts_out: every sum check holds, and the samples are the log's.
  tr -d '\r' < "$TMP/$name.cnt.tsv" | awk -F'\t' -v n="$n" '
    $1 ~ /^check_/ { ++checks; if ($2 != "ok") { print $1 " " $2; bad = 1 } }
    $1 == "samples" && $2 != n { print "samples " $2 " != " n; bad = 1 }
    END { exit bad || checks < 6 }' || fail "$name: -delta_counts_out"
  # The 1.16a survey options change the site columns only, never the samples.
  run "$@" -threads 2 -out "$TMP/$name.o.tsv" -recon_out "$TMP/$name.ro.tsv" -delta_out "$TMP/$name.do.tsv" \
    -delta_loc_model count -delta_loc_min_evidence 1 -delta_isotope_flank any
  invariants "$TMP/$name.do.tsv" "$name 1.16a"
  tr -d '\r' < "$TMP/$name.d.tsv" | cut -f1-3 > "$TMP/$name.d.c3"
  tr -d '\r' < "$TMP/$name.do.tsv" | cut -f1-3 > "$TMP/$name.do.c3"
  same "$TMP/$name.d.c3" "$TMP/$name.do.c3" "$name: the 1.16a localization options changed the samples"
  # -delta_select consensus: still one sample per placed spectrum, every one in a row.
  run "$@" -threads 2 -out "$TMP/$name.k.tsv" -recon_out "$TMP/$name.rk.tsv" -delta_out "$TMP/$name.dk.tsv" \
    -delta_spectra_out "$TMP/$name.sk.tsv" -delta_select consensus
  spectra_rows "$TMP/$name.dk.tsv" "$TMP/$name.sk.tsv" "$n" "$name consensus"
  run "$@" -threads 2 -out "$TMP/$name.g.tsv" -recon_out "$TMP/$name.rg.tsv" -delta_out "$TMP/$name.d0.tsv" -delta_group 0 \
    -delta_spectra_out "$TMP/$name.s0.tsv"
  invariants "$TMP/$name.d0.tsv" "$name -delta_group 0"
  legacy_rows "$TMP/$name.s0.tsv" > "$TMP/$name.legacy"
  tr -d '\r' < "$TMP/$name.d0.tsv" | awk -F'\t' 'NR > 1 { print $1 "\t" $2 }' > "$TMP/$name.d0.cut"
  same "$TMP/$name.legacy" "$TMP/$name.d0.cut" "$name: -delta_group 0 rows are not the 1.15 local-maximum rows"
  same "$TMP/$name.a.tsv" "$TMP/$name.b.tsv" "$name: -delta_out changed the tag TSV"
  same "$TMP/$name.r0.tsv" "$TMP/$name.r1.tsv" "$name: -delta_out changed -recon_out"
  invariants "$TMP/$name.d.tsv" "$name"
  run "$@" -threads 2 -out "$TMP/$name.c.tsv" -recon_out "$TMP/$name.r2.tsv" -delta_out "$TMP/$name.d2.tsv" -recon_localize
  same "$TMP/$name.d.tsv" "$TMP/$name.d2.tsv" "$name: -recon_localize changed -delta_out"
  for t in 1 4; do
    run "$@" -threads $t -out "$TMP/$name.t$t.tsv" -recon_out "$TMP/$name.rt$t.tsv" -delta_out "$TMP/$name.dt$t.tsv" \
      -delta_spectra_out "$TMP/$name.st$t.tsv" -delta_counts_out "$TMP/$name.ct$t.tsv"
    same "$TMP/$name.d.tsv" "$TMP/$name.dt$t.tsv" "$name: -delta_out differs between 2 and $t threads"
    same "$TMP/$name.s.tsv" "$TMP/$name.st$t.tsv" "$name: -delta_spectra_out differs between 2 and $t threads"
    same "$TMP/$name.cnt.tsv" "$TMP/$name.ct$t.tsv" "$name: -delta_counts_out differs between 2 and $t threads"
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
# 1.16b observation classes (assigned before the names) and the evidence classes.
for c in "-91.02 -91.00 fixed_replacement:3" "-18.02 -18.00 loss:3" "42.00 42.02 terminal:3"; do
  read -r lo hi want <<< "$c"
  r=$(row "$D" "$lo" "$hi"); echo "$r" | cut -f15 | grep -qx "$want" || fail "row $lo..$hi: class $(echo "$r" | cut -f15), not $want"
  echo "$r" | awk -F'\t' '$10 == 3 && $11 == 0' | grep -q . || fail "row $lo..$hi: not 3 fragment-localized"
done
tr -d '\r' < "$D" | awk -F'\t' '$1 + 0 > 15.99 && $1 + 0 < 16.0 && $15 !~ /^residue:/ { bad = 1 } END { exit bad }' \
  || fail "+15.995 rows: class not residue"
# The null on moved peaks: written for every gapped sample, and never fragment-localized here.
run "${SYNARGS[@]}" -threads 2 -out "$TMP/syn.n.tsv" -recon_out "$TMP/syn.rn.tsv" -delta_out "$TMP/syn.dn.tsv" \
  -delta_spectra_out "$TMP/syn.sn.tsv" -delta_loc_null 7.3
tr -d '\r' < "$TMP/syn.sn.tsv" | awk -F'\t' 'NR > 1 && ($26 == "-" || $26 == "fragment") { bad = 1 } END { exit bad }' \
  || fail "-delta_loc_null: a gapped sample without a null class, or a fragment-localized null"
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
# -delta_spectra_out needs -delta_out
"$BIN" -in "$SYN" -recon_fasta "$DB" -extension 3 -out "$TMP/x.tsv" -recon_out "$TMP/x.r.tsv" \
  -delta_spectra_out "$TMP/x.s.tsv" > "$TMP/log" 2>&1 && fail "-delta_spectra_out without -delta_out was accepted"
"$BIN" -in "$SYN" -recon_fasta "$DB" -extension 3 -out "$TMP/x.tsv" -recon_out "$TMP/x.r.tsv" \
  -delta_counts_out "$TMP/x.c.tsv" > "$TMP/log" 2>&1 && fail "-delta_counts_out without -delta_out was accepted"
echo "delta_sites_cli_test: passed"
