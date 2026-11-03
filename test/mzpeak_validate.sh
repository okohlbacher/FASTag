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
# One set of errors is accepted, by name: OpenMS's MzPeakFile::store() writes
# no run id and none of the run's default references (instrument, data
# processing, source file), which the schema requires. An archive whose ONLY
# errors are those four passes as "ok (run references)"; any other error
# fails. Everything below applies to the rest.
#
# The verdict is only trusted when three things hold: exit 0 (no error-level
# finding, no engine failure), verdict PASS in the JSON, and NO
# `profile_resolution` finding -- that is the validator saying it could not
# match the archive's declared mzPeak version to a profile and fell back to
# its latest one, which is a warning there and would otherwise be a green
# run that validated against the wrong specification. Warnings otherwise
# pass (FASTag's metadata mapping still lacks several CV accessions).
#
# The validator: `mzpeak-validate` from test/mzpeak-validator-requirements.txt
# (pinned to a commit, engine pinned too). Resolved from MZPEAK_VALIDATE when
# set -- and then it MUST work, a set-but-broken path is a failure -- else
# from PATH, else this exits 77 (ctest SKIP). Exits 77 too when a directory
# holds no archive at all, which is how a skipped producer (a build without
# mzPeak support) reads from here.
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

PY=$(command -v python3 2>/dev/null || command -v python 2>/dev/null || true)
# Whether every error-level finding in report $1 is one of the run-reference
# gaps of MzPeakFile::store() named in the header.
only_run_reference_errors() {
  [ -n "$PY" ] || return 1
  "$PY" - "$1" <<'PYEOF'
import json, re, sys
known = re.compile(r"schema violation at metadata/run: '(id|default_instrument_id|default_data_processing_id"
                   r"|default_source_file_id)' is a required property$")
errors = [f for f in json.load(open(sys.argv[1]))["findings"] if f.get("level") == "error"]
sys.exit(0 if errors and all(f.get("ruleId") == "index_schema_valid" and known.search(f.get("message", ""))
                             for f in errors) else 1)
PYEOF
}

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
    if [ "$rc" -eq 1 ] && only_run_reference_errors "$R/$n.json"; then
      echo "  ok   $n (run references): $summary"; continue
    fi
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
