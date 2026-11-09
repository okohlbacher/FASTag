#!/usr/bin/env bash
# 1.13 item 20: -shortlist_protease / -shortlist_specificity against the real
# binary. The non-tryptic case is fixtures/chymo_insilico.mgf (300 in-silico
# chymotryptic spectra, the protease check's chymotrypsin call) against
# fixtures/Ecoli_shortlist.fasta plus three proteins built here from the MGF's
# own peptides (CHYMO_A..C, 40 peptides each, concatenated: every peptide ends
# at a chymotrypsin site, none starts with P):
#   a. the default (trypsin) refuses -fasta_out as in 1.12, and with
#      -shortlist_force keeps none of CHYMO_A..C (their windows are not tryptic);
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
#      -shortlist_gapped with a non-tryptic rule warns it is ignored.
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

# ---- a: the default refuses; forced, the tryptic windows keep no CHYMO protein
[ "$(go def "${CH[@]}" "${NEW[@]}")" != 0 ] || fail "default: a chymotryptic run was not refused"
grep -q 'Chymotrypsin fits the tag ends best' "$TMP/def/run.log" || fail "default: no chymotrypsin call in the log"
[ ! -e "$TMP/def/red.fasta" ] || fail "default: -fasta_out written although refused"
[ "$(go deff "${CH[@]}" "${NEW[@]}" -shortlist_force)" = 0 ] || fail "default -shortlist_force: exit non-zero"
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
[ "$(go anf "${CH[@]}" "${NEW[@]}" -shortlist_protease asp-n -shortlist_force)" = 0 ] || fail "asp-n -shortlist_force: exit non-zero"
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

echo "nontryptic_cli_test: all checks passed"
