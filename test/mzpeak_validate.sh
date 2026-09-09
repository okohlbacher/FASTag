#!/usr/bin/env bash
# Every mzPeak archive FASTag wrote, through mzPeakValidator in FULL mode.
#
#   mzpeak_validate.sh <report-dir> <archive.mzpeak | directory>...
#
# A directory contributes every *.mzpeak directly inside it; a named archive
# that does not exist is a failure (a CI step asking for the bundle's archive
# must not pass because the bundle never wrote one). Per archive the JSON
# report, the findings log and the console summary land in <report-dir>,
# which CI uploads as an artifact.
#
# The verdict is only trusted when three things hold: exit 0 (no error-level
# finding, no engine failure), verdict PASS in the JSON, and NO
# `profile_resolution` finding -- that is the validator saying it could not
# match the archive's declared mzPeak version to a profile and fell back to
# its latest one, which is a warning there and would otherwise be a green
# run that validated against the wrong specification. Warnings otherwise
# pass (FASTag's metadata mapping still lacks several CV accessions; see
# doc/PLAN-ci-mzpeak-coverage.md).
#
# The validator: `mzpeak-validate` from test/mzpeak-validator-requirements.txt
# (pinned to a commit, engine pinned too). Resolved from MZPEAK_VALIDATE when
# set -- and then it MUST work, a set-but-broken path is a failure -- else
# from PATH, else this exits 77 (ctest SKIP). Exits 77 too when a directory
# holds no archive at all, which is how a skipped producer (a build without
# the library) reads from here.
set -u
export LC_ALL=C
R="$1"; shift

V="${MZPEAK_VALIDATE:-}"
if [ -n "$V" ]; then
  if ! [ -x "$V" ] && ! command -v "$V" >/dev/null 2>&1; then
    echo "FAIL: MZPEAK_VALIDATE='$V' is set but not executable"; exit 1
  fi
else
  V=$(command -v mzpeak-validate 2>/dev/null || true)
  if [ -z "$V" ]; then
    echo "SKIP: mzpeak-validate not on PATH and MZPEAK_VALIDATE unset" >&2
    echo "      (python -m pip install -r test/mzpeak-validator-requirements.txt)" >&2
    exit 77
  fi
fi

archives=()
for a in "$@"; do
  if [ -d "$a" ]; then
    for f in "$a"/*.mzpeak; do [ -e "$f" ] && archives+=("$f"); done
  elif [ -e "$a" ]; then
    archives+=("$a")
  else
    echo "FAIL: archive not found: $a"; exit 1
  fi
done
if [ "${#archives[@]}" -eq 0 ]; then
  echo "SKIP: no .mzpeak archive under: $*" >&2; exit 77
fi

mkdir -p "$R"
fail=0
for a in "${archives[@]}"; do
  n=$(basename "$a" .mzpeak)
  "$V" "$a" --json "$R/$n.json" --log "$R/$n.log" >"$R/$n.txt" 2>&1
  rc=$?
  summary=$(head -1 "$R/$n.txt")
  if [ "$rc" -eq 2 ] || ! [ -s "$R/$n.json" ]; then
    echo "  FAIL $n: validator engine failure (exit $rc)"; cat "$R/$n.txt"; fail=1; continue
  fi
  if [ "$rc" -ne 0 ]; then
    echo "  FAIL $n: $summary"; grep -A1 -E '^  ERROR' "$R/$n.txt"; fail=1; continue
  fi
  if grep -q '"profile_resolution"' "$R/$n.json"; then
    echo "  FAIL $n: the validator could not match the archive's declared mzPeak version and fell back to a default profile"
    grep -A1 profile_resolution "$R/$n.txt"; fail=1; continue
  fi
  if ! grep -q '"verdict": "PASS"' "$R/$n.json"; then
    echo "  FAIL $n: exit 0 but the report's verdict is not PASS"; echo "$summary"; fail=1; continue
  fi
  echo "  ok   $n: $summary"
done

[ "$fail" -eq 0 ] || { echo "mzpeak_validate: FAILED (reports in $R)"; exit 1; }
echo "mzpeak_validate: ${#archives[@]} archive(s) valid, full mode, reports in $R"
