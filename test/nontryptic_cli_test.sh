#!/usr/bin/env bash
# 1.13 item 20: -shortlist_protease / -shortlist_specificity against the real
# binary. The non-tryptic case is fixtures/chymo_insilico.mgf (300 in-silico
# chymotryptic spectra, the protease check's chymotrypsin call) against
# fixtures/Ecoli_shortlist.fasta plus three proteins built here from the MGF's
# own peptides (CHYMO_A..C, 40 peptides each, concatenated: every peptide ends
# at a chymotrypsin site, none starts with P):
#   a. the default (trypsin) refuses -fasta_out as in 1.12, and with
#      -shortlist_force keeps none of CHYMO_A..C (their windows are not tryptic):
#      the reduced FASTA would be empty, so it is not written (exit 13, 1.14);
#   b. auto: exit 0, the call and the rule in the TSV header and the log,
#      CHYMO_A..C ranks 1-3 and kept with >= 30 spectra each, nothing else
#      kept, -fasta_out exactly the kept proteins, Sage cuts after FWYL not
#      before P; the shared outputs (-out, -recon_out) identical to the default;
#   c. chymotrypsin named, Comet merged into the fixture template: enzyme 10;
#      semi: Sage semi_enzymatic, Comet num_enzyme_termini 1;
#   d. asp-n named: refused (the call is chymotrypsin) unless -shortlist_force;
#   e. unspecific: CHYMO_A..C kept, Sage cleave_at "";
#   f. -threads 1 and 4 give the same shortlist and FASTA under auto;
#   g. the tryptic E. coli fixture (Da, inconclusive) under auto: Trypsin,
#      prsA/metK/rplF kept;
#   h. -shortlist_specificity without -shortlist_protease warns it is ignored;
#      -shortlist_gapped with a non-tryptic rule warns it is ignored;
#   i. auto with Comet when the called rule has no Comet enzyme entry: a
#      template without Chymotrypsin (the chymotryptic MGF), and no template on
#      an in-silico Asp-N MGF built here (Comet's own table has no Asp-N
#      entry). Both WARN before the run, then exit 6 (ILLEGAL_PARAMETERS) with
#      neither -fasta_out nor -search_config_out written;
#   j. Lys-C named on a run that calls Arg-C (an in-silico Arg-C MGF built
#      here): refused although both are trypsin-compatible;
#   k. -search_engine msfragger (1.13 #18): fragger.params carries the rule
#      (auto chymotrypsin; Asp-N semi with sense N; unspecific as nonspecific,
#      cut '@'); with FASTAG_MSFRAGGER_JAR MSFragger 4.4.1 runs both and
#      echoes the rules it read;
#   l. auto on the in-silico Asp-N MGF (post-1.13.1): the placement and the
#      Sage export are Asp-N semi-specific; -shortlist_specificity full given,
#      or asp-n named, keeps full specificity.
# Exits 77 (ctest SKIP) when the binary cannot start.
set -u
BIN="$1"
FIX="$2"     # test/fixtures
DATA="$3"    # data/digest
CHYMO="$FIX/chymo_insilico.mgf"
DB0="$FIX/Ecoli_shortlist.fasta"

if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi
export FASTAG_DIGEST_DIR="$DATA"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-nontryptic-cli.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
rows() { tr -d '\r' < "$1" | grep -v '^#' | tail -n +2; }

# The database: the fixture's plus three proteins from the MGF's peptides.
DB="$TMP/db.fasta"
cp "$DB0" "$DB"
sed -n 's/^TITLE=chymo_insilico\.[0-9]*\.[0-9]*\.2 //p' "$CHYMO" | tr -d '\r' > "$TMP/peps.txt"
[ "$(wc -l < "$TMP/peps.txt" | tr -d ' ')" = 300 ] || fail "expected 300 peptides in the MGF titles"
grep -q '^P' "$TMP/peps.txt" && fail "a fixture peptide starts with P (the concatenation would hide its site)"
awk 'NR <= 120 { p = int((NR - 1) / 40); s[p] = s[p] $0 }
     END { split("A B C", n, " "); for (i = 0; i < 3; ++i) printf ">CHYMO_%s synthetic chymotryptic\n%s\n", n[i + 1], s[i] }' \
  "$TMP/peps.txt" >> "$DB"

# 5-mers: the index derives a minimum placed tag length of 5 for this database.
CH=(-in "$CHYMO" -recon_fasta "$DB" -tag_length 5 -fragment_tolerance 20 -fragment_tolerance_unit ppm -threads 2)
# go NAME EXTRA...: one run in $TMP/NAME; prints the exit code
go() {
  local d="$TMP/$1"; shift
  mkdir -p "$d"
  ( cd "$d" && "$BIN" "$@" > run.log 2>&1 ); echo $?
}
NEW=(-out t.tsv -recon_out r.tsv -shortlist_out sl.tsv -fasta_out red.fasta -search_config_out sage.json)
# A forced rule that keeps no protein would leave -fasta_out empty, which is
# not written (exit 13, 1.14); the forced runs below that check the exports
# add this background.
BG=(-shortlist_background "$TMP/bg.fasta")
printf '>BG1 host protein\nMKWVTFISLLLLFSSAYSRGVFRR\n' > "$TMP/bg.fasta"

# ---- a: the default refuses; forced, the tryptic windows keep no CHYMO protein
[ "$(go def "${CH[@]}" "${NEW[@]}")" != 0 ] || fail "default: a chymotryptic run was not refused"
grep -q 'Chymotrypsin fits the tag ends best' "$TMP/def/run.log" || fail "default: no chymotrypsin call in the log"
[ ! -e "$TMP/def/red.fasta" ] || fail "default: -fasta_out written although refused"
[ "$(go deff "${CH[@]}" "${NEW[@]}" -shortlist_force)" = 13 ] || { cat "$TMP/deff/run.log" >&2; fail "default -shortlist_force: not exit 13"; }
[ ! -e "$TMP/deff/red.fasta" ] && [ ! -e "$TMP/deff/sage.json" ] || fail "default -shortlist_force: an empty -fasta_out or its configuration written"
grep -q 'the reduced database would be empty' "$TMP/deff/run.log" || fail "default -shortlist_force: no ERROR for the empty reduced database"
n=$(rows "$TMP/deff/sl.tsv" | awk -F'\t' '$2 ~ /^CHYMO_/ && $11 == 1' | wc -l | tr -d ' ')
[ "$n" = 0 ] || fail "default -shortlist_force: $n CHYMO proteins kept on tryptic windows"
grep -q '^# placement:' "$TMP/deff/sl.tsv" && fail "default: a placement header line (the 1.12 header changed)"

# ---- b: auto
[ "$(go auto "${CH[@]}" "${NEW[@]}" -shortlist_protease auto)" = 0 ] \
  || { cat "$TMP/auto/run.log" >&2; fail "auto: exit non-zero"; }
SL="$TMP/auto/sl.tsv"
grep -q '^# protease: non_tryptic Chymotrypsin' "$SL" || fail "auto: the TSV lacks the call"
grep -q '^# placement: Chymotrypsin, full specificity, missed cleavages <= 1, windows by flank mass (auto: the tag ends call Chymotrypsin)$' "$SL" \
  || { grep '^#' "$SL" >&2; fail "auto: the TSV lacks the placement line"; }
grep -q 'Shortlist placement: Chymotrypsin, full specificity' "$TMP/auto/run.log" || fail "auto: no placement line in the log"
top3=$(rows "$SL" | awk -F'\t' '$1 != "-" && $1 <= 3 { print $2 }' | sort | tr '\n' ' ')
[ "$top3" = "CHYMO_A CHYMO_B CHYMO_C " ] || fail "auto: CHYMO_A..C are not ranks 1-3 (got: $top3)"
rows "$SL" | awk -F'\t' '$2 ~ /^CHYMO_/ && ($11 != 1 || $3 < 30) { bad = 1 } END { exit bad }' \
  || { rows "$SL" | head -5 >&2; fail "auto: a CHYMO protein is not kept with >= 30 spectra"; }
other=$(rows "$SL" | awk -F'\t' '$2 !~ /^CHYMO_/ && $11 == 1' | wc -l | tr -d ' ')
[ "$other" = 0 ] || fail "auto: $other other proteins kept"
written=$(grep '^>' "$TMP/auto/red.fasta" | sed 's/^>//; s/ .*//' | sort | tr '\n' ' ')
[ "$written" = "CHYMO_A CHYMO_B CHYMO_C " ] || fail "auto: -fasta_out holds $written"
grep -q '"cleave_at": "FWYL"' "$TMP/auto/sage.json" && grep -q '"restrict": "P"' "$TMP/auto/sage.json" \
  || fail "auto: Sage is not configured for chymotrypsin"
grep -q 'semi_enzymatic' "$TMP/auto/sage.json" && fail "auto: full specificity wrote semi_enzymatic"
grep -q '"fasta": "red.fasta"' "$TMP/auto/sage.json" || fail "auto: Sage does not name the reduced FASTA"
cmp -s "$TMP/deff/t.tsv" "$TMP/auto/t.tsv" || fail "auto changed the tag TSV"
cmp -s "$TMP/deff/r.tsv" "$TMP/auto/r.tsv" || fail "auto changed -recon_out"

# ---- c: named chymotrypsin, Comet; semi
[ "$(go cm "${CH[@]}" -out t.tsv -fasta_out red.fasta -search_config_out comet.params -search_engine comet \
       -search_config_template "$FIX/comet_template.params" -shortlist_protease chymotrypsin)" = 0 ] \
  || { cat "$TMP/cm/run.log" >&2; fail "chymotrypsin/Comet: exit non-zero"; }
grep -q '^search_enzyme_number = 10' "$TMP/cm/comet.params" && grep -q '^sample_enzyme_number = 10' "$TMP/cm/comet.params" \
  || fail "Comet: the enzyme is not the template's Chymotrypsin (10)"
grep -q '^num_enzyme_termini = 2' "$TMP/cm/comet.params" || fail "Comet: full specificity is not 2 termini"
[ "$(go semi "${CH[@]}" -out t.tsv -shortlist_out sl.tsv -search_config_out sage.json -shortlist_protease chymotrypsin \
       -shortlist_specificity semi)" = 0 ] || fail "semi: exit non-zero"
grep -q '"semi_enzymatic": true' "$TMP/semi/sage.json" || fail "semi: Sage is not semi-enzymatic"
grep -q '^# placement: Chymotrypsin, semi specificity' "$TMP/semi/sl.tsv" || fail "semi: no placement line"
[ "$(go csemi "${CH[@]}" -out t.tsv -search_config_out comet.params -search_engine comet \
       -search_config_template "$FIX/comet_template.params" -shortlist_protease chymotrypsin -shortlist_specificity semi)" = 0 ] \
  || fail "semi/Comet: exit non-zero"
grep -q '^num_enzyme_termini = 1' "$TMP/csemi/comet.params" || fail "semi/Comet: num_enzyme_termini is not 1"
# Asp-N has no entry in comet -p's own table: Comet without a template is refused before tagging.
[ "$(go anc "${CH[@]}" -out t.tsv -search_config_out comet.params -search_engine comet -shortlist_protease asp-n)" != 0 ] \
  || fail "Asp-N/Comet without a template was not refused"
grep -q 'give -search_config_template with one' "$TMP/anc/run.log" || fail "Asp-N/Comet: the ERROR does not say why"
[ ! -e "$TMP/anc/t.tsv" ] || fail "Asp-N/Comet: refused after tagging, not before"

# ---- d: a named rule the call contradicts
[ "$(go an "${CH[@]}" "${NEW[@]}" -shortlist_protease asp-n)" != 0 ] || fail "asp-n on a chymotryptic run was not refused"
grep -q 'but the tag ends call Chymotrypsin' "$TMP/an/run.log" || fail "asp-n: the ERROR does not name the call"
[ ! -e "$TMP/an/red.fasta" ] && [ ! -e "$TMP/an/sage.json" ] || fail "asp-n: hand-off outputs written although refused"
grep -q '^# placement: Asp-N, full specificity.*; -fasta_out or -search_config_out withheld$' "$TMP/an/sl.tsv" \
  || fail "asp-n: the TSV does not say what was withheld"
# only -fasta_out asked: the header names only it
[ "$(go anq "${CH[@]}" -out t.tsv -shortlist_out sl.tsv -fasta_out red.fasta -shortlist_protease asp-n)" != 0 ] \
  || fail "asp-n with -fasta_out alone was not refused"
grep -q '; -fasta_out withheld$' "$TMP/anq/sl.tsv" || fail "asp-n: the header does not name exactly -fasta_out"
[ "$(go anf "${CH[@]}" "${NEW[@]}" -shortlist_protease asp-n -shortlist_force "${BG[@]}")" = 0 ] || fail "asp-n -shortlist_force: exit non-zero"
grep -q '"cleave_at": "D"' "$TMP/anf/sage.json" && grep -q '"c_terminal": false' "$TMP/anf/sage.json" \
  || fail "asp-n forced: Sage is not Asp-N"
# the rule filters: few chymotryptic windows start and end before a D
n=$(rows "$TMP/anf/sl.tsv" | awk -F'\t' '$2 ~ /^CHYMO_/ { n += $3 } END { print n + 0 }')
[ "$n" -lt 40 ] || fail "asp-n forced: $n CHYMO spectra kept by the Asp-N rule (auto: 120)"

# ---- e: unspecific
[ "$(go un "${CH[@]}" "${NEW[@]}" -shortlist_protease unspecific)" = 0 ] || fail "unspecific: exit non-zero"
top3=$(rows "$TMP/un/sl.tsv" | awk -F'\t' '$1 != "-" && $1 <= 3 { print $2 }' | sort | tr '\n' ' ')
[ "$top3" = "CHYMO_A CHYMO_B CHYMO_C " ] || fail "unspecific: CHYMO_A..C are not ranks 1-3 (got: $top3)"
grep -q '"cleave_at": "",' "$TMP/un/sage.json" && grep -q '"restrict": null' "$TMP/un/sage.json" \
  || fail "unspecific: Sage is not non-specific"
grep -q '^# placement: unspecific, none specificity, no missed-cleavage limit' "$TMP/un/sl.tsv" || fail "unspecific: header"

# ---- f: threads
[ "$(go t1 "${CH[@]}" -out t.tsv -shortlist_out sl.tsv -fasta_out red.fasta -shortlist_protease auto -threads 1)" = 0 ] || fail "t1"
[ "$(go t4 "${CH[@]}" -out t.tsv -shortlist_out sl.tsv -fasta_out red.fasta -shortlist_protease auto -threads 4)" = 0 ] || fail "t4"
cmp -s "$TMP/t1/sl.tsv" "$TMP/t4/sl.tsv" && cmp -s "$TMP/t1/red.fasta" "$TMP/t4/red.fasta" \
  || fail "-threads 1 and 4 differ under auto"
rows "$TMP/t1/sl.tsv" > "$TMP/t1.rows"; rows "$SL" > "$TMP/auto.rows"
cmp -s "$TMP/t1.rows" "$TMP/auto.rows" || fail "-threads 1 and 2 differ under auto"

# ---- g: a tryptic Da run under auto
EC=(-in "$FIX/Ecoli_MS2_small.mzML" -recon_fasta "$DB0" -tag_length 4 -extension 1 -fragment_tolerance 0.5
    -fragment_tolerance_unit Da -threads 2)
[ "$(go ec "${EC[@]}" -out t.tsv -shortlist_out sl.tsv -fasta_out red.fasta -shortlist_protease auto)" = 0 ] \
  || { cat "$TMP/ec/run.log" >&2; fail "E. coli auto: exit non-zero"; }
grep -q '^# placement: Trypsin, full specificity.*no confident protease call; Trypsin assumed' "$TMP/ec/sl.tsv" \
  || { grep '^#' "$TMP/ec/sl.tsv" >&2; fail "E. coli auto: not Trypsin by default"; }
kept=$(rows "$TMP/ec/sl.tsv" | awk -F'\t' '$11 == 1 { print $2 }' | sort | tr '\n' ' ')
[ "$kept" = "VIMSS15329 VIMSS17021 VIMSS17368 " ] || fail "E. coli auto: kept $kept"

# ---- h: ignored options
[ "$(go ig "${EC[@]}" -out t.tsv -shortlist_out sl.tsv -shortlist_specificity semi)" = 0 ] || fail "ignored: exit non-zero"
grep -q -- '-shortlist_specificity is only read for -shortlist_protease other than trypsin' "$TMP/ig/run.log" \
  || fail "no WARN for -shortlist_specificity without a rule"
[ "$(go ig2 "${EC[@]}" -out t.tsv -shortlist_protease auto)" = 0 ] || fail "ignored 2: exit non-zero"
grep -q -- '-shortlist_protease is only read for' "$TMP/ig2/run.log" || fail "no WARN for -shortlist_protease without a hand-off output"
[ "$(go ig3 "${CH[@]}" -out t.tsv -shortlist_out sl.tsv -shortlist_protease auto -shortlist_gapped)" = 0 ] || fail "ignored 3"
grep -q -- '-shortlist_gapped is ignored with -shortlist_protease auto' "$TMP/ig3/run.log" || fail "no WARN for -shortlist_gapped"

# ---- i: auto + Comet, the called rule without a Comet enzyme entry
grep -v '^10\.  *Chymotrypsin' "$FIX/comet_template.params" > "$TMP/nochymo.params"
grep -q 'Chymotrypsin' "$TMP/nochymo.params" && fail "the template still has a Chymotrypsin entry"
rc=$(go anoc "${CH[@]}" -out t.tsv -shortlist_out sl.tsv -fasta_out red.fasta -search_config_out comet.params \
       -search_engine comet -search_config_template "$TMP/nochymo.params" -shortlist_protease auto)
[ "$rc" = 6 ] || { cat "$TMP/anoc/run.log" >&2; fail "auto/Comet, template without the call: exit $rc, want 6"; }
grep -q 'shortlist_protease auto with Comet: the -search_config_template has no entry for .*Chymotrypsin' "$TMP/anoc/run.log" \
  || fail "auto/Comet template: no WARN before the run"
grep -q 'no Chymotrypsin entry.*Neither -fasta_out nor -search_config_out written' "$TMP/anoc/run.log" \
  || { cat "$TMP/anoc/run.log" >&2; fail "auto/Comet template: the ERROR does not name the rule"; }
[ ! -e "$TMP/anoc/red.fasta" ] && [ ! -e "$TMP/anoc/comet.params" ] || fail "auto/Comet template: a hand-off output written"
grep -q 'Failed writing' "$TMP/anoc/run.log" && fail "auto/Comet template: reported as an I/O error"

# mkmgf PROTEASE OUT: in-silico MGF (as make_shortlist_fixtures.py: charge 2,
# b2..b(n-1), y1..y(n-1)) of the PROTEASE peptides (aspn: before D; argc: after
# R, not before P) of the fixture database's target proteins, 7-20 residues, no C.
mkmgf() {
  awk -v mode="$1" '
    BEGIN {
      split("G 57.02146372 A 71.03711379 S 87.03202841 P 97.05276385 V 99.06841391 T 101.04767847 L 113.08406398 I 113.08406398 N 114.04292744 D 115.02694303 Q 128.05857751 K 128.09496302 E 129.04259309 M 131.04048491 H 137.05891186 F 147.06841391 R 156.10111103 Y 163.06332853 W 186.07931295", a, " ")
      for (i = 1; i < 38; i += 2) M[a[i]] = a[i + 1]
      PR = 1.00727646688; WA = 18.0105646837; n = 0
    }
    function emit(p,   i, k, m, ok, b, y, ions, t, c, j, tmp) {
      if (length(p) < 7 || length(p) > 20 || (p in seen)) return
      for (i = 1; i <= length(p); ++i) if (!(substr(p, i, 1) in M)) return
      seen[p] = 1; ++n
      m = 0; for (i = 1; i <= length(p); ++i) { r[i] = M[substr(p, i, 1)]; m += r[i] }
      c = 0; b = 0
      for (i = 1; i < length(p); ++i) { b += r[i]; if (i >= 2) ions[++c] = b + PR }
      y = 0
      for (i = length(p); i > 1; --i) { y += r[i]; ions[++c] = y + WA + PR }
      for (i = 2; i <= c; ++i) { t = ions[i]; for (j = i - 1; j >= 1 && ions[j] > t; --j) ions[j + 1] = ions[j]; ions[j + 1] = t }
      printf "BEGIN IONS\nTITLE=%s_insilico.%d.%d.2 %s\nRTINSECONDS=%.1f\nPEPMASS=%.6f\nCHARGE=2+\n", mode, n, n, p, 10 + n, (m + WA + 2 * PR) / 2
      for (k = 1; k <= c; ++k) printf "%.6f %d.5\n", ions[k], 1000 + ((k - 1) * 379) % 9000
      printf "END IONS\n"
    }
    function digest(s,   i, st, ch) {
      st = 1
      for (i = 1; i <= length(s); ++i) {
        ch = substr(s, i, 1)
        if (mode == "aspn" && ch == "D" && i > 1) { emit(substr(s, st, i - st)); st = i }
        if (mode == "argc" && ch == "R" && substr(s, i + 1, 1) != "P") { emit(substr(s, st, i - st + 1)); st = i + 1 }
      }
      emit(substr(s, st))
    }
    /^>/ { if (seq != "" && keep) digest(seq); seq = ""; keep = ($0 !~ /^>(DECOY_|rev_)/); next }
    { seq = seq $0 }
    END { if (seq != "" && keep) digest(seq) }' "$DB0" | tr -d '\r' > "$2"
}
mkmgf aspn "$TMP/aspn.mgf"
mkmgf argc "$TMP/argc.mgf"
[ "$(grep -c '^BEGIN IONS' "$TMP/aspn.mgf")" -ge 100 ] || fail "fewer than 100 Asp-N spectra"
[ "$(grep -c '^BEGIN IONS' "$TMP/argc.mgf")" -ge 100 ] || fail "fewer than 100 Arg-C spectra"
AN=(-in "$TMP/aspn.mgf" -recon_fasta "$DB0" -tag_length 5 -fragment_tolerance 20 -fragment_tolerance_unit ppm -threads 2)
rc=$(go anod "${AN[@]}" -out t.tsv -shortlist_out sl.tsv -fasta_out red.fasta -search_config_out comet.params \
       -search_engine comet -shortlist_protease auto)
grep -q '^# placement: Asp-N' "$TMP/anod/sl.tsv" \
  || { grep '^#' "$TMP/anod/sl.tsv" >&2; fail "Asp-N MGF: auto did not call Asp-N (the case does not test the default table)"; }
[ "$rc" = 6 ] || { cat "$TMP/anod/run.log" >&2; fail "auto/Comet without a template on an Asp-N call: exit $rc, want 6"; }
grep -q "shortlist_protease auto with Comet: Comet's default enzyme table has no entry for Asp-N" "$TMP/anod/run.log" \
  || fail "auto/Comet default: no WARN before the run"
grep -q "default enzyme table has no Asp-N entry.*Neither -fasta_out nor -search_config_out written" "$TMP/anod/run.log" \
  || { cat "$TMP/anod/run.log" >&2; fail "auto/Comet default: the ERROR does not name the rule"; }
[ ! -e "$TMP/anod/red.fasta" ] && [ ! -e "$TMP/anod/comet.params" ] || fail "auto/Comet default: a hand-off output written"
grep -q 'Failed writing' "$TMP/anod/run.log" && fail "auto/Comet default: reported as an I/O error"
# the same run with Sage is written (the error is Comet's table, not the run)
[ "$(go anos "${AN[@]}" -out t.tsv -fasta_out red.fasta -search_config_out sage.json -shortlist_protease auto)" = 0 ] \
  || { cat "$TMP/anos/run.log" >&2; fail "Asp-N MGF auto/Sage: exit non-zero"; }
grep -q '"cleave_at": "D"' "$TMP/anos/sage.json" && [ -s "$TMP/anos/red.fasta" ] || fail "Asp-N MGF auto/Sage: not Asp-N"

# ---- j: Lys-C named on an Arg-C call
AR=(-in "$TMP/argc.mgf" -recon_fasta "$DB0" -tag_length 5 -fragment_tolerance 20 -fragment_tolerance_unit ppm -threads 2)
[ "$(go arc "${AR[@]}" -out t.tsv -shortlist_out sl.tsv -fasta_out red.fasta -shortlist_protease auto)" = 0 ] \
  || { cat "$TMP/arc/run.log" >&2; fail "Arg-C MGF auto: exit non-zero"; }
grep -q '^# placement: Arg-C' "$TMP/arc/sl.tsv" \
  || { grep '^#' "$TMP/arc/sl.tsv" >&2; fail "Arg-C MGF: auto did not call Arg-C"; }
[ "$(go arl "${AR[@]}" -out t.tsv -shortlist_out sl.tsv -fasta_out red.fasta -shortlist_protease lys-c)" != 0 ] \
  || fail "lys-c on an Arg-C call was not refused"
grep -q 'but the tag ends call Arg-C' "$TMP/arl/run.log" || fail "lys-c on Arg-C: the ERROR does not name the call"
[ ! -e "$TMP/arl/red.fasta" ] || fail "lys-c on Arg-C: -fasta_out written although refused"
[ "$(go arlf "${AR[@]}" -out t.tsv -fasta_out red.fasta -shortlist_protease lys-c -shortlist_force "${BG[@]}")" = 0 ] \
  || fail "lys-c on Arg-C -shortlist_force: exit non-zero"

# ---- l: auto on the Asp-N MGF exports Asp-N semi-specific (post-1.13.1);
# -shortlist_specificity given, or asp-n named, keeps full specificity.
ANS=(-out t.tsv -shortlist_out sl.tsv -fasta_out red.fasta -search_config_out sage.json)
[ "$(go ans "${AN[@]}" "${ANS[@]}" -shortlist_protease auto)" = 0 ] || { cat "$TMP/ans/run.log" >&2; fail "auto on Asp-N: exit non-zero"; }
grep -q '^# placement: Asp-N, semi specificity, .*(auto: the tag ends call Asp-N; semi-specific unless -shortlist_specificity is given)$' "$TMP/ans/sl.tsv" \
  || { grep '^#' "$TMP/ans/sl.tsv" >&2; fail "auto on Asp-N: the placement is not Asp-N, semi specificity"; }
grep -q '"cleave_at": *"D"' "$TMP/ans/sage.json" && grep -q '"semi_enzymatic": *true' "$TMP/ans/sage.json" \
  || { cat "$TMP/ans/sage.json" >&2; fail "auto on Asp-N: the Sage export is not Asp-N semi_enzymatic"; }
[ "$(go anfu "${AN[@]}" "${ANS[@]}" -shortlist_protease auto -shortlist_specificity full)" = 0 ] || fail "auto full on Asp-N: exit non-zero"
grep -q '^# placement: Asp-N, full specificity' "$TMP/anfu/sl.tsv" || fail "auto on Asp-N: a given -shortlist_specificity full was not kept"
grep -q 'semi_enzymatic' "$TMP/anfu/sage.json" && fail "auto full on Asp-N: wrote semi_enzymatic"
[ "$(go annm "${AN[@]}" "${ANS[@]}" -shortlist_protease asp-n)" = 0 ] || fail "asp-n named on Asp-N: exit non-zero"
grep -q '^# placement: Asp-N, full specificity' "$TMP/annm/sl.tsv" || fail "a named asp-n is not full specificity"
grep -q 'semi_enzymatic' "$TMP/annm/sage.json" && fail "a named asp-n wrote semi_enzymatic"

# ---- k: MSFragger (1.13 #18) gets the placement rule
[ "$(go mf "${CH[@]}" -out t.tsv -fasta_out red.fasta -search_config_out fragger.params -search_engine msfragger \
       -shortlist_protease auto)" = 0 ] || { cat "$TMP/mf/run.log" >&2; fail "auto/MSFragger: exit non-zero"; }
for kv in 'search_enzyme_name_1 = chymotrypsin' 'search_enzyme_cut_1 = FWYL' 'search_enzyme_nocut_1 = P' \
          'search_enzyme_sense_1 = C' 'num_enzyme_termini = 2'; do
  grep -qx "$kv" "$TMP/mf/fragger.params" || fail "auto/MSFragger: no '$kv'"
done
grep -q '^>rev_CHYMO_A ' "$TMP/mf/red.fasta" || fail "auto/MSFragger: -fasta_out lacks the reversed decoys"
[ "$(go mfn "${CH[@]}" -out t.tsv -fasta_out red.fasta -search_config_out fragger.params -search_engine msfragger \
       -shortlist_protease asp-n -shortlist_force -shortlist_specificity semi "${BG[@]}")" = 0 ] || fail "asp-n semi/MSFragger: exit non-zero"
for kv in 'search_enzyme_name_1 = asp-n' 'search_enzyme_cut_1 = D' 'search_enzyme_nocut_1 =' \
          'search_enzyme_sense_1 = N' 'num_enzyme_termini = 1'; do
  grep -Eqx "$kv ?" "$TMP/mfn/fragger.params" || fail "asp-n semi/MSFragger: no '$kv'"
done
[ "$(go mfu "${CH[@]}" -out t.tsv -fasta_out red.fasta -search_config_out fragger.params -search_engine msfragger \
       -shortlist_protease unspecific)" = 0 ] || fail "unspecific/MSFragger: exit non-zero"
grep -qx 'search_enzyme_name_1 = nonspecific' "$TMP/mfu/fragger.params" && grep -qx 'search_enzyme_cut_1 = @' "$TMP/mfu/fragger.params" \
  && grep -qx 'num_enzyme_termini = 0' "$TMP/mfu/fragger.params" || fail "unspecific/MSFragger: not nonspecific"
# With FASTAG_MSFRAGGER_JAR: MSFragger 4.4.1 reads the rules as written.
if [ -n "${FASTAG_MSFRAGGER_JAR:-}" ]; then
  for d in mf mfu; do
    cp "$CHYMO" "$TMP/$d/run.mgf"
    ( cd "$TMP/$d" && "${FASTAG_JAVA:-java}" -Xmx"${FASTAG_MSFRAGGER_XMX:-8g}" -jar "$FASTAG_MSFRAGGER_JAR" \
        fragger.params run.mgf > fragger.log 2>&1 ) || { tail -20 "$TMP/$d/fragger.log" >&2; fail "$d: MSFragger exited non-zero"; }
  done
  grep -qx 'search_enzyme_name = chymotrypsin' "$TMP/mf/fragger.log" && grep -qx 'search_enzyme_cut_1 = FWYL' "$TMP/mf/fragger.log" \
    || fail "MSFragger did not read the chymotrypsin rule"
  grep -qx 'search_enzyme_name = nonspecific' "$TMP/mfu/fragger.log" && grep -qx 'num_enzyme_termini = 0' "$TMP/mfu/fragger.log" \
    && grep -qx 'allowed_missed_cleavage_1 = 1' "$TMP/mfu/fragger.log" || fail "MSFragger did not read the nonspecific rule"
fi

echo "nontryptic_cli_test: all checks passed"
