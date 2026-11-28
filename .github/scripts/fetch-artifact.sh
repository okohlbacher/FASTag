#!/usr/bin/env bash
# fetch-artifact.sh <run id> <artifact name> <dir> [attempts] [seconds per attempt]
#
# Downloads one workflow artifact with gh run download, bounded: each attempt
# gets a time limit and a fresh, empty directory, and the next attempt starts
# over. The v1.16.4 Windows release-assets job sat 53 minutes in a stalled
# actions/download-artifact; its rerun took a minute. Exits non-zero after the
# last failed attempt; on success <dir> holds the artifact's files and
# nothing of an earlier attempt.
#
# FETCH_BUDGET (seconds, default: attempts x limit + back-off) caps all
# attempts together, so the retries fit inside the calling job's timeout:
# an attempt gets at most what is left of it. A timed-out download is sent
# TERM, then KILL 10 s later, and reaped before its directory is reused.
#
# Needs GH_TOKEN (actions: read) and GH_REPO or GITHUB_REPOSITORY.
set -uo pipefail
RUN="${1:?run id}"; NAME="${2:?artifact name}"; DIR="${3:?directory}"
ATTEMPTS="${4:-3}"; LIMIT="${5:-300}"
REPO="${GH_REPO:-${GITHUB_REPOSITORY:?GH_REPO or GITHUB_REPOSITORY}}"
END=$(( $(date +%s) + ${FETCH_BUDGET:-$(( ATTEMPTS * (LIMIT + 30) ))} ))

# A time limit without coreutils' timeout (macOS runners have none): TERM,
# then KILL after 10 s, and the child always reaped.
bounded() {
  local s=$1; shift
  if command -v timeout >/dev/null 2>&1 && timeout --version >/dev/null 2>&1; then
    timeout -k 10 "$s" "$@"
  else
    perl -e '
      my $s = shift; my $pid = fork // die "fork: $!";
      if (!$pid) { setpgrp(0, 0); exec @ARGV or exit 127 }
      local $SIG{ALRM} = sub { kill "TERM", -$pid; sleep 10; kill "KILL", -$pid; waitpid $pid, 0; exit 124 };
      alarm $s; waitpid $pid, 0; alarm 0; exit($? >> 8)' "$s" "$@"
  fi
}

for ((i = 1; i <= ATTEMPTS; i++)); do
  left=$(( END - $(date +%s) ))
  [ "$left" -gt 5 ] || { echo "::warning::artifact $NAME of run $RUN: no time left for attempt $i"; break; }
  lim=$LIMIT; [ "$left" -lt "$lim" ] && lim=$left
  rm -rf "$DIR"; mkdir -p "$DIR"
  start=$(date +%s)
  if bounded "$lim" gh run download "$RUN" --repo "$REPO" --name "$NAME" --dir "$DIR"; then
    if [ -n "$(find "$DIR" -type f | head -1)" ]; then
      echo "artifact $NAME of run $RUN: attempt $i, $(( $(date +%s) - start )) s, $(find "$DIR" -type f | wc -l | tr -d ' ') file(s)"
      exit 0
    fi
    echo "::warning::artifact $NAME of run $RUN: attempt $i gave no file"
  else
    echo "::warning::artifact $NAME of run $RUN: attempt $i failed or exceeded ${lim} s"
  fi
  [ "$i" -lt "$ATTEMPTS" ] && sleep $((i * ${FETCH_SLEEP:-10}))
done
rm -rf "$DIR"
echo "::error::could not download artifact $NAME of run $RUN in $ATTEMPTS attempts"
exit 1
