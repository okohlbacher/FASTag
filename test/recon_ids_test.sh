#!/usr/bin/env bash
# -recon_id_out against the real binary, in all three formats:
#   a. what the identification files hold is what -recon_out holds: the mzTab
#      PSMs are the -recon_out rows (spectrum, peptide, protein) as a multiset,
#      the mzid and idXML have one identification per placing spectrum, one
#      evidence per row and the same peptides, and the mzid and idXML carry the
#      same number of hits;
#   b. the three runs write the same -recon_out and tags, byte for byte;
#   c. no placements give an empty (0-byte) mzid that replaces an earlier one;
#   d. with FASTAG_BASELINE_BIN (the 1.11.0 binary, 78390cd), every file of a
#      and c equals the baseline's after date/version masking
#      (tools/baseline_canon.py). Without it, d is reported as skipped.
# Exits 77 (ctest SKIP) when the binary cannot start.
set -u
BIN="$1"
IN="$2"
DB="$3"  # proteins that tags from $IN place in
SRC=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi

TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-recon-ids-test.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
ARGS=(-in "$IN" -out t.tsv -recon_out r.tsv
      -extension 1 -fragment_tolerance 0.3 -fragment_tolerance_unit Da -threads 2)
# run BIN DIR ID_FILE EXTRA...: one run in DIR with relative output names
run() {
  local bin=$1 d=$2 ids=$3; shift 3
  mkdir -p "$d"
  ( cd "$d" && "$bin" "${ARGS[@]}" -recon_id_out "$ids" "$@" > run.log 2>&1 ) \
    || fail "$(basename "$d") run exited non-zero ($(tail -1 "$d/run.log"))"
}
# col FILE NAME PREFIX: the index of column NAME in the header line starting with PREFIX
col() { awk -F'\t' -v n="$2" -v h="$3" '$1 == h { for (i = 1; i <= NF; ++i) if ($i == n) { print i; exit } }' "$1"; }

# ---- a/b: one placing run per format
for f in mzid idXML mzTab; do run "$BIN" "$TMP/c/$f" "ids.$f" -fasta "$DB"; done
R="$TMP/c/mzid/r.tsv"
tr -d '\r' < "$R" > "$TMP/r.lf"
rows=$(($(wc -l < "$TMP/r.lf") - 1))
[ "$rows" -gt 1 ] || fail "nothing placed; the check would prove nothing"
for f in idXML mzTab; do
  cmp -s "$R" "$TMP/c/$f/r.tsv" || fail "-recon_out differs between the mzid and the $f run"
  cmp -s "$TMP/c/mzid/t.tsv" "$TMP/c/$f/t.tsv" || fail "the tag TSV differs between the mzid and the $f run"
done
spectra=$(awk -F'\t' 'NR > 1 { print $1 }' "$TMP/r.lf" | sort -u | wc -l | tr -d ' ')
awk -F'\t' 'NR > 1 { print $1 "\t" $4 "\t" $3 }' "$TMP/r.lf" | LC_ALL=C sort > "$TMP/recon.rows"
awk -F'\t' 'NR > 1 { print $4 }' "$TMP/r.lf" | LC_ALL=C sort -u > "$TMP/recon.peptides"

# mzTab: one PSM row per -recon_out row
M="$TMP/c/mzTab/ids.mzTab"
tr -d '\r' < "$M" > "$TMP/m.lf"
cs=$(col "$TMP/m.lf" sequence PSH) ca=$(col "$TMP/m.lf" accession PSH) cr=$(col "$TMP/m.lf" spectra_ref PSH)
[ -n "$cs" ] && [ -n "$ca" ] && [ -n "$cr" ] || fail "mzTab: no PSH sequence/accession/spectra_ref columns"
awk -F'\t' -v s="$cs" -v a="$ca" -v r="$cr" '$1 == "PSM" { ref = $r; sub(/^ms_run\[[0-9]+\]:/, "", ref); print ref "\t" $s "\t" $a }' \
  "$TMP/m.lf" | LC_ALL=C sort > "$TMP/mztab.rows"
cmp -s "$TMP/recon.rows" "$TMP/mztab.rows" || { diff "$TMP/recon.rows" "$TMP/mztab.rows" | head -6 >&2
  fail "mzTab PSMs (spectrum, peptide, protein) are not the -recon_out rows"; }

# mzid: per placing spectrum one result, per row one evidence reference, the same peptides
Z="$TMP/c/mzid/ids.mzid"
n_sir=$(grep -c '<SpectrumIdentificationResult ' "$Z")
n_ref=$(grep -c '<PeptideEvidenceRef ' "$Z")
n_sii=$(grep -c '<SpectrumIdentificationItem ' "$Z")
[ "$n_sir" = "$spectra" ] || fail "mzid: $n_sir SpectrumIdentificationResults for $spectra placing spectra"
[ "$n_ref" = "$rows" ] || fail "mzid: $n_ref PeptideEvidenceRefs for $rows -recon_out rows"
sed -n 's:.*<PeptideSequence>\([A-Z]*\)</PeptideSequence>.*:\1:p' "$Z" | LC_ALL=C sort -u > "$TMP/mzid.peptides"
cmp -s "$TMP/recon.peptides" "$TMP/mzid.peptides" || fail "mzid peptides are not the -recon_out peptides"

# idXML: the same spectra and hits
X="$TMP/c/idXML/ids.idXML"
n_pid=$(grep -c '<PeptideIdentification ' "$X")
n_hit=$(grep -c '<PeptideHit ' "$X")
[ "$n_pid" = "$spectra" ] || fail "idXML: $n_pid PeptideIdentifications for $spectra placing spectra"
[ "$n_hit" = "$n_sii" ] || fail "idXML has $n_hit hits, the mzid $n_sii"
sed -n 's:.*<PeptideHit .*sequence="\([A-Z]*\)".*:\1:p' "$X" | LC_ALL=C sort -u > "$TMP/idxml.peptides"
cmp -s "$TMP/recon.peptides" "$TMP/idxml.peptides" || fail "idXML peptides are not the -recon_out peptides"

# ---- c: a database no tag occurs in, and an earlier result at the output path.
printf '>none\n%s\n' "$(printf 'W%.0s' {1..40})" > "$TMP/none.fasta"
mkdir -p "$TMP/c/empty"; echo "OLD RESULTS" > "$TMP/c/empty/ids.mzid"
run "$BIN" "$TMP/c/empty" ids.mzid -recon_fasta "$TMP/none.fasta"
[ "$(wc -l < "$TMP/c/empty/r.tsv")" -eq 1 ] || fail "the W-only database placed tags; the check would prove nothing"
[ -f "$TMP/c/empty/ids.mzid" ] && [ ! -s "$TMP/c/empty/ids.mzid" ] || fail "no placements: the mzid must exist and be empty"

# ---- d: the same runs with the baseline binary
BASE=${FASTAG_BASELINE_BIN:-}
PY=""
for c in python3 python; do command -v "$c" >/dev/null 2>&1 && { PY="$c"; break; }; done
if [ -z "$BASE" ] || [ -z "$PY" ] || ! "$BASE" --help >/dev/null 2>&1; then
  [ "${FASTAG_BASELINE_REQUIRED:-0}" = 1 ] && fail "FASTAG_BASELINE_REQUIRED=1 but no usable FASTAG_BASELINE_BIN or python3"
  echo "PASS (baseline comparison skipped: set FASTAG_BASELINE_BIN to the 1.11.0 binary)"
  exit 0
fi
ver() { "$1" --help 2>&1 | tr -d '\r' | sed -n 's/^Version: \([^ ]*\).*/\1/p' | head -1; }
oms() { "$1" --help 2>&1 | tr -d '\r' | sed -n 's/^Version: [^ ]* (OpenMS \([^)]*\)).*/\1/p' | head -1; }
CV=$(ver "$BIN") CO=$(oms "$BIN") BV=$(ver "$BASE") BO=$(oms "$BASE")
for f in mzid idXML mzTab; do run "$BASE" "$TMP/b/$f" "ids.$f" -fasta "$DB"; done
mkdir -p "$TMP/b/empty"; echo "OLD RESULTS" > "$TMP/b/empty/ids.mzid"
run "$BASE" "$TMP/b/empty" ids.mzid -recon_fasta "$TMP/none.fasta"
n=0
for d in mzid idXML mzTab empty; do
  for f in "$TMP/b/$d"/*; do
    g=$(basename "$f"); [ "$g" = run.log ] && continue
    [ -f "$TMP/c/$d/$g" ] || fail "$d: the baseline wrote $g, this build did not"
    "$PY" "$SRC/tools/baseline_canon.py" "$TMP/c/$d/$g" "$CV" "$CO" > "$TMP/cand.canon" || fail "canon $d/$g"
    "$PY" "$SRC/tools/baseline_canon.py" "$f" "$BV" "$BO" > "$TMP/base.canon" || fail "canon baseline $d/$g"
    cmp -s "$TMP/cand.canon" "$TMP/base.canon" || { diff "$TMP/base.canon" "$TMP/cand.canon" | head -8 >&2
      fail "$d/$g differs from the baseline ($BASE)"; }
    n=$((n + 1))
  done
done
echo "PASS ($n files equal to the baseline $BASE)"
