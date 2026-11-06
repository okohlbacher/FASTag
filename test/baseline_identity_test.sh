#!/usr/bin/env bash
# Baseline identity on the vendored fixtures: every legacy output of this
# build (tags, recon, delta, digest, label, massgap, glyco, mzid, idXML, mzTab,
# -proforma/-res_conf tags, the -out_spectra mzML, species, MGF input, --help
# and the CTD) equals the baseline binary's after date/version masking
# (tools/baseline_identity.sh, tools/baseline_canon.py).
#
# The baseline is the 1.11.0 release binary (78390cd), given as
# FASTAG_BASELINE_BIN; on node data it is
# /ceph/ibmi/abi/oliver/opt/fastag-1.11.0/FASTag/FASTag.
# Exits 77 (ctest SKIP) without FASTAG_BASELINE_BIN, without python3, or when
# the binary cannot start, unless FASTAG_BASELINE_REQUIRED=1 (the gate job),
# which turns each of those into a failure.
set -u
BIN="$1"
BUILDTAXDB="$2"
IN="$3"       # test/fixtures/Ecoli_MS2_small.mzML
DB="$4"       # test/fixtures/Ecoli_MS2_small.fasta
DATA="$5"     # data/digest
TAXDIR="$6"   # data/taxonomy (nodes.dmp, names.dmp)
SRC=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

skip() {
  if [ "${FASTAG_BASELINE_REQUIRED:-0}" = 1 ]; then echo "FAIL (FASTAG_BASELINE_REQUIRED=1): $*" >&2; exit 1; fi
  echo "SKIP: $*" >&2; exit 77
}
BASE=${FASTAG_BASELINE_BIN:-}
[ -n "$BASE" ] || skip "FASTAG_BASELINE_BIN is not set (the 1.11.0 binary to compare against)"
[ -x "$BASE" ] || skip "FASTAG_BASELINE_BIN=$BASE is not executable"
PY=""
for c in python3 python; do command -v "$c" >/dev/null 2>&1 && { PY="$c"; break; }; done
[ -n "$PY" ] || skip "no python3/python for tools/baseline_canon.py"
"$BIN" --help >/dev/null 2>&1 || skip "binary cannot initialize (OpenMS share data unreachable?)"
"$BASE" --help >/dev/null 2>&1 || skip "baseline binary cannot initialize"

TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-baseline-test.XXXXXX") || exit 1
[ "${FASTAG_BASELINE_KEEP:-0}" = 1 ] && echo "work directory kept: $TMP" || trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

# A two-taxon index: the fixture proteins as E. coli (562) and the same
# proteins reversed as human (9606), both in the bundled pruned taxonomy. Built
# once by this build's buildtaxdb; both binaries read the same file.
mkdir -p "$TMP/prot"
cp "$DB" "$TMP/prot/562.fasta"
awk '/^>/ { if (s != "") print s; print $0 "_rev"; s = ""; next }
     { s = s $0 } END { if (s != "") print s }' "$DB" \
  | awk '/^>/ { print; next } { r = ""; for (i = length($0); i > 0; --i) r = r substr($0, i, 1); print r }' \
  > "$TMP/prot/9606.fasta"
"$BUILDTAXDB" "$TMP/prot" "$TMP/fixture.taxdb" 7 > "$TMP/buildtaxdb.log" 2>&1 \
  || { cat "$TMP/buildtaxdb.log" >&2; fail "buildtaxdb"; }

H="$SRC/tools/baseline_identity.sh"
export FASTAG_PYTHON="$PY"
rc=0
# The fixture's MS2 is ion trap: Da tolerance, or almost no tag passes.
bash "$H" --in "$IN" --fasta "$DB" --digest-dir "$DATA" \
  --taxdb "$TMP/fixture.taxdb" --nodes "$TAXDIR/nodes.dmp" --names "$TAXDIR/names.dmp" \
  --common "-tag_length 4 -extension 1 -fragment_tolerance 0.3 -fragment_tolerance_unit Da" \
  --species-args "-tag_length 7 -fragment_tolerance 0.5 -fragment_tolerance_unit Da" \
  --threads "1 8" "$BIN" "$BASE" "$TMP/mzml" || rc=1
# The MGF reader path (the fixture converted exactly, see fixtures/README.md).
MGF="${IN%.mzML}.mgf"
if [ -f "$MGF" ]; then
  bash "$H" --in "$MGF" --fasta "$DB" --digest-dir "$DATA" --cases "plain all_mzid spectra_mzml" \
    --common "-tag_length 4 -extension 1 -fragment_tolerance 0.3 -fragment_tolerance_unit Da" \
    --threads "1 8" "$BIN" "$BASE" "$TMP/mgf" || rc=1
fi
cat "$TMP"/*/report.tsv > "$TMP/report.tsv"
[ $rc = 0 ] || { awk -F'\t' '$5 != "status" && $5 != "SAME" && $5 !~ /^INFO/' "$TMP/report.tsv" >&2
                 fail "outputs differ from the baseline"; }
n=$(awk -F'\t' '$5 == "SAME"' "$TMP/report.tsv" | wc -l | tr -d ' ')
echo "baseline_identity_test: all $n comparisons equal to $BASE"
