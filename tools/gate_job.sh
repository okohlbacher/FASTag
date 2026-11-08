#!/usr/bin/env bash
# The identity gate for byte-identical changes (the FASTag 1.12 prep items and
# every later refactor that must not change outputs), on node data. A branch
# counts as gated only when this prints GATE JOB PASS; reports quote that line.
#
#   gate_job.sh <candidate FASTag (wrapper or binary)> <outdir>
#
# Runs, and requires, all of:
#   1. gate.sh against GATE_REFS (default refs-1.10.0): "GATE PASS";
#   2. tools/baseline_identity_gate.sh against the 1.11.0 binary (78390cd),
#      including buildtaxdb: "BASELINE IDENTITY PASS";
#   3. with GATE_JOB_BUILD=<build dir>: ctest baseline_identity_test and
#      recon_ids_test with FASTAG_BASELINE_REQUIRED=1, so the fixture
#      comparison cannot skip (run it in the build environment).
#
# Environment: GATE (default /ceph/ibmi/abi/oliver/fastag-gate), GATE_REFS,
# FASTAG_BASELINE_BIN, FASTAG_CANDIDATE_BUILDTAXDB, FASTAG_BASELINE_BUILDTAXDB
# (defaults as in tools/baseline_identity_gate.sh), GATE_JOB_BUILD, and what
# gate.sh and baseline_identity_gate.sh read.
set -u
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CAND=${1:?candidate FASTag}
OUT=${2:?outdir}
GATE=${GATE:-/ceph/ibmi/abi/oliver/fastag-gate}
export GATE_REFS=${GATE_REFS:-$GATE/refs-1.10.0}
export FASTAG_BASELINE_BIN=${FASTAG_BASELINE_BIN:-/ceph/ibmi/abi/oliver/opt/fastag-1.11.0/FASTag/FASTag}
export FASTAG_BASELINE_BUILDTAXDB=${FASTAG_BASELINE_BUILDTAXDB:-/ceph/ibmi/abi/oliver/opt/fastag-1.11.0-tools/buildtaxdb}
export FASTAG_DIGEST_DIR=${FASTAG_DIGEST_DIR:-$HERE/../data/digest}
mkdir -p "$OUT" || exit 2
OUT=$(CDPATH= cd -- "$OUT" && pwd)
res=""
rm -rf "$OUT/gate"
"$GATE/gate.sh" "$CAND" "$OUT/gate" > "$OUT/gate.log" 2>&1
g=$(grep -E '^GATE (PASS|FAIL)' "$OUT/gate.log" | tail -1)
case $g in "GATE PASS"*) res="$res ok:gate" ;; *) res="$res FAIL:gate" ;; esac
echo "1. ${g:-gate.sh gave no verdict} (log $OUT/gate.log)"
rm -rf "$OUT/baseline"
bash "$HERE/baseline_identity_gate.sh" "$CAND" "$OUT/baseline" > "$OUT/baseline.log" 2>&1
b=$(grep -E '^BASELINE IDENTITY (PASS|FAIL)' "$OUT/baseline.log" | tail -1)
case $b in "BASELINE IDENTITY PASS"*) res="$res ok:baseline" ;; *) res="$res FAIL:baseline" ;; esac
echo "2. ${b:-baseline_identity_gate.sh gave no verdict} (log $OUT/baseline.log)"
if [ -n "${GATE_JOB_BUILD:-}" ]; then
  FASTAG_BASELINE_REQUIRED=1 ctest --test-dir "$GATE_JOB_BUILD" -R '^(baseline_identity_test|recon_ids_test)$' \
    --output-on-failure > "$OUT/ctest.log" 2>&1
  if [ $? = 0 ] && grep -q '100% tests passed' "$OUT/ctest.log" && ! grep -q 'Skipped' "$OUT/ctest.log"; then res="$res ok:ctest"; echo "3. ctest baseline_identity_test, recon_ids_test: passed (log $OUT/ctest.log)"
  else res="$res FAIL:ctest"; echo "3. ctest baseline_identity_test, recon_ids_test: FAILED (log $OUT/ctest.log)"; fi
else
  echo "3. ctest not run here (GATE_JOB_BUILD unset): run it with FASTAG_BASELINE_REQUIRED=1"
fi
case $res in *FAIL:*) echo "GATE JOB FAIL:$res"; exit 1 ;; esac
echo "GATE JOB PASS:$res"
