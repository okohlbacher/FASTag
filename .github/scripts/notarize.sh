#!/usr/bin/env bash
# notarize.sh [submit|wait] <file> [label]
#
# Apple notarization of a disk image (or zip) by submission ID, then the
# ticket stapled. Replaces `notarytool submit --wait`, which ties the upload
# and the whole wait to one connection: a dropped connection
# (NSURLErrorDomain -1001 / -1005, the PR #149 dry run) failed the step
# although Apple went on to accept the submission.
#
#   1. submit without --wait, up to 3 times while no submission ID came
#      back (an upload whose reply was lost is submitted again: the only case
#      that makes a second submission);
#   2. the ID goes to the log, the job summary and $RUNNER_TEMP/notary-<label>.id
#      (a failed write fails the step);
#   3. wait on that ID, retrying a failed or timed-out wait until the
#      deadline -- never a new upload;
#   4. Accepted -> staple (3 tries) and validate; Invalid or Rejected -> the
#      notary log is printed and the script fails.
#
# submit: steps 1-2 only; wait: steps 3-4 for the ID a submit kept; neither:
# all four. Between the two the job can do other work (ci.yml builds the
# desktop app while the CLI disk image is with Apple).
#
# Every notarytool and stapler call is bounded, and by what is left of the
# deadline (NOTARY_DEADLINE seconds from the start of this call, default
# 3600). JSON is read from stdout only; stderr (warnings) goes to the log.
#
# Needs MACOS_APPLE_ID, MACOS_TEAM_ID, MACOS_NOTARY_PASSWORD. NOTARY_WAIT
# (seconds per wait call, default 900) and NOTARY_SLEEP (base back-off,
# default 30) exist for the tests.
set -uo pipefail
MODE=all
case "${1:-}" in submit|wait) MODE=$1; shift ;; esac
FILE="${1:?file to notarize}"
LABEL="${2:-$(basename "$FILE")}"
DEADLINE=$(( $(date +%s) + ${NOTARY_DEADLINE:-3600} ))
WAIT=${NOTARY_WAIT:-900}
SLEEP=${NOTARY_SLEEP:-30}
: "${MACOS_APPLE_ID:?}" "${MACOS_TEAM_ID:?}" "${MACOS_NOTARY_PASSWORD:?}"
AUTH=(--apple-id "$MACOS_APPLE_ID" --team-id "$MACOS_TEAM_ID" --password "$MACOS_NOTARY_PASSWORD")
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"
ERR="${RUNNER_TEMP:-/tmp}/notary-$LABEL.err"
json() { python3 -c 'import json,sys
try: print(json.load(sys.stdin).get(sys.argv[1], ""))
except Exception: print("")' "$1"; }
left() { echo $(( DEADLINE - $(date +%s) )); }
# Runs "$@" for at most min($1, what is left) seconds: TERM, KILL 10 s later.
# NOCAP=1: the full s (stapling an accepted submission is not cut short).
bounded() {
  local s=$1 l; shift; l=$(left)
  [ "${NOCAP:-0}" = 1 ] || { [ "$l" -lt "$s" ] && s=$l; }
  [ "$s" -gt 0 ] || return 124
  perl -e '
    my $s = shift; my $pid = fork // die "fork: $!";
    if (!$pid) { setpgrp(0, 0); exec @ARGV or exit 127 }
    local $SIG{ALRM} = sub { kill "TERM", -$pid; sleep 10; kill "KILL", -$pid; waitpid $pid, 0; exit 124 };
    alarm $s; waitpid $pid, 0; alarm 0; exit($? >> 8)' "$s" "$@"
}

IDFILE="${RUNNER_TEMP:-/tmp}/notary-$LABEL.id"
id=""
if [ "$MODE" = wait ]; then
  id=$(cat "$IDFILE" 2>/dev/null) || true
  [ -n "$id" ] || { echo "::error::$LABEL: no submission ID in $IDFILE (no submit before this wait)"; exit 1; }
  echo "notary submission of $LABEL (from the submit step): $id"
fi
for i in 1 2 3; do
  [ -n "$id" ] && break
  out=$(bounded 1800 xcrun notarytool submit "$FILE" "${AUTH[@]}" --output-format json 2>"$ERR")
  rc=$?
  id=$(json id <<< "$out")
  [ -s "$ERR" ] && { echo "notarytool submit (stderr):"; cat "$ERR"; }
  if [ -n "$id" ]; then break; fi
  echo "notary submit of $LABEL, attempt $i (exit $rc), no submission ID: $out"
  [ "$i" -lt 3 ] && sleep $((i * SLEEP))
done
[ -n "$id" ] || { echo "::error::$LABEL: no notary submission ID after 3 uploads"; exit 1; }
if [ "$MODE" != wait ]; then
  { echo "$id" > "$IDFILE" && [ "$(cat "$IDFILE")" = "$id" ]; } \
    || { echo "::error::$LABEL: could not keep submission ID $id in $IDFILE"; exit 1; }
  echo "notary submission of $LABEL: $id"
  echo "- notary submission \`$id\` ($LABEL)" >> "$SUMMARY"
fi
[ "$MODE" = submit ] && exit 0

status=""
n=0
while :; do
  n=$((n + 1))
  w=$WAIT; l=$(left); [ "$l" -lt "$w" ] && w=$l
  [ "$w" -gt 0 ] || w=1
  out=$(bounded $((w + 60)) xcrun notarytool wait "$id" "${AUTH[@]}" --timeout "${w}s" --output-format json 2>"$ERR")
  rc=$?
  status=$(json status <<< "$out")
  # Read the status again by ID if the wait's own reply was lost.
  if [ -z "$status" ]; then
    info=$(bounded 120 xcrun notarytool info "$id" "${AUTH[@]}" --output-format json 2>>"$ERR")
    status=$(json status <<< "$info")
  fi
  echo "notary wait $n for $id ($LABEL): exit $rc, status '${status:-unknown}'"
  [ -s "$ERR" ] && cat "$ERR"
  case "$status" in
    Accepted) break ;;
    Invalid|Rejected)
      bounded 120 xcrun notarytool log "$id" "${AUTH[@]}" 2>&1 | head -200
      echo "::error::$LABEL: notarization $status (submission $id)"
      exit 1 ;;
  esac
  [ "$(left)" -gt 0 ] \
    || { echo "::error::$LABEL: submission $id not accepted by the deadline (last status '${status:-unknown}': $out)"; exit 1; }
  sleep "$SLEEP"
done

for i in 1 2 3; do
  if NOCAP=1 bounded 300 xcrun stapler staple "$FILE"; then
    NOCAP=1 bounded 120 xcrun stapler validate "$FILE" && exit 0
  fi
  echo "stapling $LABEL, attempt $i failed"
  [ "$i" -lt 3 ] && sleep $((i * SLEEP))
done
echo "::error::$LABEL: notarized (submission $id) but the ticket could not be stapled"
exit 1
