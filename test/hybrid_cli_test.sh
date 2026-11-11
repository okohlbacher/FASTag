#!/usr/bin/env bash
# Hybrid EThcD/ETciD reading (FASTag 1.13 backlog item 10): -ion_series auto
# -ion_series_hybrid both, against the real binary.
#
# Synthetic runs from hybrid_ions_test --write-mzml (OpenMS
# TheoreticalSpectrumGenerator, 40 tryptic peptides of the fixture FASTA):
#   syn_split   mixed y/z: b/y ions for the C-terminal half of the cleavage
#               sites, c/z-dot ions for the N-terminal half; ETD + EThcD;
#   syn_splitf  the same peaks, no activation term, filter @etd..@hcd..;
#   syn_etd     c and z-dot ions, ETD;
#   syn_cid     b and y ions, CID.
# Checks:
#   - the option off: -ion_series_hybrid by explicitly equals it absent under
#     auto, and auto on the hybrid run equals by (1.12: hybrid read as b/y,
#     with the hybrid WARN), in every output;
#   - auto + both on the hybrid run: the ion_series column, rows of both
#     series, every spectrum's rows sorted by E-value, the INFO line with 40
#     two-pass spectra and no hybrid WARN, the ion_series_hybrid run row,
#     census best_ion_series; the b/y rows' E-values exactly 2x by's; exact
#     placements (-recon_out) per spectrum above both by and cz on the same
#     run, with c/z rows among them; the digest call from the merged rows is
#     the b/y one (Trypsin); the filter-token run equals the method run;
#   - auto + both on the CID and on the ETD run equals auto (no hybrid
#     spectrum: nothing changes), and on the vendored CID source equals by;
#     MGF (no activation) equals by;
#   - -ion_series_hybrid both without auto warns that it is ignored and
#     changes nothing; -stream refuses it;
#   - threads 1/3/8 identical; OnDisc (-out_spectra) equals the fast reader;
#   - -species leaves the c/z rows of hybrid spectra out and counts them.
# Exits 77 (ctest SKIP) when the binary cannot start.
set -u
export LC_ALL=C  # sort and comm agree on the order
BIN="$1"
SRC="$2"            # Ecoli_MS2_small.mzML
DB="$3"             # Ecoli_MS2_small.fasta
GEN="$4"            # hybrid_ions_test
BUILDTAXDB="${5:-}" # buildtaxdb (species check)
TAXDIR="${6:-}"     # data/taxonomy (species check)
DIGDIR="${7:-}"     # data/digest
MGF="${8:-}"        # Ecoli_MS2_small.mgf (no activation)
[ -n "$DIGDIR" ] && export FASTAG_DIGEST_DIR="$DIGDIR"

if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-hybrid-test.XXXXXX") || exit 1
# Windows (MSYS): the native binary and python see C:/..., not /tmp/...; compare and pass that form.
command -v cygpath >/dev/null 2>&1 && TMP=$(cygpath -m "$TMP")
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
GATE_RE='^[0-9]+ MS2 spectra, [0-9]+ tags'

for k in split:syn_split split_filter:syn_splitf etd:syn_etd cid:syn_cid; do
  "$GEN" --write-mzml "$DB" "$TMP/${k#*:}.mzML" "${k%%:*}" > /dev/null || fail "writing the synthetic ${k%%:*} run"
done
grep -q 'MS:1000598' "$TMP/syn_split.mzML" || fail "the hybrid fixture has no ETD term"
grep -q 'MS:1000598' "$TMP/syn_splitf.mzML" && fail "the filter fixture has an activation term"
grep -q '@etd50.00' "$TMP/syn_splitf.mzML" || fail "the filter fixture has no @etd token"

# runb <name> <input> <threads> [args]: stdout (no timing), stderr.
runb() {
  local name=$1 in=$2 th=$3; shift 3
  "$BIN" -in "$in" -out "$TMP/$name.tsv" -threads "$th" "$@" > "$TMP/$name.out" 2> "$TMP/$name.err" \
    || { cat "$TMP/$name.err" >&2; fail "FASTag on $name exited non-zero"; }
  grep -v 'took .* (wall)' "$TMP/$name.out" | sed "s|$TMP/$name\.|OUT.|g" > "$TMP/$name.stdout"
}
lastcol() { awk -F'\t' 'NR == 1 { print $NF; exit }' "$1"; }
valuesof() { awk -F'\t' 'NR > 1 { print $NF }' "$1" | sort -u | tr '\n' ' ' | sed 's/ $//'; }
same() {  # <a> <b> <what> [report suffixes]: tags, stdout, and every given report
  local a=$1 b=$2 what=$3; shift 3
  cmp -s "$TMP/$a.tsv" "$TMP/$b.tsv" || fail "$what: tags differ"
  cmp -s "$TMP/$a.stdout" "$TMP/$b.stdout" || fail "$what: stdout differs"
  for o in "$@"; do cmp -s "$TMP/$a.$o" "$TMP/$b.$o" || fail "$what: $o differs"; done
}

RX=(-recon_fasta "$DB" -tag_length 4 -extension 1 -fragment_tolerance 20 -fragment_tolerance_unit ppm)
sruns() {  # name input [args]
  local name=$1 in=$2; shift 2
  runb "$name" "$in" 2 "${RX[@]}" -recon_out "$TMP/$name.recon.tsv" -digest_out "$TMP/$name.digest.tsv" \
    -label_out "$TMP/$name.label.tsv" -massgap_out "$TMP/$name.massgap.tsv" -census -census_out "$TMP/$name.census.tsv" "$@"
}
REPORTS=(recon.tsv digest.tsv label.tsv massgap.tsv census.tsv census_summary.tsv)

# ---- the option off: 1.12's auto ----
sruns h_by "$TMP/syn_split.mzML"
sruns h_auto "$TMP/syn_split.mzML" -ion_series auto
sruns h_auto_by "$TMP/syn_split.mzML" -ion_series auto -ion_series_hybrid by
same h_auto h_auto_by "-ion_series_hybrid by explicit vs absent" "${REPORTS[@]}"
cmp -s "$TMP/h_auto_by.err" "$TMP/h_auto.err" || fail "-ion_series_hybrid by explicit: stderr differs"
cmp -s "$TMP/h_by.tsv" "$TMP/h_auto.tsv" || fail "auto on the hybrid run differs from by (1.12 reads hybrid as b/y)"
for o in recon.tsv census.tsv; do cmp -s "$TMP/h_by.$o" "$TMP/h_auto.$o" || fail "auto vs by on the hybrid run: $o differs"; done
grep -q '^Hybrid activation: 40 of 40 MS2 spectra' "$TMP/h_auto.err" || fail "auto (hybrid by): no hybrid WARN"
grep -q 'two passes' "$TMP/h_auto.err" && fail "auto without -ion_series_hybrid both mentions two passes"
grep -q 'ion_series_hybrid' "$TMP/h_auto.census_summary.tsv" && fail "auto without both writes an ion_series_hybrid row"
[ "$(lastcol "$TMP/h_auto.tsv")" = ion_series ] && fail "auto without both wrote the ion_series column"

# ---- auto + -ion_series_hybrid both ----
sruns h_both "$TMP/syn_split.mzML" -ion_series auto -ion_series_hybrid both
sruns h_cz "$TMP/syn_split.mzML" -ion_series cz
[ "$(lastcol "$TMP/h_both.tsv")" = ion_series ] || fail "both: no ion_series column"
[ "$(valuesof "$TMP/h_both.tsv")" = "by cz" ] || fail "both: rows not of both series ($(valuesof "$TMP/h_both.tsv"))"
head -1 "$TMP/h_both.tsv" | cmp -s - <(head -1 "$TMP/h_by.tsv" | sed 's/$/\tion_series/') \
  || fail "both: the header is not the by header plus ion_series"
[ "$(awk -F'\t' '{ print NF }' "$TMP/h_both.tsv" | sort -u | wc -l)" -eq 1 ] || fail "both: ragged rows"
EC=$(head -1 "$TMP/h_both.tsv" | tr '\t' '\n' | grep -n '^evalue$' | cut -d: -f1)
[ -n "$EC" ] || fail "no evalue column"
awk -F'\t' -v e="$EC" 'NR > 1 { if ($1 == prev && $e + 0 < last - 1e-300) bad = 1; prev = $1; last = $e + 0 } END { exit bad }' \
  "$TMP/h_both.tsv" || fail "both: a spectrum's rows are not sorted by E-value"
grep -q '^Ion series (-ion_series auto): 0 MS2 spectra tagged as c/z-dot ions, 0 as b/y ions, 40 as b/y and c/z-dot ions (hybrid, two passes) (activation: 0 collisional, 0 electron, 40 hybrid, 0 unknown)' "$TMP/h_both.err" \
  || fail "both: INFO line: $(grep '^Ion series' "$TMP/h_both.err")"
grep -q '^Hybrid activation' "$TMP/h_both.err" && fail "both: the hybrid WARN is still printed"
grep -qE 'Ion series|two passes' "$TMP/h_both.out" && fail "a hybrid line reached stdout"
grep -E '^(Ion series|Hybrid)' "$TMP/h_both.err" | grep -qE "$GATE_RE" && fail "a hybrid line matches the gate pattern"
grep -q $'^run\tion_series_hybrid\t40\t40\t' "$TMP/h_both.census_summary.tsv" || fail "both: no ion_series_hybrid 40 of 40 run row"
grep -q $'^run\tion_series_by\t0\t40\t' "$TMP/h_both.census_summary.tsv" || fail "both: ion_series_by not 0 of 40"
[ "$(awk -F'\t' 'NR == 1 { print $NF; exit }' "$TMP/h_both.census.tsv")" = best_ion_series ] || fail "census: no best_ion_series"
[ "$(awk -F'\t' 'NR > 1 && $NF != "" { print $NF }' "$TMP/h_both.census.tsv" | sort -u | tr '\n' ' ')" = "by cz " ] \
  || fail "census: best tags not of both series"
# The b/y rows: the by run's rows with E-values doubled (rows the cut or the
# shared cap drops aside).
NC=$(awk -F'\t' 'NR == 1 { print NF }' "$TMP/h_by.tsv")
awk -F'\t' -v e="$EC" -v nc="$NC" 'FNR == 1 { next }
  NR == FNR { k = $1; for (i = 2; i <= nc; ++i) if (i != e) k = k "\t" $i; by[k] = $e + 0; next }
  $NF == "by" { k = $1; for (i = 2; i <= nc; ++i) if (i != e) k = k "\t" $i; ++n
                if (!(k in by)) { ++miss; next }
                r = ($e + 0) / by[k]; if (r < 1.999 || r > 2.001) ++bad }
  END { print n + 0, miss + 0, bad + 0 }' "$TMP/h_by.tsv" "$TMP/h_both.tsv" > "$TMP/eratio"
read -r nby nmiss nbad < "$TMP/eratio"
[ "$nby" -gt 20 ] && [ "$nmiss" -eq 0 ] && [ "$nbad" -eq 0 ] \
  || fail "both: b/y rows vs by: $nby rows, $nmiss not in by, $nbad without E x 2"
# exact placements (both flanks match) per spectrum
placed() { awk -F'\t' 'NR > 1 && $7 == "1" && $8 == "1" { print $1 }' "$1" | sort -u | wc -l | tr -d ' '; }
pb=$(placed "$TMP/h_by.recon.tsv"); pz=$(placed "$TMP/h_cz.recon.tsv"); ph=$(placed "$TMP/h_both.recon.tsv")
# Spectra whose merged rows place exactly a tag only the cz run places
# exactly AND one only the by run places (key: spectrum, tag, peptide, pos,
# reversed): the two passes' readings are both in the merged rows.
xkeys() { awk -F'\t' 'NR > 1 && $7 == "1" && $8 == "1" { print $1 "\t" $2 "\t" $4 "\t" $5 "\t" $6 }' "$1" | sort -u; }
xkeys "$TMP/h_by.recon.tsv" > "$TMP/x_by"; xkeys "$TMP/h_cz.recon.tsv" > "$TMP/x_cz"; xkeys "$TMP/h_both.recon.tsv" > "$TMP/x_both"
comm -23 "$TMP/x_cz" "$TMP/x_by" | comm -12 - "$TMP/x_both" | cut -f1 | sort -u > "$TMP/s_czonly"
comm -23 "$TMP/x_by" "$TMP/x_cz" | comm -12 - "$TMP/x_both" | cut -f1 | sort -u > "$TMP/s_byonly"
mixed=$(comm -12 "$TMP/s_czonly" "$TMP/s_byonly" | wc -l | tr -d ' ')
echo "synthetic mixed y/z: spectra with an exact placement: by $pb, cz $pz, both $ph (of 40); with a by-only and a cz-only exact placement: $mixed"
[ "$ph" -ge "$pb" ] && [ "$ph" -ge "$pz" ] || fail "both places fewer spectra ($ph) than by ($pb) or cz ($pz)"
[ "$mixed" -ge 20 ] || fail "both: only $mixed spectra place a b/y and a c/z row exactly (the two passes are not merged?)"
dcall() { awk -F'\t' '$1 == "call" && ($2 == "status" || $2 == "model") { printf "%s ", $3 }' "$1"; }
sruns c_by "$TMP/syn_cid.mzML"
dc=$(dcall "$TMP/c_by.digest.tsv"); dh=$(dcall "$TMP/h_both.digest.tsv")
echo "synthetic digest call: CID by [$dc], mixed both [$dh], mixed by [$(dcall "$TMP/h_by.digest.tsv")]"
[ "$dc" = "call Trypsin " ] && [ "$dc" = "$dh" ] || fail "the digest call from the merged rows ($dh) differs from b/y ($dc)"
sruns hf_both "$TMP/syn_splitf.mzML" -ion_series auto -ion_series_hybrid both
cmp -s "$TMP/h_both.tsv" "$TMP/hf_both.tsv" || fail "the @etd@hcd filter token is not read as hybrid"
cmp -s "$TMP/h_both.recon.tsv" "$TMP/hf_both.recon.tsv" || fail "filter run: recon differs"

# ---- no hybrid spectrum: nothing changes ----
sruns c_auto "$TMP/syn_cid.mzML" -ion_series auto
sruns c_both "$TMP/syn_cid.mzML" -ion_series auto -ion_series_hybrid both
same c_auto c_both "auto + both on CID" recon.tsv census.tsv
sruns z_auto "$TMP/syn_etd.mzML" -ion_series auto
sruns z_both "$TMP/syn_etd.mzML" -ion_series auto -ion_series_hybrid both
same z_auto z_both "auto + both on ETD" recon.tsv census.tsv
[ "$(valuesof "$TMP/z_both.tsv")" = cz ] || fail "auto + both on ETD: rows not all cz"
runb e_by "$SRC" 2
runb e_both "$SRC" 2 -ion_series auto -ion_series_hybrid both
cmp -s "$TMP/e_by.tsv" "$TMP/e_both.tsv" || fail "auto + both on the CID source: tags differ from by"
[ "$(wc -l < "$TMP/e_by.tsv")" -gt 100 ] || fail "too few tags on the source for a meaningful comparison"
if [ -n "$MGF" ]; then
  runb m_by "$MGF" 2
  runb m_both "$MGF" 2 -ion_series auto -ion_series_hybrid both
  cmp -s "$TMP/m_by.tsv" "$TMP/m_both.tsv" || fail "MGF: auto + both differs from by"
fi

# ---- warnings and refusals ----
runb h_plain "$TMP/syn_split.mzML" 2
runb h_ign "$TMP/syn_split.mzML" 2 -ion_series_hybrid both
grep -q -- '-ion_series_hybrid is only read for -ion_series auto; it is ignored here' "$TMP/h_ign.err" || fail "no ignored-option WARN"
cmp -s "$TMP/h_plain.tsv" "$TMP/h_ign.tsv" || fail "-ion_series_hybrid both under by changes the tags"
"$BIN" -in "$SRC" -out "$TMP/s.tsv" -stream -ion_series_hybrid both > "$TMP/s.out" 2>&1 && fail "-stream accepted -ion_series_hybrid"
grep -q -- '-stream cannot be combined with -ion_series_hybrid' "$TMP/s.out" || fail "-stream refusal message"

# ---- threads and the OnDisc reader ----
for t in 1 3 8; do
  runb th$t "$TMP/syn_split.mzML" $t -ion_series auto -ion_series_hybrid both "${RX[@]}" -recon_out "$TMP/th$t.recon.tsv"
done
for t in 3 8; do
  cmp -s "$TMP/th1.tsv" "$TMP/th$t.tsv" || fail "both: tags differ at $t threads"
  cmp -s "$TMP/th1.recon.tsv" "$TMP/th$t.recon.tsv" || fail "both: recon differs at $t threads"
done
runb od "$TMP/syn_split.mzML" 2 -ion_series auto -ion_series_hybrid both "${RX[@]}" -out_spectra "$TMP/od.mzML"
cmp -s "$TMP/th1.tsv" "$TMP/od.tsv" || fail "both: the OnDisc path (-out_spectra) differs from the fast reader"

# ---- -species counts b/y rows only ----
if [ -n "$BUILDTAXDB" ] && [ -n "$TAXDIR" ]; then
  mkdir -p "$TMP/prot"
  awk '/^>/ { if (s != "") print s; print; s = ""; next } { s = s $0 } END { if (s != "") print s }' "$DB" > "$TMP/prot/562.fasta"
  "$BUILDTAXDB" "$TMP/prot" "$TMP/toy.taxdb" 7 > "$TMP/buildtaxdb.log" 2>&1 || { cat "$TMP/buildtaxdb.log" >&2; fail "buildtaxdb"; }
  SP=(-tag_length 5 -extension 1 -fragment_tolerance 20 -fragment_tolerance_unit ppm -species -taxdb "$TMP/toy.taxdb"
      -taxonomy_nodes "$TAXDIR/nodes.dmp" -taxonomy_names "$TAXDIR/names.dmp")
  runb sp_both "$TMP/syn_split.mzML" 2 -ion_series auto -ion_series_hybrid both "${SP[@]}"
  ncz=$(awk -F'\t' 'NR > 1 && $NF == "cz"' "$TMP/sp_both.tsv" | wc -l | tr -d ' ')
  nby=$(awk -F'\t' 'NR > 1 && $NF == "by"' "$TMP/sp_both.tsv" | wc -l | tr -d ' ')
  [ "$ncz" -gt 0 ] && [ "$nby" -gt 0 ] || fail "species: rows of both series expected ($nby by, $ncz cz)"
  grep -q "^Ion series: $ncz tag rows read as c/z-dot ions were left out of -species" "$TMP/sp_both.err" \
    || { grep 'species' "$TMP/sp_both.err" >&2; fail "species: the exclusion count is not the c/z row count ($ncz)"; }
fi
echo "hybrid_cli_test: all checks passed"
