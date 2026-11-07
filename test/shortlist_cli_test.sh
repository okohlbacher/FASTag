#!/usr/bin/env bash
# -shortlist_out, -fasta_out and -search_config_out (#5) against the real
# binary, on Ecoli_MS2_small.mzML and fixtures/Ecoli_shortlist.fasta (3 E. coli
# proteins, 30 foreign ones, 3 DECOY_ and 1 rev_ entries):
#   a. prsA, metK and rplF rank 1-3 and are kept; no foreign protein reaches
#      -shortlist_min_spectra; no decoy is kept or written to -fasta_out;
#   b. -fasta_out holds exactly the kept proteins, verbatim but rewrapped,
#      then the background, without its decoys and without duplicates; a
#      background duplicate of a protein the shortlist left out is written once;
#   c. every shared output (-out, -recon_out, -delta_out, -massgap_out,
#      -recon_id_out as idXML and mzid) is identical with and without the new
#      options; with FASTAG_BASELINE_BIN also identical to the 1.11.0 binary;
#   d. the options at their defaults equal no options;
#   e. -threads 1, 4 and 8 give the same shortlist, FASTA and configuration;
#   f. without -recon_out the shortlist is written and no placement TSV;
#   g. the Sage configuration names the reduced FASTA and the run's
#      tolerances and mods; the Comet one merges into a template;
#   h. the protease check: an in-silico chymotryptic run refuses the FASTA and
#      the configuration (shortlist written, non-zero exit) unless
#      -shortlist_force; with -shortlist_out alone nothing is withheld (WARN,
#      exit 0); a Da run is inconclusive and proceeds.
# Exits 77 (ctest SKIP) when the binary cannot start.
set -u
BIN="$1"
FIX="$2"     # test/fixtures
DATA="$3"    # data/digest
SRC=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
IN="$FIX/Ecoli_MS2_small.mzML"
DB="$FIX/Ecoli_shortlist.fasta"
CHYMO="$FIX/chymo_insilico.mgf"

if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi
export FASTAG_DIGEST_DIR="$DATA"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-shortlist-cli.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
PY="${FASTAG_PYTHON:-python3}"
"$PY" -c 'import sys; sys.exit(sys.version_info < (3, 9))' 2>/dev/null || PY=""
# canon FILE: the file with dates and random XML ids masked (tools/baseline_canon.py)
canon() { "$PY" "$SRC/tools/baseline_canon.py" "$1" "$2"; }
VERSION=$("$BIN" --help 2>&1 | sed -n 's/^Version: \([^ ]*\).*/\1/p' | head -1)

# The fixture's MS2 is ion trap.
ARGS=(-in "$IN" -recon_fasta "$DB" -tag_length 4 -extension 1 -fragment_tolerance 0.5
      -fragment_tolerance_unit Da)
# run DIR BIN EXTRA...: one run in DIR, relative output names
run() {
  local d=$1 bin=$2; shift 2
  mkdir -p "$d"
  ( cd "$d" && "$bin" "${ARGS[@]}" "$@" > run.log 2>&1 ) || { cat "$d/run.log" >&2; fail "$(basename "$d"): exit non-zero"; }
}
# col TSV NAME: column NAME of the shortlist, data rows only (no '#' lines)
rows() { tr -d '\r' < "$1" | grep -v '^#' | tail -n +2; }
SHARED=(-out t.tsv -recon_out r.tsv -delta_out d.tsv -massgap_out m.tsv)
NEW=(-shortlist_out sl.tsv -fasta_out red.fasta -search_config_out sage.json)

# ---- a/b: ranking, decoys, the reduced FASTA
run "$TMP/b" "$BIN" "${SHARED[@]}" -recon_id_out ids.idXML "${NEW[@]}" -threads 2
SL="$TMP/b/sl.tsv"
head -1 "$SL" | grep -q 'NOT FDR-controlled' || fail "shortlist header does not say NOT FDR-controlled"
grep -q '^# protease: inconclusive' "$SL" || fail "a Da run's protease check is not inconclusive"
grep -q 'protease check inconclusive' "$TMP/b/run.log" || fail "no inconclusive protease WARN in the log"
top3=$(rows "$SL" | awk -F'\t' '$1 != "-" && $1 <= 3 { print $2 }' | awk '{ print $1 }' | sort | tr '\n' ' ')
[ "$top3" = "VIMSS15329 VIMSS17021 VIMSS17368 " ] || fail "prsA/metK/rplF are not ranks 1-3 (got: $top3)"
rows "$SL" | awk -F'\t' '$1 != "-" && $1 <= 3 && $11 != 1 { bad = 1 } END { exit bad }' || fail "a top-3 protein is not kept"
min_spectra=2
foreign=$(rows "$SL" | awk -F'\t' -v m=$min_spectra '$2 !~ /^VIMSS/ && $12 != "decoy" && $3 >= m' | wc -l | tr -d ' ')
[ "$foreign" = 0 ] || fail "$foreign foreign proteins reach -shortlist_min_spectra"
rows "$SL" | awk -F'\t' '$2 ~ /^(DECOY_|rev_)/ && ($11 != 0 || $12 != "decoy") { bad = 1 } END { exit bad }' \
  || fail "a decoy is kept or not marked decoy"
rows "$SL" | awk -F'\t' 'NF != 12 { bad = 1 } END { exit bad }' || fail "a shortlist row without 12 fields"
grep -E '^>(DECOY_|rev_)' "$TMP/b/red.fasta" && fail "a decoy in -fasta_out"
kept=$(rows "$SL" | awk -F'\t' '$11 == 1 && $12 == "selected" { print $2 }' | sort)
written=$(grep '^>' "$TMP/b/red.fasta" | sed 's/^>//; s/ .*//' | sort)
[ "$kept" = "$written" ] || fail "-fasta_out does not hold exactly the kept proteins"
# verbatim but rewrapped: each written entry's sequence equals the database's
seqs() { awk '/^>/ { if (id) print id "\t" s; id = substr($1, 2); s = ""; next } { s = s $0 } END { if (id) print id "\t" s }' "$1" | sort; }
seqs "$DB" > "$TMP/db.seqs"
seqs "$TMP/b/red.fasta" > "$TMP/red.seqs"
join -t "$(printf '\t')" "$TMP/red.seqs" "$TMP/db.seqs" | awk -F'\t' '$2 != $3 { bad = 1 } END { exit bad }' \
  || fail "a -fasta_out sequence differs from the database's"
[ "$(wc -l < "$TMP/red.seqs")" = "$(join -t "$(printf '\t')" "$TMP/red.seqs" "$TMP/db.seqs" | wc -l)" ] \
  || fail "-fasta_out holds an entry the database does not"
grep -q 'Shortlist: 3 of' "$TMP/b/run.log" || fail "the log does not report 3 kept proteins"
# background: decoys and database duplicates left out
{ printf '>BG1 host protein\nMKWVTFISLLLLFSSAYSRGVFRR\n'; printf '>DECOY_BG2\nRRFVGRSYASSFLLLLSIFTVWKM\n'
  awk '/^>VIMSS15329/ { p = 1; print; next } /^>/ { p = 0 } p' "$DB"; } > "$TMP/bg.fasta"
run "$TMP/bg" "$BIN" -out t.tsv -shortlist_out sl.tsv -fasta_out red.fasta -shortlist_background "$TMP/bg.fasta" -threads 2
[ "$(grep -c '^>' "$TMP/bg/red.fasta")" = 4 ] || fail "background: expected 3 kept + 1 background entry"
tail -2 "$TMP/bg/red.fasta" | head -1 | grep -q '^>BG1 host protein$' || fail "background entry not last, or rewritten"
grep -q 'DECOY_BG2' "$TMP/bg/red.fasta" && fail "a background decoy was written"
[ "$(grep -c '^>VIMSS15329' "$TMP/bg/red.fasta")" = 1 ] || fail "a background duplicate of a kept protein was written twice"
rows "$TMP/bg/sl.tsv" | grep -q $'\tBG1\t.*\tbackground$' || fail "no background row in the shortlist"
# background: a duplicate of a database protein the shortlist did not keep
# (a foreign one, below -shortlist_min_spectra) is still written, exactly once
twin=$(grep '^>' "$DB" | sed 's/^>//; s/ .*//' | grep -v -E '^(VIMSS|DECOY_|rev_)' | head -1)
[ -n "$twin" ] || fail "no foreign protein in the fixture database"
rows "$TMP/b/sl.tsv" | awk -F'\t' -v t="$twin" '$2 == t && $11 == 1 { bad = 1 } END { exit bad }' \
  || fail "$twin is kept without the background (the case needs a protein that is not)"
awk -v t=">$twin" '$1 == t { p = 1; print; next } /^>/ { p = 0 } p' "$DB" > "$TMP/bgtwin.fasta"
run "$TMP/bgt" "$BIN" -out t.tsv -shortlist_out sl.tsv -fasta_out red.fasta -shortlist_background "$TMP/bgtwin.fasta" -threads 2
[ "$(awk -v t=">$twin" '$1 == t { n++ } END { print n + 0 }' "$TMP/bgt/red.fasta")" = 1 ] \
  || fail "a background duplicate of a database protein below min_spectra is not in -fasta_out exactly once"
[ "$(grep -c '^>' "$TMP/bgt/red.fasta")" = 4 ] || fail "background twin: expected 3 kept + the twin"
rows "$TMP/bgt/sl.tsv" | awk -F'\t' -v t="$twin" '$2 == t && $11 == 1 && $12 == "background" { ok = 1 } END { exit !ok }' \
  || fail "the background twin's shortlist row is not kept 1, reason background"
grep -q '1 database entries kept as background' "$TMP/bgt/sl.tsv" || fail "the shortlist header does not count the twin"

# ---- c: shared outputs identical with and without the new options
run "$TMP/a" "$BIN" "${SHARED[@]}" -recon_id_out ids.idXML -threads 2
for f in t.tsv r.tsv d.tsv m.tsv; do
  cmp -s "$TMP/a/$f" "$TMP/b/$f" || fail "$f differs with the #5 options"
done
if [ -n "$PY" ]; then
  [ "$(canon "$TMP/a/ids.idXML" "$VERSION")" = "$(canon "$TMP/b/ids.idXML" "$VERSION")" ] || fail "idXML differs with the #5 options"
  run "$TMP/az" "$BIN" "${SHARED[@]}" -recon_id_out ids.mzid -threads 2
  run "$TMP/bz" "$BIN" "${SHARED[@]}" -recon_id_out ids.mzid "${NEW[@]}" -threads 2
  [ "$(canon "$TMP/az/ids.mzid" "$VERSION")" = "$(canon "$TMP/bz/ids.mzid" "$VERSION")" ] || fail "mzid differs with the #5 options"
else
  echo "NOTE: no Python >= 3.9; idXML/mzid A/B compare skipped (FASTAG_PYTHON)" >&2
fi
if [ -n "${FASTAG_BASELINE_BIN:-}" ]; then
  [ -n "$PY" ] || fail "FASTAG_BASELINE_BIN set but no Python >= 3.9 for the masked compare"
  BV=$("$FASTAG_BASELINE_BIN" --help 2>&1 | sed -n 's/^Version: \([^ ]*\).*/\1/p' | head -1)
  run "$TMP/base" "$FASTAG_BASELINE_BIN" "${SHARED[@]}" -recon_id_out ids.idXML -threads 2
  run "$TMP/basez" "$FASTAG_BASELINE_BIN" "${SHARED[@]}" -recon_id_out ids.mzid -threads 2
  for f in t.tsv r.tsv d.tsv m.tsv ids.idXML; do
    [ "$(canon "$TMP/base/$f" "$BV")" = "$(canon "$TMP/b/$f" "$VERSION")" ] || fail "$f differs from the baseline binary"
  done
  [ "$(canon "$TMP/basez/ids.mzid" "$BV")" = "$(canon "$TMP/bz/ids.mzid" "$VERSION")" ] || fail "mzid differs from the baseline binary"
elif [ "${FASTAG_BASELINE_REQUIRED:-0}" = 1 ]; then
  fail "FASTAG_BASELINE_REQUIRED=1 but FASTAG_BASELINE_BIN is not set"
else
  echo "NOTE: FASTAG_BASELINE_BIN not set; baseline compare skipped" >&2
fi

# ---- d: every #5 option at its default equals no option
run "$TMP/dflt" "$BIN" "${SHARED[@]}" -threads 2 -shortlist_max_evalue 0.1 -shortlist_min_spectra 2 \
  -shortlist_parsimony none -shortlist_top 0 -search_engine sage -search_precursor_tolerance 10 \
  -search_precursor_unit ppm -search_isotope_errors 0 -search_decoy_prefix ""
for f in t.tsv r.tsv d.tsv m.tsv; do
  cmp -s "$TMP/a/$f" "$TMP/dflt/$f" || fail "$f: #5 options at their defaults differ from none"
done
grep -qi 'ignored' "$TMP/dflt/run.log" && fail "options at their defaults draw an ignored-option warning"
# ... and a non-default one without its output is warned about
run "$TMP/ign" "$BIN" -out t.tsv -shortlist_top 5 -search_engine comet -threads 2
grep -q -- '-shortlist_top is only read for' "$TMP/ign/run.log" || fail "no warning for an ignored -shortlist_top"
grep -q -- '-search_engine is only read for' "$TMP/ign/run.log" || fail "no warning for an ignored -search_engine"
cmp -s "$TMP/a/t.tsv" "$TMP/ign/t.tsv" || fail "ignored #5 options changed the tag TSV"

# ---- e: threads
for n in 1 4 8; do
  run "$TMP/t$n" "$BIN" -out t.tsv "${NEW[@]}" -threads $n
done
for n in 4 8; do
  for f in sl.tsv red.fasta sage.json; do
    cmp -s "$TMP/t1/$f" "$TMP/t$n/$f" || fail "$f differs between 1 and $n threads"
  done
done
cmp -s "$TMP/t1/sl.tsv" "$TMP/b/sl.tsv" || fail "the shortlist depends on -recon_out"

# ---- f: no -recon_out: shortlist written, no placement TSV
[ -s "$TMP/t1/sl.tsv" ] && [ ! -e "$TMP/t1/r.tsv" ] || fail "without -recon_out: no shortlist, or a placement TSV"
ls "$TMP/t1" | grep -q '\.part$' && fail "a .part file was left behind"

# ---- g: engine configurations
S="$TMP/b/sage.json"
grep -q '"fasta": "red.fasta"' "$S" || fail "the Sage configuration does not name -fasta_out"
grep -q '"da": \[-0.5, 0.5\]' "$S" || fail "the Sage fragment tolerance is not the run's 0.5 Da"
grep -q '"ppm": \[-10, 10\]' "$S" || fail "the Sage precursor tolerance is not the default 10 ppm"
grep -q '"C": 57.021464' "$S" || fail "the Sage configuration lacks the fixed Carbamidomethyl (C)"
grep -q '"generate_decoys": true' "$S" && grep -q '"decoy_tag": "rev_"' "$S" || fail "Sage decoys not generated with rev_"
grep -q "\"mzml_paths\": \[\"$IN\"\]" "$S" || fail "the Sage configuration does not name the run"
if [ -n "$PY" ]; then "$PY" -c 'import json,sys; json.load(open(sys.argv[1]))' "$S" || fail "the Sage configuration is not JSON"; fi
run "$TMP/c1" "$BIN" -out t.tsv -fasta_out red.fasta -search_config_out comet.params -search_engine comet \
  -search_config_template "$FIX/comet_template.params" -search_precursor_tolerance 0.02 \
  -search_precursor_unit Da -search_isotope_errors 2 -variable_modifications 'Oxidation (M)' -threads 2
C="$TMP/c1/comet.params"
head -1 "$C" | grep -q '^# comet_version' || fail "the Comet version header is not first"
grep -q '^database_name = red.fasta' "$C" || fail "Comet database_name is not -fasta_out"
grep -q '^peptide_mass_units = 0' "$C" && grep -q '^peptide_mass_tolerance_upper = 0.02' "$C" || fail "Comet precursor tolerance"
grep -q '^isotope_error = 2' "$C" || fail "Comet isotope_error"
grep -q '^fragment_bin_tol = 1.0005' "$C" && grep -q '^fragment_bin_offset = 0.4' "$C" || fail "Comet ion-trap bins"
grep -q '^variable_mod01 = 15.994915 M 0 3 -1 0 0 0.0' "$C" || fail "Comet Oxidation (M)"
grep -q '^add_Nterm_peptide = 0.0' "$C" && grep -q '^add_K_lysine = 0.0' "$C" || fail "the template's TMT survived"
grep -q '^search_enzyme_number = 1' "$C" || fail "Comet enzyme is not trypsin"
grep -q 'search_enzyme_number 3 is not trypsin' "$TMP/c1/run.log" || fail "no warning for the template's Lys_C"
[ "$(grep -n '^\[COMET_ENZYME_INFO\]' "$C" | cut -d: -f1)" -gt "$(grep -n '^allowed_missed_cleavage' "$C" | cut -d: -f1)" ] \
  || fail "a Comet key after [COMET_ENZYME_INFO]"
run "$TMP/c2" "$BIN" -out t.tsv -search_config_out comet.params -search_engine comet -threads 2
grep -q '^# A FRAGMENT' "$C" && fail "a merged template calls itself a fragment"
grep -q '^# A FRAGMENT' "$TMP/c2/comet.params" || fail "the Comet fragment does not say it is one"
grep -q "^database_name = $DB" "$TMP/c2/comet.params" || fail "without -fasta_out the configuration does not name the input database"
grep -q 'holds 4 decoys' "$TMP/c2/run.log" || fail "no warning that the configured database holds decoys"

# ---- h: protease check
CH=(-in "$CHYMO" -recon_fasta "$DB" -fragment_tolerance 20 -fragment_tolerance_unit ppm -threads 2)
( cd "$TMP" && "$BIN" "${CH[@]}" -out ch.tsv -shortlist_out ch.sl.tsv -fasta_out ch.fasta -search_config_out ch.json \
    > ch.log 2>&1 ); rc=$?
[ $rc != 0 ] || fail "a chymotryptic run wrote the hand-off outputs (exit 0)"
grep -q 'Chymotrypsin fits the tag ends best' "$TMP/ch.log" || { cat "$TMP/ch.log" >&2; fail "no chymotrypsin protease ERROR"; }
[ -s "$TMP/ch.sl.tsv" ] && grep -q '^# protease: non_tryptic Chymotrypsin' "$TMP/ch.sl.tsv" \
  || fail "the refused run's shortlist is missing or does not carry the call"
[ ! -e "$TMP/ch.fasta" ] && [ ! -e "$TMP/ch.json" ] || fail "a refused run wrote -fasta_out or -search_config_out"
[ -s "$TMP/ch.tsv" ] || fail "a refused run lost its tag TSV"
( cd "$TMP" && "$BIN" "${CH[@]}" -out chf.tsv -shortlist_out chf.sl.tsv -fasta_out chf.fasta -search_config_out chf.json \
    -shortlist_force > chf.log 2>&1 ) || { cat "$TMP/chf.log" >&2; fail "-shortlist_force did not exit 0"; }
[ -e "$TMP/chf.fasta" ] && [ -s "$TMP/chf.json" ] || fail "-shortlist_force did not write the hand-off outputs"
grep -q 'shortlist_force writes the hand-off outputs anyway' "$TMP/chf.log" || fail "no WARN under -shortlist_force"
cmp -s "$TMP/ch.tsv" "$TMP/chf.tsv" || fail "the protease check changed the tag TSV"
# nothing withheld: a shortlist-only run gets its TSV with the call, a WARN and exit 0
( cd "$TMP" && "$BIN" "${CH[@]}" -out cho.tsv -shortlist_out cho.sl.tsv > cho.log 2>&1 ) \
  || { cat "$TMP/cho.log" >&2; fail "a non-tryptic shortlist-only run did not exit 0"; }
grep -q '^# protease: non_tryptic Chymotrypsin' "$TMP/cho.sl.tsv" || fail "the shortlist-only run's TSV lacks the call"
grep -q 'the call is in its header' "$TMP/cho.log" || fail "no protease WARN in a shortlist-only run"
grep -q 'Not writing' "$TMP/cho.log" && fail "a shortlist-only run names outputs it was not asked for"
# only -fasta_out asked: refused, and the ERROR names only -fasta_out
( cd "$TMP" && "$BIN" "${CH[@]}" -out chq.tsv -shortlist_out chq.sl.tsv -fasta_out chq.fasta > chq.log 2>&1 ); rc=$?
[ $rc != 0 ] && [ ! -e "$TMP/chq.fasta" ] || fail "a non-tryptic run with -fasta_out was not refused"
grep -q 'Not writing -fasta_out (' "$TMP/chq.log" || { cat "$TMP/chq.log" >&2; fail "the ERROR does not name exactly -fasta_out"; }

echo "shortlist_cli_test: all checks passed"
