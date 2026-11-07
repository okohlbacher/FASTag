#!/usr/bin/env bash
# The 1.12 #6 precursor-hypothesis options against the real binary, on the
# vendored MGF with its CHARGE lines stripped at run time (139 spectra: 97 2+,
# 33 3+, 9 4+):
#   - the options at their defaults equal the options absent (tags, recon,
#     delta, digest, label, massgap and the -out_spectra mzML), and the
#     option-absent run equals a stored FASTag 1.11.0 digest of every output
#     (with FASTAG_BASELINE_BIN also the binary itself); no new column, no
#     default listed in the -out_spectra provenance;
#   - -unknown_charge infer calls the original charge on >= 80% of the
#     spectra (census charge_used), adds the four hypothesis columns, and
#     writes the hypothesis rows of run report format 5 (4 = #6, 5 = #15B);
#   - a header charge is never replaced, and on the fully charged input
#     -digest_out is identical under assume2 and infer;
#   - enumerate and infer write the same bytes at 1, 3 and 8 threads;
#   - species: a toy taxon whose k-mers only losing hypotheses read is never
#     reported, under -species_evidence best and all, while a toy taxon read
#     by selected rows is (the construct is not vacuous);
#   - every hypothesis lies in the candidates: possible charges {3,4} on
#     every spectrum, and -charge_min/-charge_max 4..4 and 3..4, under infer
#     and enumerate (TSV prec_charge and census charge_used);
#   - refusals: -charge_min above -charge_max, -isotope_error outside -1..3,
#     -isotope_error 1 at a 0.5 Da fragment tolerance, the options in -stream.
# Exits 77 (ctest SKIP) when the binary cannot start.
set -u
BIN="$1"
BUILDTAXDB="$2"
MGF="$3"      # test/fixtures/Ecoli_MS2_small.mgf
DB="$4"       # test/fixtures/Ecoli_MS2_small.fasta
DATA="$5"     # data/digest
TAXDIR="$6"   # data/taxonomy

if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi
export FASTAG_DIGEST_DIR="$DATA"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-charge-cli.XXXXXX") || exit 1
[ "${FASTAG_TEST_KEEP:-0}" = 1 ] && echo "work directory kept: $TMP" || trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
# The reports name -fasta as given (run background fasta:<path>): run from
# the work directory with a relative database path, so the stored digests
# below do not depend on where the source tree lives.
cp "$DB" "$TMP/db.fasta" || exit 1
cd "$TMP" || exit 1
DB=db.fasta
sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
mzml_masked() { tr -d '\r' < "$1" | sed -E 's/completionTime="[^"]*"//; s/<fileChecksum>[^<]*</<fileChecksum></'; }

tr -d '\r' < "$MGF" | grep -v '^CHARGE=' > "$TMP/noz.mgf"
tr -d '\r' < "$MGF" | sed -n 's/^CHARGE=\([0-9]*\)+$/\1/p' > "$TMP/truth.txt"
[ "$(grep -c 'BEGIN IONS' "$TMP/noz.mgf")" = 139 ] && [ "$(wc -l < "$TMP/truth.txt" | tr -d ' ')" = 139 ] \
  || fail "the fixture is not the 139-spectrum MGF this test expects"
grep -q '^CHARGE=' "$TMP/noz.mgf" && fail "CHARGE lines survived the strip"

# All outputs at once: every report that reads the tags.
COMMON=(-tag_length 4 -extension 1 -fragment_tolerance 0.3 -fragment_tolerance_unit Da -fasta "$DB")
OUTS=(tsv recon.tsv delta.tsv digest.tsv label.tsv massgap.tsv)
full() {  # dir input args...
  local d=$1 in=$2; shift 2; mkdir -p "$d"
  "$BIN" -in "$in" -out "$d/t.tsv" "${COMMON[@]}" -recon_out "$d/t.recon.tsv" -delta_out "$d/t.delta.tsv" \
    -digest_out "$d/t.digest.tsv" -label_out "$d/t.label.tsv" -massgap_out "$d/t.massgap.tsv" "$@" \
    > "$d/log" 2>&1 || { cat "$d/log" >&2; fail "run $d failed"; }
}

# ---- defaults: absent == spelled out == FASTag 1.11.0 ----------------------
full "$TMP/absent" "$TMP/noz.mgf" -threads 2
full "$TMP/spelled" "$TMP/noz.mgf" -threads 2 -unknown_charge assume2 -charge_min 2 -charge_max 4 \
  -charge_infer_margin 2 -isotope_error 0
for x in "${OUTS[@]}"; do
  cmp -s "$TMP/absent/t.$x" "$TMP/spelled/t.$x" || fail "the #6 options at their defaults changed t.$x"
done
[ "$(head -1 "$TMP/absent/t.tsv" | awk -F'\t' '{ print NF }')" = 12 ] || fail "the default TSV gained columns"
# The stored FASTag 1.11.0 (78390cd) outputs of exactly this run (node data,
# 2026-11-07); -label_out gained the appended label_call rows of 1.12 #3a, so
# the 1.11 rows are compared as a prefix.
want() {
  case $1 in
    tsv) echo cd817b1edd24f3e8fa8f63c4b946061b78afd6fd22750ecd88369803755b24ed ;;
    recon.tsv) echo b9da0d0ed5762ac4fa11e7a69e8bd7864e43a64d3795da9a7b2344f422791116 ;;
    delta.tsv) echo 6a07a01bea5d1a76b1350776b88963773b4a904a81f3a060359cc78ab6e66eb6 ;;
    digest.tsv) echo a6e192b07d26f898054298c7e3ef60e179e2db76729da67700951b5d3b2d44aa ;;
    massgap.tsv) echo 837aef37bf41d6193d2d80b52dbd0273bc959fc3b90758545390abcc071f7786 ;;
    label.tsv) echo b22a2a285822ebc91dadff79b376d4736dcf0ebd660e064e040410af514a33ff ;;
  esac
}
# The reports carry the writing version in their `run version` row; that row
# is put back to the 1.11.0 one before hashing, so a version bump alone does
# not fail the identity (every other byte is still compared).
as111() { awk -F'\t' -v OFS='\t' '$1 == "run" && $2 == "version" { $3 = "1.11.0"; $5 = "FASTag 1.11.0 wrote this report." } { print }' "$1"; }
for x in "${OUTS[@]}"; do
  f="$TMP/absent/t.$x"
  as111 "$f" > "$TMP/as111.$x"; f="$TMP/as111.$x"
  if [ "$x" = label.tsv ]; then head -n 26 "$f" > "$TMP/label26"; f="$TMP/label26"; fi
  [ "$(sha "$f")" = "$(want "$x")" ] || fail "t.$x at defaults differs from the stored FASTag 1.11.0 digest"
done
[ "$(wc -l < "$TMP/absent/t.tsv")" -gt 20 ] && [ "$(wc -l < "$TMP/absent/t.digest.tsv")" -gt 20 ] \
  || fail "too few rows at defaults; the identity proves nothing"
if [ -n "${FASTAG_BASELINE_BIN:-}" ]; then
  mkdir -p "$TMP/base"
  "$FASTAG_BASELINE_BIN" -in "$TMP/noz.mgf" -out "$TMP/base/t.tsv" "${COMMON[@]}" -recon_out "$TMP/base/t.recon.tsv" \
    -delta_out "$TMP/base/t.delta.tsv" -digest_out "$TMP/base/t.digest.tsv" -label_out "$TMP/base/t.label.tsv" \
    -massgap_out "$TMP/base/t.massgap.tsv" -threads 2 > "$TMP/base/log" 2>&1 \
    || { cat "$TMP/base/log" >&2; fail "the baseline binary failed"; }
  for x in tsv recon.tsv delta.tsv digest.tsv massgap.tsv; do
    as111 "$TMP/base/t.$x" | cmp -s "$TMP/as111.$x" - || fail "t.$x at defaults differs from $FASTAG_BASELINE_BIN"
  done
  n=$(wc -l < "$TMP/base/t.label.tsv")
  head -n "$n" "$TMP/as111.label.tsv" | cmp -s - <(as111 "$TMP/base/t.label.tsv") \
    || fail "the 1.11 label rows are not a prefix of t.label.tsv"
  echo "charge_cli_test: defaults equal $FASTAG_BASELINE_BIN"
elif [ "${FASTAG_BASELINE_REQUIRED:-0}" = 1 ]; then
  fail "FASTAG_BASELINE_REQUIRED=1 but FASTAG_BASELINE_BIN is not set"
fi
# -out_spectra: the defaults spelled out keep the 1.11 parameter list.
mkdir -p "$TMP/oa" "$TMP/oe"
( cd "$TMP/oa" && "$BIN" -in "$TMP/noz.mgf" -out t.tsv -out_spectra s.mzML -threads 2 > log 2>&1 ) \
  || { cat "$TMP/oa/log" >&2; fail "-out_spectra at defaults failed"; }
( cd "$TMP/oe" && "$BIN" -in "$TMP/noz.mgf" -out t.tsv -out_spectra s.mzML -threads 2 -unknown_charge assume2 \
    -charge_min 2 -charge_max 4 -charge_infer_margin 2 -isotope_error 0 > log 2>&1 ) \
  || { cat "$TMP/oe/log" >&2; fail "-out_spectra with the defaults spelled out failed"; }
cmp -s <(mzml_masked "$TMP/oa/s.mzML") <(mzml_masked "$TMP/oe/s.mzML") \
  || fail "the #6 options at their defaults changed the -out_spectra mzML"
grep -Eq 'parameter: (unknown_charge|charge_min|charge_max|charge_infer_margin|isotope_error)' "$TMP/oa/s.mzML" \
  && fail "a default #6 option is listed in -out_spectra"

# ---- infer: the charge call ------------------------------------------------
# A low-resolution fixture: the complement window follows its fragment
# accuracy (0.3 Da), not the 0.02 Da high-resolution default.
"$BIN" -in "$TMP/noz.mgf" -out "$TMP/inf.tsv" -unknown_charge infer -complement_tolerance 0.3 -census -threads 2 \
  > "$TMP/inf.log" 2>&1 || { cat "$TMP/inf.log" >&2; fail "-unknown_charge infer failed"; }
[ "$(head -1 "$TMP/inf.tsv" | cut -f13-)" = "$(printf 'prec_charge\tcharge_src\tiso_offset\tselected')" ] \
  || fail "infer: the hypothesis columns are missing: $(head -1 "$TMP/inf.tsv")"
awk -F'\t' 'NR > 1 { print $6 }' "$TMP/inf.census.tsv" > "$TMP/used.txt"
[ "$(wc -l < "$TMP/used.txt" | tr -d ' ')" = 139 ] || fail "infer: the census does not have 139 rows"
ok=$(paste "$TMP/truth.txt" "$TMP/used.txt" | awk '$1 == $2' | wc -l | tr -d ' ')
echo "charge_cli_test: infer called $ok of 139 charges right"
[ "$ok" -ge 112 ] || fail "infer called only $ok of 139 charges right (need >= 80%, 112)"
three=$(paste "$TMP/truth.txt" "$TMP/used.txt" | awk '$1 >= 3 && $2 >= 3' | wc -l | tr -d ' ')
[ "$three" -ge 20 ] || fail "infer called only $three of the 42 3+/4+ precursors 3 or higher"
# Every row's prec_charge is its spectrum's hypothesis; selected rows carry the census charge.
awk -F'\t' 'NR == FNR { if (FNR > 1) used[$2] = $6; next }
            FNR > 1 && $16 == 1 && $13 != used[$1] { bad++ } END { exit bad > 0 }' \
  "$TMP/inf.census.tsv" "$TMP/inf.tsv" || fail "infer: a selected row's prec_charge is not the census charge_used"
for k in run_report_version unknown_charge charge_inferred charge_ambiguous charge_assumed multi_hypothesis; do
  grep -q "^run	$k	" "$TMP/inf.census_summary.tsv" || fail "infer: no run row $k in the census summary"
done
grep -q "^run	run_report_version	5	" "$TMP/inf.census_summary.tsv" || fail "infer: run report format is not 5"
grep -q "^run	unknown_charge	infer	" "$TMP/inf.census_summary.tsv" || fail "infer: unknown_charge row is not infer"
grep -q "under -unknown_charge infer" "$TMP/inf.log" || fail "infer: no -unknown_charge summary warning"

# ---- candidates: no hypothesis outside the charge range or the listed charges
# Under enumerate and infer every row's prec_charge, and the census
# charge_used, lies in -charge_min..-charge_max, or in the possible charges
# when the precursor lists any (here every spectrum: "CHARGE=3+ and 4+").
tr -d '\r' < "$MGF" | sed -E 's/^CHARGE=.*/CHARGE=3+ and 4+/' > "$TMP/p34.mgf"
[ "$(grep -c '^CHARGE=3+ and 4+$' "$TMP/p34.mgf")" = 139 ] || fail "the possible-charge MGF lacks 139 CHARGE lines"
cand_check() {  # label tsv census allowed-regex
  local n
  n=$(awk -F'\t' 'NR > 1' "$2" | wc -l | tr -d ' ')
  [ "$n" -gt 20 ] || fail "$1: only $n rows; the candidate check is vacuous"
  awk -F'\t' -v re="$4" 'NR > 1 && $13 !~ re { bad++ } END { exit bad > 0 }' "$2" \
    || fail "$1: a row's prec_charge lies outside the candidates ($(awk -F'\t' 'NR > 1 { print $13 }' "$2" | sort | uniq -c | tr '\n' ' '))"
  awk -F'\t' -v re="$4" 'NR > 1 && $6 !~ re { bad++ } END { exit bad > 0 }' "$3" \
    || fail "$1: a census charge_used lies outside the candidates"
}
for m in infer enumerate; do
  for spec in "p34.mgf::^[34]\$" "noz.mgf:-charge_min 4 -charge_max 4:^4\$" "noz.mgf:-charge_min 3 -charge_max 4:^[34]\$"; do
    in=${spec%%:*}; rest=${spec#*:}; extra=${rest%%:*}; re=${rest#*:}
    tag="cand_${m}_${in%.mgf}_$(echo "$extra" | tr -dc '0-9')"
    # shellcheck disable=SC2086
    "$BIN" -in "$TMP/$in" -out "$TMP/$tag.tsv" "${COMMON[@]}" -unknown_charge $m $extra -census -threads 2 \
      > "$TMP/$tag.log" 2>&1 || { cat "$TMP/$tag.log" >&2; fail "$tag failed"; }
    cand_check "$m on $in $extra" "$TMP/$tag.tsv" "$TMP/$tag.census.tsv" "$re"
  done
done

# ---- header charges: never replaced -----------------------------------------
full "$TMP/c_assume" "$MGF" -threads 2
full "$TMP/c_infer" "$MGF" -threads 2 -unknown_charge infer
cmp -s "$TMP/c_assume/t.digest.tsv" "$TMP/c_infer/t.digest.tsv" || fail "infer changed -digest_out on a fully charged input"
cut -f1-12 "$TMP/c_infer/t.tsv" | cmp -s - "$TMP/c_assume/t.tsv" || fail "infer changed the tags of a fully charged input"
awk -F'\t' 'NR > 1 && ($14 != "header" || $16 != 1) { bad++ } END { exit bad > 0 }' "$TMP/c_infer/t.tsv" \
  || fail "infer: a charged precursor was not tagged at its header charge alone"
tr -d '\r' < "$MGF" | awk '/^TITLE=/ { n++ } /^CHARGE=/ { sub(/^CHARGE=/, ""); sub(/\+$/, ""); print "index=" n - 1 "\t" $0 }' \
  > "$TMP/hdr.tsv"
awk -F'\t' 'NR == FNR { z[$1] = $2; next } FNR > 1 && $13 != z[$1] { bad++ } END { exit bad > 0 }' \
  "$TMP/hdr.tsv" "$TMP/c_infer/t.tsv" || fail "infer: a row's prec_charge is not its header charge"

# ---- threads ---------------------------------------------------------------
for m in enumerate infer; do
  for t in 1 3 8; do full "$TMP/th_${m}_$t" "$TMP/noz.mgf" -threads $t -unknown_charge $m; done
  [ "$(awk -F'\t' 'NR > 1 && $16 == 0' "$TMP/th_${m}_1/t.tsv" | wc -l)" -gt 0 ] || [ $m = infer ] \
    || fail "$m: no losing-hypothesis row; the thread check is weak"
  for x in "${OUTS[@]}"; do
    for t in 3 8; do
      cmp -s "$TMP/th_${m}_1/t.$x" "$TMP/th_${m}_$t/t.$x" || fail "-unknown_charge $m: t.$x differs between -threads 1 and $t"
    done
  done
done

# ---- digest and label: the selected hypothesis' rows only -------------------
# The reports count every ungapped row with E <= 1 of the selected
# hypothesis (count tags_filtered); losing rows of that kind exist, so the
# check is not vacuous.
E1=$TMP/th_enumerate_1
nsel=$(awk -F'\t' 'NR > 1 && $8 == 0 && $9 + 0 <= 1 && $16 == 1' "$E1/t.tsv" | wc -l | tr -d ' ')
nlose=$(awk -F'\t' 'NR > 1 && $8 == 0 && $9 + 0 <= 1 && $16 == 0' "$E1/t.tsv" | wc -l | tr -d ' ')
[ "$nlose" -gt 0 ] || fail "enumerate: no losing ungapped row with E <= 1; the digest check is vacuous"
for r in digest label; do
  got=$(awk -F'\t' '$1 == "count" && $2 == "tags_filtered" { print $3 }' "$E1/t.$r.tsv")
  [ "$got" = "$nsel" ] || fail "enumerate: -${r}_out counts $got tags, want the $nsel selected rows (not the $nlose losing ones)"
done
# After the D #3g merge (feat/d3cg-chemistry): -alkylation_out looks at the
# same tags as the digest report -- the selected hypothesis' ungapped rows
# with E <= 1 (PLAN-INTEGRATION 2.3 contract 1; alk_tag needs "&& sel").
# Skipped while the binary has no -alkylation_out.
HELPHELP=$("$BIN" --helphelp 2>&1)
if grep -q -- '-alkylation_out' <<< "$HELPHELP"; then
  "$BIN" -in "$TMP/noz.mgf" -out "$TMP/alk_e.tsv" "${COMMON[@]}" -unknown_charge enumerate -threads 2 \
    -alkylation_out "$TMP/alk_e.alk.tsv" -alkylation_proteome "$DB" > "$TMP/alk_e.log" 2>&1 \
    || { cat "$TMP/alk_e.log" >&2; fail "enumerate with -alkylation_out failed"; }
  cmp -s "$TMP/alk_e.tsv" "$E1/t.tsv" || fail "-alkylation_out changed the enumerate tags"
  got=$(tr -d '\r' < "$TMP/alk_e.alk.tsv" | awk -F'\t' '$1 == "alk_run" && $2 == "tags" { print $3 }')
  [ "$got" = "$nsel" ] || fail "enumerate: -alkylation_out looked at $got tags, want the $nsel selected rows (not the $nlose losing ones)"
  echo "charge_cli_test: -alkylation_out reads the selected rows only ($got)"
else
  echo "charge_cli_test: no -alkylation_out in this binary; the #3g selected-row check is skipped"
fi

# ---- species: losing hypotheses add no taxon --------------------------------
SPC=(-tag_length 7 -extension 1 -fragment_tolerance 600 -fragment_tolerance_unit ppm -max_evalue 0 -max_tags 200)
"$BIN" -in "$TMP/noz.mgf" -out "$TMP/sp0.tsv" "${SPC[@]}" -unknown_charge enumerate -threads 2 > "$TMP/sp0.log" 2>&1 \
  || { cat "$TMP/sp0.log" >&2; fail "species pre-run failed"; }
# The construct, on disjoint spectrum sets (TaxStats reports a taxon only
# from kObservedFloor = 5 spectra on, so each set needs well over 5):
#   set S (even ordinal): the spectrum's best selected ungapped tag goes into
#     the "selected_only" protein of taxon 1280;
#   set L (odd ordinal, best losing row better than every selected row): the
#     best losing ungapped tag goes into the "losing_only" protein of 4932.
# A losing row is then the best tag of its spectrum, so a run that let losing
# rows through would count those spectra for 4932 under best AND all.
flat_db() { awk '/^>/ { if (s != "") print s; s = ""; next } { s = s $0 } END { if (s != "") print s }' "$DB"; }
flat_db > "$TMP/db.seq"
not_in_db() { while read -r t; do grep -q "$t" "$TMP/db.seq" || echo "$t"; done; }
awk -F'\t' 'NR > 1 && $8 == 0 { t = $2; gsub(/\[[^]]*\]/, "", t); print t }' "$TMP/sp0.tsv" | sort -u | not_in_db \
  > "$TMP/foreign.k"
awk -F'\t' 'NR == FNR { f[$1] = 1; next }
  FNR > 1 && $8 == 0 {
    t = $2; gsub(/\[[^]]*\]/, "", t)
    if (!($1 in ord)) { ord[$1] = n++; sp[n - 1] = $1 }
    if ($16 == 1) { all_sel[t] = 1; if (!($1 in bs) || $9 + 0 < bs[$1]) { bs[$1] = $9 + 0; bst[$1] = t } }
    else if (!($1 in bl) || $9 + 0 < bl[$1]) { bl[$1] = $9 + 0; blt[$1] = t }
  }
  END {
    for (i = 0; i < n; ++i) {
      s = sp[i]
      if (i % 2 == 0 && (s in bs) && (bst[s] in f)) print "S\t" bst[s] > "/dev/stderr"
      if (i % 2 == 1 && (s in bl) && (blt[s] in f) && !(blt[s] in all_sel) && (!(s in bs) || bl[s] < bs[s]))
        print "L\t" blt[s] > "/dev/stderr"
    }
  }' "$TMP/foreign.k" "$TMP/sp0.tsv" 2> "$TMP/sets.tsv"
awk -F'\t' '$1 == "S" { print $2 }' "$TMP/sets.tsv" | sort -u > "$TMP/selonly.k"
awk -F'\t' '$1 == "L" { print $2 }' "$TMP/sets.tsv" | sort -u | comm -23 - "$TMP/selonly.k" > "$TMP/lose.k"
[ "$(wc -l < "$TMP/lose.k")" -ge 10 ] || fail "only $(wc -l < "$TMP/lose.k") losing-row spectra; the species construct is weak"
[ "$(wc -l < "$TMP/selonly.k")" -ge 10 ] || fail "only $(wc -l < "$TMP/selonly.k") selected-row spectra outside the fixture proteome"
gen() {  # seed nprot len (Park-Miller, as species_call_test.sh)
  awk -v seed="$1" -v np="$2" -v len="$3" 'BEGIN {
    a = "ACDEFGHIKLMNPQRSTVWY"; x = seed
    for (p = 1; p <= np; ++p) {
      s = ""
      for (i = 0; i < len; ++i) { x = (x * 16807) % 2147483647; s = s substr(a, int(x / 2147483647 * 20) + 1, 1) }
      print ">syn" seed "_" p; print s
    } }'
}
mkdir -p "$TMP/prot"
{ cat "$DB"; gen 11 200 300; } > "$TMP/prot/562.fasta"
{ echo ">losing_only"; tr '\n' 'G' < "$TMP/lose.k"; echo; gen 14 200 300; } > "$TMP/prot/4932.fasta"
{ echo ">selected_only"; tr '\n' 'G' < "$TMP/selonly.k"; echo; gen 13 200 300; } > "$TMP/prot/1280.fasta"
"$BUILDTAXDB" "$TMP/prot" "$TMP/toy.taxdb" 7 > "$TMP/buildtaxdb.log" 2>&1 \
  || { cat "$TMP/buildtaxdb.log" >&2; fail "buildtaxdb"; }
TAX=(-taxdb "$TMP/toy.taxdb" -taxonomy_nodes "$TAXDIR/nodes.dmp" -taxonomy_names "$TAXDIR/names.dmp")
export FASTAG_TAXONOMY_DIR="$TAXDIR"
# Spectra a taxon is reported with (column 4, observed, of the species report), 0 when absent.
spectra_of() { awk -F'\t' -v t="$2" 'NR > 1 && $2 == t { print $4; f = 1 } END { if (!f) print 0 }' "$1"; }
for ev in best all; do
  "$BIN" -in "$TMP/noz.mgf" -out "$TMP/sp_$ev.tsv" "${SPC[@]}" -unknown_charge enumerate -species "${TAX[@]}" \
    -species_evidence $ev -threads 2 > "$TMP/sp_$ev.log" 2>&1 || { cat "$TMP/sp_$ev.log" >&2; fail "species ($ev) failed"; }
  cmp -s <(cut -f1-16 "$TMP/sp0.tsv") <(cut -f1-16 "$TMP/sp_$ev.tsv") || fail "-species changed the tags ($ev)"
  R="$TMP/sp_$ev.species.tsv"
  [ -s "$R" ] || fail "no species report ($ev)"
  for t in 4932 4930; do
    [ "$(spectra_of "$R" $t)" = 0 ] || { cat "$R" >&2; fail "-species_evidence $ev: taxon $t, read only by losing hypotheses, is reported"; }
  done
  n=0; for t in 1280 1279; do n=$((n + $(spectra_of "$R" $t))); done
  [ "$n" -gt 0 ] || { cat "$R" >&2; fail "-species_evidence $ev: the selected-row taxon is not reported (construct vacuous)"; }
done
# After the E #15B merge (feat/e15b-cz-ions): with -ion_series, whose column
# follows selected, the species filter must still drop the losing rows (it
# reads a per-row flag, not a column position). Skipped while the binary has
# no -ion_series.
if grep -q -- '-ion_series' <<< "$HELPHELP"; then
  for is in auto cz; do
    "$BIN" -in "$TMP/noz.mgf" -out "$TMP/spi_$is.tsv" "${SPC[@]}" -unknown_charge enumerate -ion_series $is -species \
      "${TAX[@]}" -species_evidence all -threads 2 > "$TMP/spi_$is.log" 2>&1 \
      || { cat "$TMP/spi_$is.log" >&2; fail "species with -ion_series $is failed"; }
    R="$TMP/spi_$is.species.tsv"
    [ -s "$R" ] || fail "no species report (-ion_series $is)"
    for t in 4932 4930; do
      [ "$(spectra_of "$R" $t)" = 0 ] || { cat "$R" >&2; fail "-ion_series $is: taxon $t, read only by losing hypotheses, is reported"; }
    done
  done
  n=0; for t in 1280 1279; do n=$((n + $(spectra_of "$TMP/spi_auto.species.tsv" $t))); done
  [ "$n" -gt 0 ] || fail "-ion_series auto: the selected-row taxon is not reported (construct vacuous)"
  echo "charge_cli_test: species filter holds under -ion_series auto and cz"
else
  echo "charge_cli_test: no -ion_series in this binary; the #15B species check is skipped"
fi

# ---- refusals --------------------------------------------------------------
refused() {  # name args...
  local n=$1; shift
  "$BIN" -in "$TMP/noz.mgf" -out "$TMP/r_$n.tsv" "$@" > "$TMP/r_$n.log" 2>&1
  local rc=$?
  [ $rc = 6 ] || { cat "$TMP/r_$n.log" >&2; fail "$n: exit $rc, want 6 (ILLEGAL_PARAMETERS)"; }
  [ ! -s "$TMP/r_$n.tsv" ] || fail "$n: a refused run wrote tags"
}
refused range -unknown_charge infer -charge_min 4 -charge_max 3
refused iso_hi -isotope_error 0 4
refused iso_lo -isotope_error -2 0
refused iso_dup -isotope_error 1 1
refused iso_lowres -isotope_error 0 1 -fragment_tolerance 0.5 -fragment_tolerance_unit Da
grep -q "high-resolution" "$TMP/r_iso_lowres.log" || fail "no high-resolution message for -isotope_error at 0.5 Da"
refused cmax -charge_max 9
"$BIN" -in "$TMP/noz.mgf" -out "$TMP/r_mode.tsv" -unknown_charge guess > "$TMP/r_mode.log" 2>&1 \
  && fail "-unknown_charge guess ran"
for o in "-unknown_charge infer" "-isotope_error 0 1" "-charge_max 5"; do
  # shellcheck disable=SC2086
  "$BIN" -stream $o < /dev/null > "$TMP/stream.out" 2> "$TMP/stream.log" && fail "-stream accepted $o"
done
# -isotope_error 0 at 0.5 Da is the default and runs.
"$BIN" -in "$TMP/noz.mgf" -out "$TMP/iso0.tsv" -isotope_error 0 -fragment_tolerance 0.5 -fragment_tolerance_unit Da \
  > "$TMP/iso0.log" 2>&1 || { cat "$TMP/iso0.log" >&2; fail "-isotope_error 0 at 0.5 Da was refused"; }

echo "charge_cli_test: all checks passed"
