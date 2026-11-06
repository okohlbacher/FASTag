#!/usr/bin/env bash
# Thread-count determinism on the mzML path, for the tag TSV AND every
# secondary output: the vendored fixture at -threads 1, 3 and 8 must write
# byte-identical files. (fastag_test 5 repeats one spectrum in one thread;
# mzpeak_roundtrip compares thread counts on mzPeak input only.)
# Exits 77 (ctest SKIP) when the binary cannot start.
set -u
BIN="$1"
IN="$2"
DB="$3"
DATA="$4"   # data/digest
if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi
export FASTAG_DIGEST_DIR="$DATA"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-threads-test.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

OUTS=(tags recon delta digest label massgap glyco)
for t in 1 3 8; do
  d="$TMP/t$t"; mkdir -p "$d"
  "$BIN" -in "$IN" -out "$d/tags.tsv" -threads "$t" \
    -tag_length 4 -extension 1 -fragment_tolerance 0.3 -fragment_tolerance_unit Da \
    -fasta "$DB" -recon_out "$d/recon.tsv" -delta_out "$d/delta.tsv" \
    -digest_out "$d/digest.tsv" -label_out "$d/label.tsv" -massgap_out "$d/massgap.tsv" \
    -glyco -glyco_out "$d/glyco.tsv" -recon_id_out "$d/ids.idXML" \
    >"$d/log" 2>&1 || { cat "$d/log" >&2; fail "-threads $t run failed"; }
done
for f in "${OUTS[@]}"; do
  [ "$(wc -l < "$TMP/t1/$f.tsv")" -gt 1 ] || fail "$f.tsv has no rows at -threads 1; the check would prove nothing"
  for t in 3 8; do
    cmp -s "$TMP/t1/$f.tsv" "$TMP/t$t/$f.tsv" || fail "$f.tsv differs between -threads 1 and $t"
  done
done
# idXML carries a creation date; compare it without that line.
for t in 3 8; do
  cmp -s <(grep -v 'date=' "$TMP/t1/ids.idXML") <(grep -v 'date=' "$TMP/t$t/ids.idXML") \
    || fail "ids.idXML differs between -threads 1 and $t"
done
# -census (1.12 #11): the census table and summary, with -recon_out so that
# placed spectra occur, and with -tag_lengths 3 5 so that the best tag is not
# always row 1; the tags equal the run without -census at every count.
for t in 1 3 8; do
  d="$TMP/c$t"; mkdir -p "$d"
  "$BIN" -in "$IN" -out "$d/tags.tsv" -threads "$t" -tag_lengths 3 5 \
    -fragment_tolerance 0.3 -fragment_tolerance_unit Da -recon_fasta "$DB" -recon_out "$d/recon.tsv" \
    -census -census_out "$d/census.tsv" -census_summary_out "$d/census_summary.tsv" \
    >"$d/log" 2>&1 || { cat "$d/log" >&2; fail "-census -threads $t run failed"; }
  "$BIN" -in "$IN" -out "$d/plain.tsv" -threads "$t" -tag_lengths 3 5 \
    -fragment_tolerance 0.3 -fragment_tolerance_unit Da >"$d/plog" 2>&1 || fail "-threads $t plain run failed"
  cmp -s "$d/tags.tsv" "$d/plain.tsv" || fail "the tags differ with -census at -threads $t"
done
[ "$(awk -F'\t' 'NR > 1 && $12 == "placed"' "$TMP/c1/census.tsv" | wc -l)" -gt 0 ] || fail "no placed census row; the check is weak"
for f in census census_summary recon; do
  for t in 3 8; do
    cmp -s "$TMP/c1/$f.tsv" "$TMP/c$t/$f.tsv" || fail "$f.tsv differs between -threads 1 and $t"
  done
done
echo "threads_test: all checks passed (${#OUTS[@]} TSVs and the idXML identical at 1, 3 and 8 threads; census too)"
