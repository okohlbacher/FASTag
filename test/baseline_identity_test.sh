#!/usr/bin/env bash
# Baseline identity on the vendored fixtures: every legacy output of this
# build (tags, recon, delta, digest, label, massgap, glyco, mzid, idXML, mzTab,
# -proforma/-res_conf tags, the -out_spectra mzML, species, MGF input, --help
# and the CTD) equals the baseline binary's after date/version masking
# (tools/baseline_identity.sh, tools/baseline_canon.py), and the .taxdb that
# buildtaxdb writes equals the baseline buildtaxdb's. Not covered here: the
# -out_spectra mzPeak export (gate.sh's member digests cover it).
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

# buildtaxdb itself (an installed tool on fastag_core): the .taxdb bytes of this
# build's buildtaxdb and the baseline's, at k 7 and 5. The 1.11.0 install ships
# no buildtaxdb; give one built from 78390cd as FASTAG_BASELINE_BUILDTAXDB (on
# node data /ceph/ibmi/abi/oliver/opt/fastag-1.11.0-tools/buildtaxdb). Missing:
# a note, or a failure with FASTAG_BASELINE_REQUIRED=1.
BASE_BT=${FASTAG_BASELINE_BUILDTAXDB:-$(dirname -- "$BASE")/buildtaxdb}
nbt=0
if [ -x "$BASE_BT" ]; then
  for k in 7 5; do
    c="$TMP/fixture.taxdb"
    if [ $k != 7 ]; then
      c="$TMP/fixture_k$k.taxdb"
      "$BUILDTAXDB" "$TMP/prot" "$c" $k > "$TMP/buildtaxdb_k$k.log" 2>&1 \
        || { cat "$TMP/buildtaxdb_k$k.log" >&2; fail "buildtaxdb k=$k"; }
    fi
    "$BASE_BT" "$TMP/prot" "$TMP/baseline_k$k.taxdb" $k > "$TMP/baseline_buildtaxdb_k$k.log" 2>&1 \
      || { cat "$TMP/baseline_buildtaxdb_k$k.log" >&2; fail "baseline buildtaxdb k=$k ($BASE_BT)"; }
    cmp "$c" "$TMP/baseline_k$k.taxdb" >&2 || fail "buildtaxdb k=$k: .taxdb differs from the baseline's ($BASE_BT)"
    nbt=$((nbt + 1))
  done
elif [ "${FASTAG_BASELINE_REQUIRED:-0}" = 1 ]; then
  fail "FASTAG_BASELINE_REQUIRED=1: no baseline buildtaxdb ($BASE_BT); set FASTAG_BASELINE_BUILDTAXDB"
else
  echo "NOTE: buildtaxdb not compared (no baseline buildtaxdb at $BASE_BT; set FASTAG_BASELINE_BUILDTAXDB)" >&2
fi

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
[ $rc = 0 ] || { awk -F'\t' '$5 != "status" && $5 != "SAME" && $5 !~ /^INFO/ && $5 !~ /^ADDED/ && $5 !~ /^PREFIX/' "$TMP/report.tsv" >&2
                 fail "outputs differ from the baseline"; }
n=$(awk -F'\t' '$5 == "SAME"' "$TMP/report.tsv" | wc -l | tr -d ' ')
na=$(awk -F'\t' '$5 ~ /^ADDED/' "$TMP/report.tsv" | wc -l | tr -d ' ')
npre=$(awk -F'\t' '$5 ~ /^PREFIX/' "$TMP/report.tsv" | wc -l | tr -d ' ')
echo "baseline_identity_test: all $n comparisons equal to $BASE ($na interface files only add lines; $npre label.tsv: the baseline's rows, then label_call); buildtaxdb: $nbt .taxdb files equal to $BASE_BT"
